import type { MaintenanceWindow } from '../types';

/**
 * 维护组通告（模拟维护组那一侧系统下发的停机时段数据）。
 *
 * 纯前端应用没有真正的远端服务：通告内容是一份固定夹具，首次对账必然失败一次，
 * 重试才成功——用于演示「对账失败后重试只补维护组那一侧，编排侧数据不动」。
 */

export const MAINTENANCE_BULLETIN_ID = 'MB-20251011-03';
export const MAINTENANCE_BULLETIN_ISSUED_AT = '2025-10-11T09:30:00+08:00';
export const MAINTENANCE_BULLETIN_ISSUER = '维护组 · 老周';

/** 首次对账需要失败的次数（之后再请求即成功） */
const REQUIRED_FAILURES = 1;
const FETCH_DELAY_MS = 600;

/** 维护组通告携带的维修窗口（稳定 ID，重复对账按 ID 覆盖，绝不删除本地登记行） */
export const BULLETIN_WINDOWS: MaintenanceWindow[] = [
  {
    id: 'mw-b-001',
    telescopeId: 'tel-003',
    date: '2025-10-11',
    startTime: '18:00',
    endTime: '06:00',
    reason: '赤道仪 CEM120 重涂防护层，整夜停机',
    registeredBy: '老周',
    source: 'bulletin',
    schemaVersion: 3,
  },
  {
    id: 'mw-b-002',
    telescopeId: 'tel-002',
    date: '2025-10-11',
    startTime: '21:00',
    endTime: '22:30',
    reason: '滤镜轮换轮异响检修，暂停上设备',
    registeredBy: '小吴',
    source: 'bulletin',
    schemaVersion: 3,
  },
  {
    id: 'mw-b-003',
    telescopeId: 'tel-001',
    date: '2025-10-11',
    startTime: '19:00',
    endTime: '20:00',
    reason: '导星接口例行除尘保养',
    registeredBy: '小吴',
    source: 'bulletin',
    schemaVersion: 3,
  },
  {
    id: 'mw-b-004',
    telescopeId: 'tel-003',
    date: '2025-10-12',
    startTime: '18:00',
    endTime: '06:00',
    reason: '防护层固化复检，连续第二夜停机',
    registeredBy: '老周',
    source: 'bulletin',
    schemaVersion: 3,
  },
  {
    id: 'mw-b-005',
    telescopeId: 'tel-001',
    date: '2025-10-12',
    startTime: '22:00',
    endTime: '02:00',
    reason: '主镜光轴校准与锁紧',
    registeredBy: '小吴',
    source: 'bulletin',
    schemaVersion: 3,
  },
];

/**
 * 拉取维护组通告（模拟网络对账）。
 * @param attempts 此前已尝试次数（0 表示首次对账）
 * @returns 通告携带的维修窗口
 * @throws 前 REQUIRED_FAILURES 次抛出「通告版本与本地不一致」对账失败
 */
export async function fetchMaintenanceBulletin(attempts: number): Promise<MaintenanceWindow[]> {
  await new Promise((resolve) => setTimeout(resolve, FETCH_DELAY_MS));
  if (attempts < REQUIRED_FAILURES) {
    throw new Error('通告版本与本地不一致，对账失败：编排台当日改动已原样保留，请重试只补维护侧');
  }
  // 返回副本，避免调用方误改夹具
  return BULLETIN_WINDOWS.map((window) => ({ ...window }));
}
