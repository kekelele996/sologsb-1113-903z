import { useCallback } from 'react';
import { useMaintenanceStore } from '../stores/maintenanceStore';
import { useNightStore } from '../stores/nightStore';
import { useSessionStore } from '../stores/sessionStore';
import type { MaintenanceConflict } from '../types';

/** 已落定 / 已改期的排程段不再参与牵制裁定（做完的段不动） */
const IMMUTABLE_STATUSES = ['已完成', '因云取消'] as const;

export interface MaintenanceCheckApi {
  /** 某观测夜内排程段与维修窗口的牵制项（已排除做完的段） */
  conflictsOfNight: (nightId: string) => MaintenanceConflict[];
  /** 牵制项 id 集合（可传观测夜过滤） */
  conflictIds: (nightId?: string) => Set<string>;
  /** 某排程段是否落在维修窗口内（且未裁定） */
  isSessionAffected: (sessionId: string) => boolean;
}

/** 观测夜日期是否落在维修窗口日期范围内（含首尾） */
function coversDate(window: { startDate: string; endDate: string }, date: string): boolean {
  return window.startDate <= date && date <= window.endDate;
}

/** 排程段 × 维修窗口牵制检测：只比对、不改动任何一方数据 */
export function useMaintenanceCheck(): MaintenanceCheckApi {
  const sessions = useSessionStore((s) => s.sessions);
  const nights = useNightStore((s) => s.nights);
  const windows = useMaintenanceStore((s) => s.windows);
  const adjudications = useMaintenanceStore((s) => s.adjudications);
  const noticeRead = useMaintenanceStore((s) => s.noticeRead);

  const conflictsOfNight = useCallback(
    (nightId: string): MaintenanceConflict[] => {
      // 维护通告没读进来时，编排侧保留自己的排程，不据此标冲突
      if (!noticeRead) return [];
      const night = nights.find((item) => item.id === nightId);
      if (!night) return [];
      const result: MaintenanceConflict[] = [];
      sessions
        .filter((session) => session.nightId === nightId)
        .filter((session) => !IMMUTABLE_STATUSES.includes(session.status as (typeof IMMUTABLE_STATUSES)[number]))
        .forEach((session) => {
          windows
            .filter((window) => window.telescopeId === session.telescopeId)
            .filter((window) => coversDate(window, night.date))
            .forEach((window) => {
              const adjudication = adjudications.find(
                (item) => item.sessionId === session.id && item.windowId === window.id,
              );
              result.push({
                sessionId: session.id,
                windowId: window.id,
                nightId,
                telescopeId: session.telescopeId,
                date: night.date,
                sessionTime: `${session.startTime}-${session.endTime}`,
                windowText: `${window.startDate} 至 ${window.endDate} · ${window.reason}`,
                adjudicated: Boolean(adjudication),
                decision: adjudication?.decision,
              });
            });
        });
      return result;
    },
    [sessions, nights, windows, adjudications, noticeRead],
  );

  const conflictIds = useCallback(
    (nightId?: string): Set<string> => {
      const ids = new Set<string>();
      const scoped = nightId ? [nightId] : nights.map((night) => night.id);
      scoped.forEach((id) => {
        conflictsOfNight(id).forEach((conflict) => ids.add(conflict.sessionId));
      });
      return ids;
    },
    [conflictsOfNight, nights],
  );

  const isSessionAffected = useCallback(
    (sessionId: string): boolean => {
      const session = sessions.find((item) => item.id === sessionId);
      if (!session) return false;
      return conflictIds(session.nightId).has(sessionId);
    },
    [sessions, conflictIds],
  );

  return { conflictsOfNight, conflictIds, isSessionAffected };
}
