export type RightsType = '院线' | '电视' | '流媒体' | '航空' | '非院线'
export type Territory = '中国大陆' | '中国香港' | '中国台湾' | '新加坡' | '马来西亚' | '东南亚区域' | '北美'

export interface LicenseWindow {
  id: string
  workId: string
  work: string
  channel: string
  rights: RightsType
  territory: Territory
  start: string
  end: string
  exclusive: boolean
  sublicense: boolean
  priority: number
  status: '草案' | '冲突' | '已确认'
  /** 授权窗口当前版本，作为批量调窗提交时的乐观并发令牌；旧稿可能缺失，按原状态兼容。 */
  version: number
}

export type BatchItemStatus = '待生效' | '已生效' | '已挂起'
export type BatchStatus = '预览' | '已生效' | '部分生效' | '失败'

export interface BatchItem {
  windowId: string
  /** 生成预览时该授权窗口的版本（CAS 比对基准）。 */
  baseVersion: number
  /** 生成预览时该窗口的快照，用于预览展示与挂起时保留对方版本。 */
  baseSnapshot: LicenseWindow
  /** 预览预算的顺延结果。 */
  planned: LicenseWindow
  status: BatchItemStatus
  /** 挂起原因，例如对方已改过该窗口。 */
  reason?: string
}

export interface ShiftBatch {
  id: string
  kind: '批量调窗'
  status: BatchStatus
  days: number
  createdAt: string
  committedAt?: string
  items: BatchItem[]
}

export interface RightsComment {
  id: string
  channel: string
  anchor: string
  author: string
  role: string
  content: string
  resolved: boolean
}

export interface DraftVersion {
  id: string
  author: string
  time: string
  summary: string
  changes: string[]
}
