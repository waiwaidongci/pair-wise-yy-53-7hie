import type { LicenseWindow } from './types'
import { findConflicts, type ConflictIssue, shiftWindow } from './rules'

/** 读取窗口当前版本；旧稿没有版本号时按原状态兼容，视为第 0 版。 */
export function windowRev(win: LicenseWindow): number {
  return typeof win.rev === 'number' ? win.rev : 0
}

export function revLabel(win: LicenseWindow): string {
  return typeof win.rev === 'number' ? `v${win.rev}` : '旧稿'
}

/** 单笔调窗在批次中的生命周期。 */
export type BatchItemStatus =
  | '待提交' // 预览生成、尚未提交
  | '已生效' // 顺延已写入窗口
  | '已挂起' // 提交时发现同一授权窗口已被对方（或并发批次）改过，保留对方版本
  | '写入失败' // 写入失败，恢复时必须从这一笔继续
  | '已取消'

/** 批次整体状态（deriveBatchStatus 统一推导，保证“按最新批次显示”时口径一致）。 */
export type ShiftBatchStatus = '预览' | '部分生效' | '全部生效' | '待恢复' | '有挂起' | '已取消'

export interface BatchItem {
  windowId: string
  days: number
  /** 生成预览时该授权窗口的版本；提交时据此做乐观锁比较。 */
  baseRev: number
  /** 预览中的窗口形态（基于 baseRev 当前版本生成）。 */
  preview: LicenseWindow
  status: BatchItemStatus
  /** 已生效时保存写入后的窗口快照，恢复时跳过它，避免重复顺延。 */
  after?: LicenseWindow
  /** 挂起/失败时记录现场版本与原因，便于对席提示与重新挂单。 */
  conflictRev?: number
  conflictBy?: string
  reason?: string
}

export interface ShiftBatch {
  id: string
  createdAt: number
  author: string
  items: BatchItem[]
  /** 为同版本竞争提供确定性先后顺序：先排队的批次先生效。 */
  seq: number
}

export interface CommitOptions {
  /** 模拟写入失败的窗口 id（第一笔命中即失败并中断，之后可恢复）。 */
  failWindowId?: string
  author: string
}

export interface CommitResult {
  windows: LicenseWindow[]
  batch: ShiftBatch
  applied: string[]
  parked: string[]
  failed?: { windowId: string; reason: string }
}

/** 用授权窗口当前版本生成预览批次。旧稿无版本号也可正常挂单。 */
export function createShiftBatch(
  windows: LicenseWindow[],
  entries: { windowId: string; days: number }[],
  author: string,
  seq: number,
  now = Date.now(),
): ShiftBatch {
  return {
    id: `BATCH-${now.toString(36).toUpperCase()}-${seq}`,
    createdAt: now,
    author,
    seq,
    items: entries
      .filter((entry, index, all) => all.findIndex((e) => e.windowId === entry.windowId) === index)
      .map((entry) => {
        const win = windows.find((item) => item.id === entry.windowId)
        if (!win) throw new Error(`授权窗口 ${entry.windowId} 不存在，无法生成调窗预览`)
        return {
          windowId: entry.windowId,
          days: entry.days,
          baseRev: windowRev(win),
          preview: shiftWindow(win, entry.days),
          status: '待提交' as const,
        }
      }),
  }
}

function touch(win: LicenseWindow, author: string): LicenseWindow {
  return { ...win, rev: windowRev(win) + 1, lastEditor: author }
}

/**
 * 提交（或从中断处继续提交）一个可恢复批次。
 * 规则：
 *  - 顺序逐笔写入；同一授权窗口当前版本必须等于预览基准版本才允许生效；
 *  - 版本已变（对席刚改/另一笔先到）→ 保留对方版本，本笔挂起，批次继续后续窗口；
 *  - 两笔（或两个批次）同时提交同一版本 → 按 seq 确定性地只允许一笔生效，另一笔挂起；
 *  - 写入失败立即中断，已生效的不再处理，恢复时继续剩余窗口且不重复顺延。
 */
export function applyShiftBatch(
  windows: LicenseWindow[],
  batch: ShiftBatch,
  options: CommitOptions,
): CommitResult {
  const next = windows.map((item) => ({ ...item }))
  const items = batch.items.map((item) => ({ ...item }))
  const applied: string[] = []
  const parked: string[] = []
  let failed: CommitResult['failed']

  for (const item of items) {
    if (item.status === '已生效') continue // 恢复路径：已生效窗口跳过，绝不重复顺延

    if (item.status === '写入失败' || item.status === '待提交') {
      const index = next.findIndex((win) => win.id === item.windowId)
      if (index < 0) {
        item.status = '写入失败'
        item.reason = '授权窗口已不存在'
        failed = { windowId: item.windowId, reason: item.reason }
        break
      }
      const current = next[index]!
      const currentRev = windowRev(current)

      if (currentRev !== item.baseRev) {
        // 对席改过，或并发批次已抢先写入：保留对方版本，本笔挂起
        item.status = '已挂起'
        item.conflictRev = currentRev
        item.conflictBy = current.lastEditor
        item.reason = `授权窗口已从 v${item.baseRev} 变为 v${currentRev}（${current.lastEditor ?? '对席'} 修改），已保留对方版本`
        parked.push(item.windowId)
        continue
      }

      if (options.failWindowId === item.windowId) {
        item.status = '写入失败'
        item.reason = '写入失败（存储暂时不可用），请稍后恢复，已生效窗口不会重复顺延'
        failed = { windowId: item.windowId, reason: item.reason }
        break
      }

      const updated = touch({ ...item.preview, rev: item.baseRev }, options.author)
      next[index] = updated
      item.status = '已生效'
      item.after = updated
      item.reason = undefined
      applied.push(item.windowId)
    }
  }

  return { windows: next, batch: { ...batch, items }, applied, parked, failed }
}

/** 写入失败后的恢复：继续剩余窗口，已生效窗口不重复顺延。 */
export function resumeShiftBatch(
  windows: LicenseWindow[],
  batch: ShiftBatch,
  options: CommitOptions,
): CommitResult {
  return applyShiftBatch(windows, batch, options)
}

/**
 * 挂起重订：以对方新版本重新生成预览，供再次提交。
 * 已生效的笔保持不动；挂起笔的基准更新为当前版本。
 */
export function rebaseSuspended(
  windows: LicenseWindow[],
  batch: ShiftBatch,
): ShiftBatch {
  return {
    ...batch,
    items: batch.items.map((item) => {
      if (item.status !== '已挂起') return item
      const win = windows.find((w) => w.id === item.windowId)
      if (!win) return item
      return {
        ...item,
        baseRev: windowRev(win),
        preview: shiftWindow(win, item.days),
        status: '待提交',
        conflictRev: undefined,
        conflictBy: undefined,
        reason: undefined,
      }
    }),
  }
}

export function deriveBatchStatus(batch: ShiftBatch): ShiftBatchStatus {
  const list = batch.items
  if (list.every((item) => item.status === '已取消')) return '已取消'
  if (list.some((item) => item.status === '写入失败')) return '待恢复'
  if (list.every((item) => item.status === '已生效')) return '全部生效'
  if (list.some((item) => item.status === '已生效')) {
    return list.some((item) => item.status === '已挂起') ? '有挂起' : '部分生效'
  }
  if (list.some((item) => item.status === '已挂起')) return '有挂起'
  return '预览'
}

export interface BatchSummary {
  applied: number
  parked: number
  failed: number
  pending: number
  status: ShiftBatchStatus
}

export function summarizeBatch(batch: ShiftBatch): BatchSummary {
  const count = (status: BatchItemStatus) => batch.items.filter((item) => item.status === status).length
  return {
    applied: count('已生效'),
    parked: count('已挂起'),
    failed: count('写入失败'),
    pending: count('待提交'),
    status: deriveBatchStatus(batch),
  }
}

/** 取消批次中尚未生效/挂起的笔，已生效不可撤销。 */
export function cancelBatch(batch: ShiftBatch): ShiftBatch {
  return {
    ...batch,
    items: batch.items.map((item) =>
      item.status === '待提交' || item.status === '写入失败'
        ? { ...item, status: '已取消' as const, reason: '批次已取消' }
        : item,
    ),
  }
}

/** 冲突矩阵始终基于窗口当前版本重算；挂起笔额外给出“本批次仍挂起”的现场。 */
export function batchConflictView(windows: LicenseWindow[], batch: ShiftBatch): {
  issues: ConflictIssue[]
  generatedFrom: string
  parked: BatchItem[]
} {
  return {
    issues: findConflicts(windows),
    generatedFrom: batch.id,
    parked: batch.items.filter((item) => item.status === '已挂起' || item.status === '写入失败'),
  }
}
