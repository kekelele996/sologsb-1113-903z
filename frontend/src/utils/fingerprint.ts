import type { ObsSession } from '../types';

/**
 * 排程段指纹：FNV-1a 32 位哈希。
 *
 * 用于对账前后比对——通告读入（含失败重试）只补维护组那一侧的维修窗口，
 * 编排台持有的排程段哈希必须前后一致。
 */
export function sessionsFingerprint(sessions: Pick<ObsSession, 'id' | 'nightId' | 'startTime' | 'endTime' | 'telescopeId' | 'status' | 'backupNightId'>[]): string {
  const canonical = sessions
    .map((session) => [session.id, session.nightId, session.startTime, session.endTime, session.telescopeId, session.status, session.backupNightId ?? ''].join('|'))
    .sort()
    .join('\n');
  let hash = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i += 1) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
