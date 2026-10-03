import type { BatchItem, BatchStatus, LicenseWindow, ShiftBatch } from './types'
import { shiftWindow } from './rules'

/** 读取授权窗口版本；旧稿没有版本号时按原状态兼容，视为初始版本 1。 */
export function windowVersion(win: LicenseWindow): number {
  return typeof win.version === 'number' && Number.isFinite(win.version) ? win.version : 1
}

/** 以授权窗口当前版本为基准生成预览条目。 */
export function createBatchItems(windows: LicenseWindow[], ids: string[], days: number): BatchItem[] {
  return ids.map((id) => {
    const base = windows.find((w) => w.id === id)
    if (!base) throw new Error(`授权窗口 ${id} 不存在`)
    return {
      windowId: id,
      baseVersion: windowVersion(base),
      baseSnapshot: { ...base },
      planned: shiftWindow({ ...base }, days),
      status: '待生效',
    }
  })
}

export function deriveBatchStatus(items: BatchItem[]): BatchStatus {
  if (items.length === 0) return '预览'
  if (items.every((i) => i.status === '已生效')) return '已生效'
  if (items.some((i) => i.status === '待生效')) return '失败'
  return '部分生效'
}

export interface CommitOutcome {
  windows: LicenseWindow[]
  items: BatchItem[]
}

/**
 * 比较并交换（CAS）提交批次。
 *
 * - 已生效的条目直接跳过：恢复时不会对同一窗口重复顺延（幂等）。
 * - 窗口当前版本仍等于预览基准版本时才生效，版本号 +1。
 * - 窗口已被他人改过（版本不一致）时挂起该条目：保留对方版本，不覆盖。
 *
 * simulateFailure：首个窗口写入成功后即中断，剩余条目保持待生效，用于演示
 * “写入失败后恢复”的场景。
 */
export function commitBatchItems(
  windows: LicenseWindow[],
  items: BatchItem[],
  days: number,
  simulateFailure = false,
): CommitOutcome {
  let next = [...windows]
  let failed = false
  const nextItems: BatchItem[] = items.map((item): BatchItem => {
    if (item.status === '已生效') return { ...item }
    if (simulateFailure && failed) return { ...item }
    const current = next.find((w) => w.id === item.windowId)
    if (!current) return { ...item, status: '已挂起', reason: '授权窗口不存在' }
    if (windowVersion(current) !== item.baseVersion) {
      return {
        ...item,
        status: '已挂起',
        reason: `窗口已被他人修改（v${item.baseVersion} → v${windowVersion(current)}），保留对方版本`,
      }
    }
    next = next.map((w) =>
      w.id === item.windowId
        ? { ...shiftWindow(w, days), version: windowVersion(w) + 1, status: '草案' as const }
        : w,
    )
    if (simulateFailure) failed = true
    return { ...item, status: '已生效' }
  })
  return { windows: next, items: nextItems }
}

export function newBatchId(): string {
  return `B-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`
}

export function createBatch(ids: string[], days: number, windows: LicenseWindow[]): ShiftBatch {
  return {
    id: newBatchId(),
    kind: '批量调窗',
    status: '预览',
    days,
    createdAt: new Date().toISOString(),
    items: createBatchItems(windows, ids, days),
  }
}
