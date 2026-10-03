import type { LicenseWindow, ShiftBatch } from '@/lib/types'
import { initialWindows } from '@/lib/mock-data'
import { commitBatchItems, createBatchItems, deriveBatchStatus, newBatchId, windowVersion } from '@/lib/batches'

function seed(): LicenseWindow[] {
  return initialWindows.map((w) => ({ ...w, version: windowVersion(w) }))
}

interface ServerState {
  windows: LicenseWindow[]
  batches: ShiftBatch[]
}

const state: ServerState = { windows: seed(), batches: [] }

export const serverStore = {
  getWindows: () => state.windows,
  getBatches: () => state.batches,
  preview: (ids: string[], days: number): ShiftBatch => {
    const batch: ShiftBatch = {
      id: newBatchId(),
      kind: '批量调窗',
      status: '预览',
      days,
      createdAt: new Date().toISOString(),
      items: createBatchItems(state.windows, ids, days),
    }
    state.batches.push(batch)
    return batch
  },
  commit: (batchId: string, simulateFailure = false): ShiftBatch => {
    const batch = state.batches.find((b) => b.id === batchId)
    if (!batch) throw new Error('批次不存在')
    const outcome = commitBatchItems(state.windows, batch.items, batch.days, simulateFailure)
    state.windows = outcome.windows
    batch.items = outcome.items
    batch.status = deriveBatchStatus(outcome.items)
    batch.committedAt = new Date().toISOString()
    return batch
  },
  recover: (batchId: string): ShiftBatch => {
    const batch = state.batches.find((b) => b.id === batchId)
    if (!batch) throw new Error('批次不存在')
    if (batch.status === '已生效') return batch
    const outcome = commitBatchItems(state.windows, batch.items, batch.days, false)
    state.windows = outcome.windows
    batch.items = outcome.items
    batch.status = deriveBatchStatus(outcome.items)
    batch.committedAt = new Date().toISOString()
    return batch
  },
}
