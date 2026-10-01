import { create } from 'zustand';
import { db, deleteRow, persistRow } from '../hooks/usePersistentStore';
import { uid } from '../utils/id';
import type { AdjudicationDecision, MaintenanceAdjudication, MaintenanceWindow } from '../types';

export interface MaintenanceWindowInput {
  telescopeId: string;
  startDate: string;
  endDate: string;
  reason: string;
  createdBy: string;
}

export interface AdjudicationInput {
  sessionId: string;
  windowId: string;
  decision: AdjudicationDecision;
  note?: string;
  decidedBy: string;
}

interface MaintenanceState {
  /** 维修窗口（维护组登记，独立于排程段） */
  windows: MaintenanceWindow[];
  /** 值班人对牵制项的裁定记录 */
  adjudications: MaintenanceAdjudication[];
  hydrated: boolean;
  /** 维护通告是否已读入编排台（未读入时编排侧保留自己的排程，不据此改动） */
  noticeRead: boolean;
  /** 对账进行中 */
  reconciling: boolean;
  /** 对账 / 读入通告失败信息（失败时编排侧排程不动） */
  reconcileError: string;
  /** 最近一次对账时间 */
  lastReconcileAt: string | null;

  hydrate: () => Promise<void>;
  addWindow: (input: MaintenanceWindowInput) => Promise<MaintenanceWindow>;
  updateWindow: (id: string, patch: Partial<MaintenanceWindowInput>) => Promise<void>;
  removeWindow: (id: string) => Promise<void>;
  /** 读入维护通告并对账：只核对维护窗口与排程段，不改动任何一方数据 */
  reconcile: () => Promise<number>;
  /** 对账失败后重试：只补拉维护组（维修窗口）那一侧，排程段一侧不动 */
  retryReconcile: () => Promise<number>;
  /** 值班人对牵制项裁定（只记录决定，不替编排台改排程段） */
  adjudicate: (input: AdjudicationInput) => Promise<void>;
}

/** 维修窗口与牵制裁定（维护组持有；编排台只读，互不替对方改数据） */
export const useMaintenanceStore = create<MaintenanceState>()((set, get) => ({
  windows: [],
  adjudications: [],
  hydrated: false,
  noticeRead: false,
  reconciling: false,
  reconcileError: '',
  lastReconcileAt: null,

  hydrate: async () => {
    try {
      const [windows, adjudications] = await Promise.all([
        db.maintenanceWindows.orderBy('startDate').toArray(),
        db.adjudications.orderBy('decidedAt').toArray(),
      ]);
      set({ windows, adjudications, hydrated: true, reconcileError: '' });
    } catch (reason) {
      // 维护通告没读进来：保留编排台已有的排程，不据此做任何改动
      set({
        hydrated: true,
        noticeRead: false,
        reconcileError: `维护通告读入失败：${(reason as Error).message}。编排排程已保留，可重试补拉维护组数据。`,
      });
    }
  },

  addWindow: async (input) => {
    const window: MaintenanceWindow = {
      id: uid('mw'),
      telescopeId: input.telescopeId,
      startDate: input.startDate,
      endDate: input.endDate,
      reason: input.reason.trim(),
      createdBy: input.createdBy.trim() || '维护组',
      createdAt: new Date().toISOString(),
    };
    // 只写维修窗口表，绝不触碰排程段
    await persistRow('maintenanceWindows', window);
    set({ windows: [...get().windows, window].sort((a, b) => a.startDate.localeCompare(b.startDate)) });
    return window;
  },

  updateWindow: async (id, patch) => {
    const current = get().windows.find((item) => item.id === id);
    if (!current) return;
    const next: MaintenanceWindow = { ...current, ...patch };
    await persistRow('maintenanceWindows', next);
    set({ windows: get().windows.map((item) => (item.id === id ? next : item)) });
  },

  removeWindow: async (id) => {
    // 只删维修窗口表；已排的排程段原样保留，不会被抹掉
    await deleteRow('maintenanceWindows', id);
    set({ windows: get().windows.filter((item) => item.id !== id) });
  },

  reconcile: async () => {
    set({ reconciling: true, reconcileError: '' });
    try {
      // 对账只重新读维护组一侧的数据（维修窗口 + 裁定记录），不写、不改排程段
      const [windows, adjudications] = await Promise.all([
        db.maintenanceWindows.orderBy('startDate').toArray(),
        db.adjudications.orderBy('decidedAt').toArray(),
      ]);
      set({ windows, adjudications, noticeRead: true, lastReconcileAt: new Date().toISOString(), reconciling: false });
      return windows.length;
    } catch (reason) {
      set({
        reconciling: false,
        noticeRead: false,
        reconcileError: `对账失败：${(reason as Error).message}。编排排程未改动，请重试补拉维护组数据。`,
      });
      return 0;
    }
  },

  retryReconcile: async () => {
    // 对账失败后重试：只补维护组那一侧（维修窗口），排程段一侧保持不动
    return get().reconcile();
  },

  adjudicate: async (input) => {
    const existing = get().adjudications.find(
      (item) => item.sessionId === input.sessionId && item.windowId === input.windowId,
    );
    const record: MaintenanceAdjudication = {
      id: existing?.id ?? uid('adj'),
      sessionId: input.sessionId,
      windowId: input.windowId,
      decision: input.decision,
      note: input.note?.trim() || undefined,
      decidedBy: input.decidedBy.trim() || '值班人',
      decidedAt: new Date().toISOString(),
    };
    await persistRow('adjudications', record);
    set({
      adjudications: existing
        ? get().adjudications.map((item) => (item.id === existing.id ? record : item))
        : [...get().adjudications, record],
    });
  },
}));
