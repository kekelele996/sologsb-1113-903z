/** 维修窗口来源：维护组通告读入 或 维护组在本机登记 */
export type MaintenanceSource = 'bulletin' | 'local';

/** 维修窗口（维护组持有，编排端只读，不能改、不能抹） */
export interface MaintenanceWindow {
  id: string;
  /** 望远镜 ID */
  telescopeId: string;
  /** 所属观测夜日期 YYYY-MM-DD（与观测夜 date 对齐：窗口从该日傍晚 18:00 起算，可跨零点到次日凌晨） */
  date: string;
  /** 开始时刻 HH:mm（夜间时间轴，通常 >= 18:00） */
  startTime: string;
  /** 结束时刻 HH:mm（可跨零点） */
  endTime: string;
  /** 维护事项 */
  reason: string;
  /** 登记人（维护组） */
  registeredBy: string;
  /** 数据来源：bulletin=维护组通告读入，local=维护组本机登记 */
  source: MaintenanceSource;
  schemaVersion: number;
}

/** 维护组通告读入（对账）状态 */
export type MaintenanceSyncStatus = '未读入' | '读入失败' | '已读入';

/** 对账状态记录（meta 表，JSON 存储） */
export interface MaintenanceSyncMeta {
  /** 业务状态 */
  status: MaintenanceSyncStatus;
  /** 最近一次尝试时间（ISO 字符串） */
  attemptedAt?: string;
  /** 最近一次成功读入时间 */
  succeededAt?: string;
  /** 已尝试次数（首次对账失败后重试，只补维护侧） */
  attempts: number;
  /** 成功读入的通告期号 */
  bulletinId?: string;
  /** 通告签发时间 */
  bulletinIssuedAt?: string;
  /** 失败原因 */
  lastError?: string;
}

/** 值班裁定结果：维护优先（维持停机）或编排优先（排程段改期到备用夜） */
export type RulingVerdict = '维护优先' | '编排优先';

/** 值班人裁定记录：只属于设备分配视图，绝不回写排程段或维修窗口 */
export interface RulingRecord {
  id: string;
  /** 观测夜 ID */
  nightId: string;
  /** 望远镜 ID */
  telescopeId: string;
  /** 维修窗口 ID */
  windowId: string;
  /** 与之冲突的排程段 ID */
  sessionId: string;
  /** 裁定结果 */
  verdict: RulingVerdict;
  /** 值班人 */
  dutyOfficer: string;
  /** 裁定说明 */
  note?: string;
  /** 裁定时间（ISO 字符串） */
  ruledAt: string;
  schemaVersion: number;
}

export const MAINTENANCE_SOURCES: MaintenanceSource[] = ['bulletin', 'local'];
export const RULING_VERDICTS: RulingVerdict[] = ['维护优先', '编排优先'];

export const DEFAULT_MAINTENANCE_SYNC: MaintenanceSyncMeta = {
  status: '未读入',
  attempts: 0,
};
