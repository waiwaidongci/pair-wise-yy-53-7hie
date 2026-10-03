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
  /**
   * 授权窗口版本号。每次对方/我方修改独占范围或排期都会递增。
   * 旧稿没有版本号（undefined），按原状态兼容，读取时统一用 windowRev 视为 0。
   */
  rev?: number
  /** 最近一次修改人/角色，用于提示“该窗口已被对方改过”。 */
  lastEditor?: string
  status: '草案' | '冲突' | '已确认'
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
