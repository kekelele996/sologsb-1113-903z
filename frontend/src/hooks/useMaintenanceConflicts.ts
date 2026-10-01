import { useCallback, useMemo } from 'react';
import { useNightStore } from '../stores/nightStore';
import { useSessionStore } from '../stores/sessionStore';
import { useMaintenanceStore } from '../stores/maintenanceStore';
import type { MaintenanceWindow, ObsSession, RulingRecord } from '../types';
import { axisMinutes, overlapMinutes } from '../utils/astro';

/** 排程段 × 维修窗口相互牵制项（双方数据只读比对，任何一方都不被改写） */
export interface MaintenanceConflict {
  nightId: string;
  telescopeId: string;
  window: MaintenanceWindow;
  session: ObsSession;
  /** 重叠分钟数 */
  overlapMinutes: number;
  /** 重叠区间文案 */
  overlapText: string;
  /** 已完成排程段：做完的段不动，牵制无法改期，只能维持维护方安排 */
  locked: boolean;
  /** 值班人已作出的裁定（若有） */
  ruling?: RulingRecord;
}

function describe(window: MaintenanceWindow, session: ObsSession, nightDate: string, ruling?: RulingRecord): MaintenanceConflict | null {
  if (window.telescopeId !== session.telescopeId || window.date !== nightDate) return null;
  const overlap = overlapMinutes(window.startTime, window.endTime, session.startTime, session.endTime);
  if (overlap <= 0) return null;
  const windowStart = axisMinutes(window.startTime);
  const sessionStart = axisMinutes(session.startTime);
  const overlapStartAxis = Math.max(windowStart, sessionStart);
  const overlapStartClock = (18 * 60 + overlapStartAxis) % 1440;
  const hh = String(Math.floor(overlapStartClock / 60)).padStart(2, '0');
  const mm = String(overlapStartClock % 60).padStart(2, '0');
  return {
    nightId: session.nightId,
    telescopeId: session.telescopeId,
    window,
    session,
    overlapMinutes: overlap,
    overlapText: `${hh}:${mm} 起重叠 ${overlap} 分钟`,
    locked: session.status === '已完成',
    ruling,
  };
}

export interface MaintenanceConflictApi {
  /** 某观测夜的全部相互牵制项 */
  conflictsOfNight: (nightId: string) => MaintenanceConflict[];
  /** 某观测夜内、落在某望远镜某 30 分钟格子上的牵制项 */
  cellConflicts: (nightId: string, telescopeId: string, slotIndex: number, slotMinutes: number) => MaintenanceConflict[];
  /** 某排程段在某观测夜命中的牵制项（总览页 / 排程段表单使用） */
  conflictsForSession: (nightId: string, telescopeId: string, startTime: string, endTime: string, ignoreSessionId?: string) => MaintenanceConflict[];
  /** 待值班裁定（未裁定且非已完成段） */
  actionable: MaintenanceConflict[];
  /** 已完成段被停机时段覆盖，仅留痕不可动 */
  locked: MaintenanceConflict[];
  /** 已有裁定结果 */
  ruled: MaintenanceConflict[];
}

/**
 * 交叉比对维护组的维修窗口与编排台的排程段。
 * 只做只读比对，输出供设备分配视图上的值班人裁定。
 */
export function useMaintenanceConflicts(nightId?: string): MaintenanceConflictApi {
  const sessions = useSessionStore((s) => s.sessions);
  const windows = useMaintenanceStore((s) => s.windows);
  const rulings = useMaintenanceStore((s) => s.rulings);
  const nights = useNightStore((s) => s.nights);

  const conflictsOfNight = useCallback(
    (targetNightId: string): MaintenanceConflict[] => {
      const night = nights.find((item) => item.id === targetNightId);
      if (!night) return [];
      const nightSessions = sessions.filter((session) => session.nightId === targetNightId);
      const result: MaintenanceConflict[] = [];
      windows.forEach((window) => {
        nightSessions.forEach((session) => {
          const ruling = rulings.find((item) => item.windowId === window.id && item.sessionId === session.id);
          const conflict = describe(window, session, night.date, ruling);
          if (conflict) result.push(conflict);
        });
      });
      return result.sort((a, b) => axisMinutes(a.session.startTime) - axisMinutes(b.session.startTime));
    },
    [sessions, windows, rulings, nights],
  );

  const cellConflicts = useCallback(
    (targetNightId: string, telescopeId: string, slotIndex: number, slotMinutes: number): MaintenanceConflict[] => {
      return conflictsOfNight(targetNightId).filter((conflict) => {
        if (conflict.telescopeId !== telescopeId) return false;
        const slotStart = slotIndex * slotMinutes;
        const slotEnd = slotStart + slotMinutes;
        const start = axisMinutes(conflict.window.startTime);
        const rawEnd = axisMinutes(conflict.window.endTime);
        const end = rawEnd <= start ? rawEnd + 1440 : rawEnd;
        return Math.min(end, slotEnd) - Math.max(start, slotStart) > 0;
      });
    },
    [conflictsOfNight],
  );

  const conflictsForSession = useCallback(
    (targetNightId: string, telescopeId: string, startTime: string, endTime: string, ignoreSessionId?: string): MaintenanceConflict[] => {
      const night = nights.find((item) => item.id === targetNightId);
      if (!night) return [];
      const candidate: ObsSession = {
        id: ignoreSessionId ?? '__candidate__',
        nightId: targetNightId,
        targetId: '',
        startTime,
        endTime,
        telescopeId,
        instrumentId: '',
        filterSlot: '',
        plannedFrames: 0,
        status: '待执行',
        schemaVersion: 3,
      };
      return windows
        .map((window) => describe(window, candidate, night.date))
        .filter((item): item is MaintenanceConflict => item !== null);
    },
    [windows, nights],
  );

  const nightConflicts = useMemo(() => (nightId ? conflictsOfNight(nightId) : []), [nightId, conflictsOfNight]);

  return useMemo(
    () => ({
      conflictsOfNight,
      cellConflicts,
      conflictsForSession,
      actionable: nightConflicts.filter((conflict) => !conflict.locked && !conflict.ruling),
      locked: nightConflicts.filter((conflict) => conflict.locked),
      ruled: nightConflicts.filter((conflict) => Boolean(conflict.ruling)),
    }),
    [conflictsOfNight, cellConflicts, conflictsForSession, nightConflicts],
  );
}
