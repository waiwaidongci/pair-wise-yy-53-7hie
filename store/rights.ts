import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { LicenseWindow, RightsComment } from '@/lib/types'
import { initialComments, initialWindows } from '@/lib/mock-data'
import { findConflicts } from '@/lib/rules'
import {
  applyShiftBatch,
  cancelBatch,
  createShiftBatch,
  rebaseSuspended,
  resumeShiftBatch,
  type CommitResult,
  type ShiftBatch,
} from '@/lib/batch'

/** 当前操作席位；模拟发行部 / 法务两份草案同时在改。 */
export type Role = '发行部' | '法务'

interface RightsState {
  windows: LicenseWindow[]
  comments: RightsComment[]
  selectedWindowId: string
  selectedTerritory: string
  version: number
  role: Role
  /** 最新一个可恢复批次（冲突矩阵、待决条款、审批包都以它为准）。 */
  latestBatch: ShiftBatch | null
  /** 历次批次留痕，审批包可追溯。 */
  batchHistory: ShiftBatch[]
  batchSeq: number
  setRole: (role: Role) => void
  updateWindow: (id: string, patch: Partial<LicenseWindow>) => void
  /** 用授权窗口当前版本生成调窗预览批次。 */
  prepareBatch: (ids: string[], days: number) => ShiftBatch
  /** 提交批次；同一授权窗口已被改过则挂起，写入失败可恢复。可指定历史批次 id。 */
  commitBatch: (failWindowId?: string, batchId?: string) => CommitResult
  /** 写入失败后继续剩余窗口，已生效窗口不重复顺延。 */
  resumeBatch: (failWindowId?: string, batchId?: string) => CommitResult
  /** 以对方最新版本重新生成挂起笔的预览，再次提交。 */
  rebaseBatch: () => void
  cancelLatestBatch: () => void
  acceptComment: (id: string) => void
  selectWindow: (id: string) => void
  reset: () => void
}

function bump(win: LicenseWindow, role: Role, patch: Partial<LicenseWindow>): LicenseWindow {
  return {
    ...win,
    ...patch,
    rev: (typeof win.rev === 'number' ? win.rev : 0) + 1,
    lastEditor: role,
    // 与旧流程一致：改动排期/独占回到草案，校验保存时由 patch.status 覆盖；
    // 旧稿没有版本号时首次保存即获得 rev，状态仍按原规则流转。
    status: patch.status ?? '草案',
  }
}

export const useRightsStore = create<RightsState>()(
  persist(
    (set, get) => {
      const finish = (result: CommitResult) =>
        set((state) => ({
          windows: result.windows,
          latestBatch: result.batch,
          batchHistory: [result.batch, ...state.batchHistory.filter((b) => b.id !== result.batch.id)],
          version: state.version + 1,
        }))

      return {
        windows: initialWindows,
        comments: initialComments,
        selectedWindowId: 'RW-102',
        selectedTerritory: '全部地区',
        version: 18,
        role: '发行部',
        latestBatch: null,
        batchHistory: [],
        batchSeq: 0,
        setRole: (role) => set({ role }),
        updateWindow: (id, patch) =>
          set((state) => ({
            windows: state.windows.map((item) =>
              item.id === id ? bump(item, state.role, patch) : item,
            ),
            version: state.version + 1,
          })),
        prepareBatch: (ids, days) => {
          const state = get()
          const seq = state.batchSeq + 1
          const batch = createShiftBatch(
            state.windows,
            ids.map((windowId) => ({ windowId, days })),
            state.role,
            seq,
          )
          set((state) => ({
            latestBatch: batch,
            batchSeq: seq,
            batchHistory: [batch, ...state.batchHistory],
          }))
          return batch
        },
        commitBatch: (failWindowId, batchId) => {
          const state = get()
          const target = state.batchHistory.find((b) => b.id === batchId) ?? state.latestBatch
          if (!target) throw new Error('没有可提交的调窗批次')
          const result = applyShiftBatch(state.windows, target, {
            author: state.role,
            failWindowId,
          })
          finish(result)
          return result
        },
        resumeBatch: (failWindowId, batchId) => {
          const state = get()
          const target = state.batchHistory.find((b) => b.id === batchId) ?? state.latestBatch
          if (!target) throw new Error('没有可恢复的调窗批次')
          const result = resumeShiftBatch(state.windows, target, {
            author: state.role,
            failWindowId,
          })
          finish(result)
          return result
        },
        rebaseBatch: () =>
          set((state) =>
            state.latestBatch
              ? { latestBatch: rebaseSuspended(state.windows, state.latestBatch) }
              : {},
          ),
        cancelLatestBatch: () =>
          set((state) =>
            state.latestBatch ? { latestBatch: cancelBatch(state.latestBatch) } : {},
          ),
        acceptComment: (id) =>
          set((state) => ({
            comments: state.comments.map((item) =>
              item.id === id ? { ...item, resolved: true } : item,
            ),
            version: state.version + 1,
          })),
        selectWindow: (id) => set({ selectedWindowId: id }),
        reset: () =>
          set({
            windows: initialWindows,
            comments: initialComments,
            version: 18,
            role: '发行部',
            latestBatch: null,
            batchHistory: [],
            batchSeq: 0,
          }),
      }
    },
    {
      // 改用 v2 存储键：旧稿（v1 本地缓存）没有窗口版本号与批次结构，
      // 不会被误合并；无版本号的初始数据仍按原状态在新结构中兼容运行。
      name: 'yy53-rights-draft-v2',
      version: 2,
      merge: (persisted, current) =>
        persisted && typeof persisted === 'object'
          ? { ...current, ...(persisted as Partial<RightsState>) }
          : current,
    },
  ),
)

export function useConflicts() {
  const windows = useRightsStore((state) => state.windows)
  return findConflicts(windows)
}
