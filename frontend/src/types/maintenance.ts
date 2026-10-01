/** 排程段与维修窗口的牵制项：值班人裁定决定 */
export type AdjudicationDecision = '知悉保留' | '改期备用夜';

/**
 * 维修窗口（维护组登记的望远镜停机时段）。
 * 由维护组独立登记与维护，编排台只读、不可改动。
 */
export interface MaintenanceWindow {
  id: string;
  /** 望远镜 ID（哪台望远镜进维护） */
  telescopeId: string;
  /** 维护开始日期 YYYY-MM-DD（含） */
  startDate: string;
  /** 维护结束日期 YYYY-MM-DD（含） */
  endDate: string;
  /** 维护内容 / 原因 */
  reason: string;
  /** 登记人（维护组） */
  createdBy: string;
  /** 登记时间 ISO */
  createdAt: string;
}

/**
 * 牵制项裁定记录（值班人在设备分配视图上对「排程段 × 维修窗口」的处理结果）。
 * 裁定只记录决定，不直接抹掉任何一方的数据。
 */
export interface MaintenanceAdjudication {
  id: string;
  /** 排程段 ID */
  sessionId: string;
  /** 维修窗口 ID */
  windowId: string;
  /** 裁定决定 */
  decision: AdjudicationDecision;
  /** 裁定备注 */
  note?: string;
  /** 裁定人（值班人） */
  decidedBy: string;
  /** 裁定时间 ISO */
  decidedAt: string;
}

/** 排程段与维修窗口的牵制项（两边互相牵制，待值班人裁定） */
export interface MaintenanceConflict {
  /** 排程段 ID */
  sessionId: string;
  /** 维修窗口 ID */
  windowId: string;
  /** 观测夜 ID */
  nightId: string;
  /** 望远镜 ID */
  telescopeId: string;
  /** 排程段日期（观测夜日期 YYYY-MM-DD） */
  date: string;
  /** 排程段时段文案 HH:mm-HH:mm */
  sessionTime: string;
  /** 维修窗口文案（起止日期 + 原因） */
  windowText: string;
  /** 是否已裁定 */
  adjudicated: boolean;
  /** 裁定决定（已裁定时有值） */
  decision?: AdjudicationDecision;
}

export const ADJUDICATION_DECISIONS: AdjudicationDecision[] = ['知悉保留', '改期备用夜'];
