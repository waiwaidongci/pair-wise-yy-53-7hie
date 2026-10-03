import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { LicenseWindow, RightsComment, ShiftBatch } from '@/lib/types'
import { initialComments, initialWindows } from '@/lib/mock-data'
import { findConflicts } from '@/lib/rules'
import { commitBatchItems, createBatchItems, deriveBatchStatus, newBatchId, windowVersion } from '@/lib/batches'

interface RightsState {
  windows: LicenseWindow[]
  comments: RightsComment[]
  batches: ShiftBatch[]
  latestBatchId: string | null
  selectedWindowId: string
  selectedTerritory: string
  version: number
  updateWindow: (id: string, patch: Partial<LicenseWindow>) => void
  createBatchPreview: (ids: string[], days: number) => string
  commitBatch: (batchId: string, simulateFailure?: boolean) => void
  recoverBatch: (batchId: string) => void
  simulateConcurrentCommit: (ids: string[], days: number) => void
  acceptComment: (id: string) => void
  selectWindow: (id: string) => void
  reset: () => void
}

/** 旧稿兼容：补齐缺失的窗口版本号（视为初始版本 1）。 */
function normalizeWindows(windows: LicenseWindow[]): LicenseWindow[] {
  return windows.map((w) => ({ ...w, version: windowVersion(w) }))
}

export const useRightsStore = create<RightsState>()(
  persist(
    (set) => ({
      windows: normalizeWindows(initialWindows),
      comments: initialComments,
      batches: [],
      latestBatchId: null,
      selectedWindowId: 'RW-102',
      selectedTerritory: '全部地区',
      version: 18,
      updateWindow: (id, patch) =>
        set((state) => ({
          windows: state.windows.map((item) =>
            item.id === id ? { ...item, ...patch, version: windowVersion(item) + 1, status: '草案' } : item,
          ),
          version: state.version + 1,
        })),
      createBatchPreview: (ids, days) => {
        const id = newBatchId()
        set((state) => {
          const batch: ShiftBatch = {
            id,
            kind: '批量调窗',
            status: '预览',
            days,
            createdAt: new Date().toISOString(),
            items: createBatchItems(state.windows, ids, days),
          }
          return { batches: [...state.batches, batch], latestBatchId: id }
        })
        return id
      },
      commitBatch: (batchId, simulateFailure = false) =>
        set((state) => {
          const batch = state.batches.find((b) => b.id === batchId)
          if (!batch) return state
          const outcome = commitBatchItems(state.windows, batch.items, batch.days, simulateFailure)
          const updated: ShiftBatch = {
            ...batch,
            items: outcome.items,
            status: deriveBatchStatus(outcome.items),
            committedAt: new Date().toISOString(),
          }
          return {
            windows: outcome.windows,
            batches: state.batches.map((b) => (b.id === batchId ? updated : b)),
            latestBatchId: batchId,
            version: state.version + 1,
          }
        }),
      recoverBatch: (batchId) =>
        set((state) => {
          const batch = state.batches.find((b) => b.id === batchId)
          if (!batch || batch.status === '已生效') return state
          const outcome = commitBatchItems(state.windows, batch.items, batch.days, false)
          const updated: ShiftBatch = {
            ...batch,
            items: outcome.items,
            status: deriveBatchStatus(outcome.items),
            committedAt: new Date().toISOString(),
          }
          return {
            windows: outcome.windows,
            batches: state.batches.map((b) => (b.id === batchId ? updated : b)),
            latestBatchId: batchId,
            version: state.version + 1,
          }
        }),
      // 模拟发行部与法务同时基于同一版本提交两笔批次：在同一个原子 set 内先后做 CAS，
      // 第一笔生效后版本号 +1，第二笔因版本不一致被挂起，从而“只允许一笔生效”。
      simulateConcurrentCommit: (ids, days) => {
        const idA = newBatchId()
        const idB = newBatchId()
        set((state) => {
          const itemsA = createBatchItems(state.windows, ids, days)
          const itemsB = createBatchItems(state.windows, ids, days)
          const outcomeA = commitBatchItems(state.windows, itemsA, days, false)
          const outcomeB = commitBatchItems(outcomeA.windows, itemsB, days, false)
          const now = new Date().toISOString()
          const batchA: ShiftBatch = { id: idA, kind: '批量调窗', status: deriveBatchStatus(outcomeA.items), days, createdAt: now, committedAt: now, items: outcomeA.items }
          const batchB: ShiftBatch = { id: idB, kind: '批量调窗', status: deriveBatchStatus(outcomeB.items), days, createdAt: now, committedAt: now, items: outcomeB.items }
          return {
            windows: outcomeB.windows,
            batches: [...state.batches, batchA, batchB],
            latestBatchId: idB,
            version: state.version + 1,
          }
        })
      },
      acceptComment: (id) =>
        set((state) => ({
          comments: state.comments.map((item) => (item.id === id ? { ...item, resolved: true } : item)),
          version: state.version + 1,
        })),
      selectWindow: (id) => set({ selectedWindowId: id }),
      reset: () =>
        set({
          windows: normalizeWindows(initialWindows),
          comments: initialComments,
          batches: [],
          latestBatchId: null,
          version: 18,
        }),
    }),
    {
      name: 'yy53-rights-draft-v1',
      version: 1,
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<RightsState>
        return {
          ...current,
          ...p,
          windows: normalizeWindows(p.windows ?? current.windows),
          batches: p.batches ?? [],
          latestBatchId: p.latestBatchId ?? null,
        }
      },
    },
  ),
)

export function useConflicts() {
  const windows = useRightsStore((state) => state.windows)
  return findConflicts(windows)
}

export function useLatestBatch() {
  return useRightsStore((state) => {
    const latest = state.batches.find((b) => b.id === state.latestBatchId)
    return latest ?? (state.batches.length ? state.batches[state.batches.length - 1]! : null)
  })
}
