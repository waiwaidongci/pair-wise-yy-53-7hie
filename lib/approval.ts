import { findConflicts, type ConflictIssue } from './rules'
import { summarizeBatch, type ShiftBatch } from './batch'
import type { LicenseWindow, RightsComment } from './types'

export interface ApprovalWindowLine {
  windowId: string
  work: string
  channel: string
  territory: string
  start: string
  end: string
  exclusive: boolean
  /** 旧稿没有版本号时输出“旧稿”，保持兼容可读。 */
  rev: number | '旧稿'
  lastEditor?: string
  status: LicenseWindow['status']
}

export interface ApprovalPackage {
  packageId: string
  exportedAt: string
  draftVersion: string
  /** 数据来源批次；无批次时为 null，表示按当前草案导出。 */
  generatedFromBatch: string | null
  batchStatus: ShiftBatch['items'][number]['status'] | null
  batchSummary: ReturnType<typeof summarizeBatch> | null
  windows: ApprovalWindowLine[]
  /** 冲突矩阵在导出瞬间按窗口当前版本重算，绝不沿用旧结果。 */
  conflicts: ConflictIssue[]
  pendingClauses: {
    windows: ApprovalWindowLine[]
    comments: { anchor: string; author: string; role: string; content: string }[]
  }
  /** 批次中被挂起/写入失败的笔随包留痕。 */
  suspended: { windowId: string; baseRev: number; conflictRev?: number; conflictBy?: string; reason?: string; status: string }[]
  approvable: boolean
  blockReason?: string
}

export function buildApprovalPackage(
  windows: LicenseWindow[],
  comments: RightsComment[],
  draftVersion: number,
  latestBatch: ShiftBatch | null,
): ApprovalPackage {
  // 关键：任何导出都在当前窗口版本上重算冲突，旧批次预览里的冲突不会被带入。
  const conflicts = findConflicts(windows)
  const summary = latestBatch ? summarizeBatch(latestBatch) : null
  const unresolvedComments = comments
    .filter((item) => !item.resolved)
    .map((item) => ({ anchor: item.anchor, author: item.author, role: item.role, content: item.content }))

  const toLine = (win: LicenseWindow): ApprovalWindowLine => ({
    windowId: win.id,
    work: win.work,
    channel: win.channel,
    territory: win.territory,
    start: win.start,
    end: win.end,
    exclusive: win.exclusive,
    rev: typeof win.rev === 'number' ? win.rev : '旧稿',
    lastEditor: win.lastEditor,
    status: win.status,
  })

  const pendingWindows = windows
    .filter((win) => win.status !== '已确认')
    .map(toLine)
  const suspended = latestBatch
    ? latestBatch.items
        .filter((item) => item.status === '已挂起' || item.status === '写入失败')
        .map((item) => ({
          windowId: item.windowId,
          baseRev: item.baseRev,
          conflictRev: item.conflictRev,
          conflictBy: item.conflictBy,
          reason: item.reason,
          status: item.status,
        }))
    : []

  const hasHighConflict = conflicts.some((issue) => issue.severity === '高')
  const hasUnfinishedBatch = !!summary && (summary.failed > 0 || summary.pending > 0)
  const approvable = !hasHighConflict && !hasUnfinishedBatch
  const blockReason = hasUnfinishedBatch
    ? '最新调窗批次存在写入失败或待提交窗口，请先恢复并处理挂起笔。'
    : hasHighConflict
      ? '仍存在高优先级独占/倒挂冲突，不能进入只读审批。'
      : undefined

  return {
    packageId: `APR-${Date.now().toString(36).toUpperCase()}`,
    exportedAt: new Date().toISOString(),
    draftVersion: `v${draftVersion}`,
    generatedFromBatch: latestBatch?.id ?? null,
    batchStatus: latestBatch ? latestBatch.items.find((item) => item.status !== '已生效')?.status ?? '已生效' : null,
    batchSummary: summary,
    windows: windows.map(toLine),
    conflicts,
    pendingClauses: { windows: pendingWindows, comments: unresolvedComments },
    suspended,
    approvable,
    blockReason,
  }
}

/** 供“待决条款”列表使用：标注每个窗口在最新批次中的处置。 */
export function windowBatchState(batch: ShiftBatch | null, windowId: string): string | null {
  const item = batch?.items.find((entry) => entry.windowId === windowId)
  if (!item || item.status === '待提交') return null
  return item.status
}
