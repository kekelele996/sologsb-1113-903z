import { create } from 'zustand';
import { db, deleteRow, persistRow, SCHEMA_VERSION } from '../hooks/usePersistentStore';
import { uid } from '../utils/id';
import { sessionsFingerprint } from '../utils/fingerprint';
import {
  fetchMaintenanceBulletin,
  MAINTENANCE_BULLETIN_ID,
  MAINTENANCE_BULLETIN_ISSUED_AT,
} from '../utils/maintenanceBulletin';
import {
  DEFAULT_MAINTENANCE_SYNC,
  type MaintenanceSyncMeta,
  type MaintenanceWindow,
  type RulingRecord,
  type RulingVerdict,
} from '../types';

const SYNC_META_KEY = 'maintenanceSync';

export interface MaintenanceWindowInput {
  telescopeId: string;
  date: string;
  startTime: string;
  endTime: string;
  reason: string;
  registeredBy: string;
}

export interface RulingInput {
  nightId: string;
  telescopeId: string;
  windowId: string;
  sessionId: string;
  verdict: RulingVerdict;
  dutyOfficer: string;
  note?: string;
}

export interface BulletinReadResult {
  ok: boolean;
  error?: string;
  /** 对账前后编排侧排程段是否发生变化（应为 false：对账只补维护侧） */
  sessionChanged: boolean;
  imported: number;
}

async function loadSyncMeta(): Promise<MaintenanceSyncMeta> {
  const row = await db.meta.get(SYNC_META_KEY);
  if (!row) return { ...DEFAULT_MAINTENANCE_SYNC };
  try {
    return { ...DEFAULT_MAINTENANCE_SYNC, ...(JSON.parse(row.value) as Partial<MaintenanceSyncMeta>) };
  } catch {
    return { ...DEFAULT_MAINTENANCE_SYNC };
  }
}

async function saveSyncMeta(meta: MaintenanceSyncMeta): Promise<void> {
  await db.meta.put({ key: SYNC_META_KEY, value: JSON.stringify(meta) });
}

function sortWindows(windows: MaintenanceWindow[]): MaintenanceWindow[] {
  return [...windows].sort(
    (a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime) || a.telescopeId.localeCompare(b.telescopeId),
  );
}

interface MaintenanceState {
  /** 维护组侧持有的维修窗口（bulletin 通告 + local 本机登记） */
  windows: MaintenanceWindow[];
  /** 值班人在设备分配视图上作出的裁定记录（不属于任何一方的原始数据） */
  rulings: RulingRecord[];
  sync: MaintenanceSyncMeta;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  /** 维护组本机登记维修窗口（source=local） */
  registerWindow: (input: MaintenanceWindowInput) => Promise<MaintenanceWindow>;
  /** 撤回本机登记窗口；通告窗口不可撤回 */
  cancelLocalWindow: (id: string) => Promise<void>;
  /** 读入维护组通告并对账（失败不触碰编排侧，重试只补维护侧） */
  readBulletin: () => Promise<BulletinReadResult>;
  /** 值班人记录 / 改写裁定（同一 窗口×排程段 反复裁定按稳定 ID 覆盖） */
  upsertRuling: (input: RulingInput) => Promise<RulingRecord>;
  withdrawRuling: (id: string) => Promise<void>;
}

/**
 * 维护组侧数据：维修窗口 + 通告对账状态 + 值班裁定。
 * 边界约束：本 store 只写 maintenanceWindows / rulings / meta，绝不写 sessions——
 * 编排台定下的排程段维护侧无权修改，反之亦然。
 */
export const useMaintenanceStore = create<MaintenanceState>()((set, get) => ({
  windows: [],
  rulings: [],
  sync: { ...DEFAULT_MAINTENANCE_SYNC },
  hydrated: false,

  hydrate: async () => {
    const [windows, rulings, sync] = await Promise.all([
      db.maintenanceWindows.toArray(),
      db.rulings.toArray(),
      loadSyncMeta(),
    ]);
    set({ windows: sortWindows(windows), rulings, sync, hydrated: true });
  },

  registerWindow: async (input) => {
    const window: MaintenanceWindow = {
      id: uid('mw'),
      telescopeId: input.telescopeId,
      date: input.date,
      startTime: input.startTime,
      endTime: input.endTime,
      reason: input.reason.trim(),
      registeredBy: input.registeredBy.trim(),
      source: 'local',
      schemaVersion: SCHEMA_VERSION,
    };
    await persistRow('maintenanceWindows', window);
    set({ windows: sortWindows([...get().windows, window]) });
    return window;
  },

  cancelLocalWindow: async (id) => {
    const current = get().windows.find((window) => window.id === id);
    if (!current) return;
    if (current.source === 'bulletin') {
      throw new Error('通告窗口由维护组持有，编排端不能抹掉；如需变更请联系维护组重新签发通告');
    }
    await deleteRow('maintenanceWindows', id);
    set({ windows: get().windows.filter((window) => window.id !== id) });
  },

  readBulletin: async () => {
    const previous = get().sync;
    const attemptedAt = new Date().toISOString();

    // 先取编排侧指纹：无论本次对账成败，排程段都应保持原样
    const beforeHash = sessionsFingerprint(await db.sessions.toArray());

    try {
      // 首次对账（attempts=0）夹具必然抛错；重试时 attempts>=1 才成功
      const bulletinWindows = await fetchMaintenanceBulletin(previous.attempts);

      // 只补维护组那一侧：按窗口 ID 覆盖 upsert，local 登记行原样保留，绝不删任何排程段
      await db.maintenanceWindows.bulkPut(bulletinWindows);

      const afterHash = sessionsFingerprint(await db.sessions.toArray());
      const meta: MaintenanceSyncMeta = {
        status: '已读入',
        attempts: previous.attempts + 1,
        attemptedAt,
        succeededAt: new Date().toISOString(),
        bulletinId: MAINTENANCE_BULLETIN_ID,
        bulletinIssuedAt: MAINTENANCE_BULLETIN_ISSUED_AT,
        lastError: undefined,
      };
      await saveSyncMeta(meta);
      set({ windows: sortWindows(await db.maintenanceWindows.toArray()), sync: meta });
      return { ok: true, sessionChanged: beforeHash !== afterHash, imported: bulletinWindows.length };
    } catch (reason) {
      // 对账失败：维修窗口与排程段一律不写，仅落失败状态，等值班人点重试
      const meta: MaintenanceSyncMeta = {
        ...previous,
        status: '读入失败',
        attempts: previous.attempts + 1,
        attemptedAt,
        lastError: (reason as Error).message,
      };
      await saveSyncMeta(meta);
      set({ sync: meta });
      return { ok: false, error: (reason as Error).message, sessionChanged: false, imported: 0 };
    }
  },

  upsertRuling: async (input) => {
    const id = `ruling-${input.windowId}-${input.sessionId}`;
    const existing = get().rulings.find((ruling) => ruling.id === id);
    const ruling: RulingRecord = {
      id,
      nightId: input.nightId,
      telescopeId: input.telescopeId,
      windowId: input.windowId,
      sessionId: input.sessionId,
      verdict: input.verdict,
      dutyOfficer: input.dutyOfficer.trim() || '值班人',
      note: input.note?.trim() || undefined,
      ruledAt: new Date().toISOString(),
      schemaVersion: SCHEMA_VERSION,
    };
    await persistRow('rulings', ruling);
    set({
      rulings: existing
        ? get().rulings.map((item) => (item.id === id ? ruling : item))
        : [...get().rulings, ruling],
    });
    return ruling;
  },

  withdrawRuling: async (id) => {
    await deleteRow('rulings', id);
    set({ rulings: get().rulings.filter((ruling) => ruling.id !== id) });
  },
}));
