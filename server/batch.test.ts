import { test } from 'node:test'
import assert from 'node:assert/strict'
import { initialWindows } from '../lib/mock-data'
import type { LicenseWindow } from '../lib/types'
import {
  applyShiftBatch,
  createShiftBatch,
  deriveBatchStatus,
  rebaseSuspended,
  resumeShiftBatch,
  windowRev,
} from '../lib/batch'
import { buildApprovalPackage } from '../lib/approval'
import { initialComments } from '../lib/mock-data'
import { findConflicts } from '../lib/rules'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// 给窗口初始化版本号，模拟“有版本”的在途草案；保留一部分无 rev 窗口模拟旧稿
function seeded(): LicenseWindow[] {
  const wins = clone(initialWindows)
  for (const win of wins) {
    if (win.id !== 'RW-105') win.rev = 3 // RW-105 保持无 rev，旧稿兼容
  }
  return wins
}

test('预览基于授权窗口当前版本生成，提交前不改动窗口', () => {
  const wins = seeded()
  const batch = createShiftBatch(wins, [{ windowId: 'RW-101', days: 7 }, { windowId: 'RW-103', days: 14 }], '发行部', 1)
  assert.equal(batch.items.length, 2)
  assert.equal(batch.items[0]!.baseRev, 3)
  assert.equal(batch.items[0]!.preview.start, '2026-10-25')
  assert.equal(batch.items[0]!.status, '待提交')
  // 原窗口未被改动
  assert.equal(wins.find((w) => w.id === 'RW-101')!.start, '2026-10-18')
})

test('提交时窗口已被对方改过：保留对方版本，该笔挂起，批次继续后续窗口', () => {
  const wins = seeded()
  const batch = createShiftBatch(wins, [{ windowId: 'RW-101', days: 7 }, { windowId: 'RW-103', days: 14 }], '发行部', 1)

  // 法务先改了 RW-101 的独占范围（版本 3 -> 4）
  const concurrent = wins.map((w) => w.id === 'RW-101' ? { ...w, exclusive: false, rev: 4, lastEditor: '法务' } : w)

  const result = applyShiftBatch(concurrent, batch, { author: '发行部' })
  assert.deepEqual(result.applied, ['RW-103'])
  assert.deepEqual(result.parked, ['RW-101'])

  const rw101 = result.windows.find((w) => w.id === 'RW-101')!
  assert.equal(rw101.rev, 4) // 对方版本保留
  assert.equal(rw101.exclusive, false)
  assert.equal(rw101.start, '2026-10-18') // 没有被顺延覆盖
  assert.equal(rw101.lastEditor, '法务')

  const rw103 = result.windows.find((w) => w.id === 'RW-103')!
  assert.equal(rw103.rev, 4)
  assert.equal(rw103.start, '2027-01-22') // 后续窗口照常生效
  assert.equal(deriveBatchStatus(result.batch), '有挂起')
})

test('两笔同时提交同一版本：只允许一笔生效，另一笔挂起', () => {
  const wins = seeded()
  // 两个基于同一版本的批次（发行部、法务各一笔，顺延天数不同）
  const a = createShiftBatch(wins, [{ windowId: 'RW-102', days: 7 }], '发行部', 1)
  const b = createShiftBatch(wins, [{ windowId: 'RW-102', days: 14 }], '法务', 2)

  const first = applyShiftBatch(wins, a, { author: '发行部' })
  assert.deepEqual(first.applied, ['RW-102'])
  assert.equal(first.windows.find((w) => w.id === 'RW-102')!.start, '2026-11-27')

  const second = applyShiftBatch(first.windows, b, { author: '法务' })
  assert.deepEqual(second.applied, [])
  assert.deepEqual(second.parked, ['RW-102'])
  const rw102 = second.windows.find((w) => w.id === 'RW-102')!
  assert.equal(rw102.start, '2026-11-27') // 先发的 +7 天保留，后发的 +14 天未覆盖
  assert.equal(rw102.lastEditor, '发行部')
  assert.equal(second.batch.items[0]!.conflictRev, 4)

  // 后发笔按对方版本重订后可再次提交
  const rebased = rebaseSuspended(second.windows, second.batch)
  assert.equal(rebased.items[0]!.baseRev, 4)
  assert.equal(rebased.items[0]!.preview.start, '2026-12-11')
  const retried = applyShiftBatch(second.windows, rebased, { author: '法务' })
  assert.deepEqual(retried.applied, ['RW-102'])
})

test('写入失败后恢复：继续剩余窗口，已生效窗口不重复顺延', () => {
  const wins = seeded()
  const batch = createShiftBatch(wins, [
    { windowId: 'RW-101', days: 7 },
    { windowId: 'RW-102', days: 7 },
    { windowId: 'RW-103', days: 7 },
  ], '发行部', 1)

  // 第二笔写入失败
  const failed = applyShiftBatch(wins, batch, { author: '发行部', failWindowId: 'RW-102' })
  assert.deepEqual(failed.applied, ['RW-101'])
  assert.ok(failed.failed)
  assert.equal(failed.failed!.windowId, 'RW-102')
  assert.equal(deriveBatchStatus(failed.batch), '待恢复')
  // 第三笔尚未处理
  assert.equal(failed.windows.find((w) => w.id === 'RW-103')!.start, '2027-01-08')

  // 恢复（不再注入失败）
  const resumed = resumeShiftBatch(failed.windows, failed.batch, { author: '发行部' })
  assert.deepEqual(resumed.applied, ['RW-102', 'RW-103'])
  assert.equal(deriveBatchStatus(resumed.batch), '全部生效')

  // 已生效的 RW-101 没有再次 +7
  assert.equal(resumed.windows.find((w) => w.id === 'RW-101')!.start, '2026-10-25')
  assert.equal(resumed.windows.find((w) => w.id === 'RW-101')!.end, '2026-12-12')
  assert.equal(resumed.windows.find((w) => w.id === 'RW-102')!.start, '2026-11-27')
  assert.equal(resumed.windows.find((w) => w.id === 'RW-103')!.start, '2027-01-15')
})

test('恢复期间对方又改了后续窗口：恢复继续，冲突笔挂起且不重复顺延已生效窗口', () => {
  const wins = seeded()
  const batch = createShiftBatch(wins, [
    { windowId: 'RW-101', days: 7 },
    { windowId: 'RW-102', days: 7 },
  ], '发行部', 1)

  const failed = applyShiftBatch(wins, batch, { author: '发行部', failWindowId: 'RW-102' })
  // 恢复前法务改了 RW-102
  const changed = failed.windows.map((w) => w.id === 'RW-102' ? { ...w, exclusive: false, rev: 4, lastEditor: '法务' } : w)
  const resumed = resumeShiftBatch(changed, failed.batch, { author: '发行部' })
  assert.deepEqual(resumed.applied, [])
  assert.deepEqual(resumed.parked, ['RW-102'])
  assert.equal(resumed.windows.find((w) => w.id === 'RW-101')!.start, '2026-10-25') // 不重复顺延
  assert.equal(resumed.windows.find((w) => w.id === 'RW-102')!.exclusive, false)
})

test('冲突矩阵始终按窗口当前版本重算，而不是批次预览', () => {
  const wins = seeded()
  // 顺延 60 天后 RW-101 离开 RW-102 独占期、改与 RW-103 交叠，矩阵内容必然变化
  const batch = createShiftBatch(wins, [{ windowId: 'RW-101', days: 60 }], '发行部', 1)
  const staleMatrix = findConflicts(wins) // 旧稿/旧批次的冲突结果
  const result = applyShiftBatch(wins, batch, { author: '发行部' })
  const liveMatrix = findConflicts(result.windows)
  assert.notDeepEqual(liveMatrix, staleMatrix)
  // 顺延后矩阵条目随新排期变化：新增 RW-101 与 RW-103 的交叠提示
  const ids = (list: typeof liveMatrix) => list.map((issue) => issue.id).sort()
  assert.deepEqual(ids(liveMatrix), ['RW-101-RW-102-EX', 'RW-101-RW-103-NEX', 'RW-102-RW-103-NEX'])
  assert.deepEqual(ids(staleMatrix), ['RW-101-RW-102-EX', 'RW-102-RW-103-NEX'])

  // 挂起场景：对方解除 RW-101 独占，矩阵反映对方版本而非我方预览
  const wins2 = seeded()
  const batch2 = createShiftBatch(wins2, [{ windowId: 'RW-101', days: 7 }], '发行部', 1)
  const concurrent = wins2.map((w) => w.id === 'RW-101' ? { ...w, exclusive: false, rev: 4, lastEditor: '法务' } : w)
  const parked = applyShiftBatch(concurrent, batch2, { author: '发行部' })
  const matrix = findConflicts(parked.windows)
  assert.ok(!matrix.some((issue) => issue.windowIds.includes('RW-101') && issue.type === '独占冲突' && issue.severity === '高'))
})

test('旧稿没有版本号时按原状态兼容：可挂单、生效后得到 rev=1 且状态仍为草案', () => {
  const wins = seeded()
  const old = wins.find((w) => w.id === 'RW-105')!
  assert.equal(old.rev, undefined)
  assert.equal(windowRev(old), 0)
  const batch = createShiftBatch(wins, [{ windowId: 'RW-105', days: 7 }], '发行部', 1)
  assert.equal(batch.items[0]!.baseRev, 0)
  const result = applyShiftBatch(wins, batch, { author: '发行部' })
  const updated = result.windows.find((w) => w.id === 'RW-105')!
  assert.equal(updated.rev, 1)
  assert.equal(updated.status, '草案')
  assert.equal(updated.start, '2027-01-22')
})

test('审批包按最新批次与窗口当前版本导出，旧冲突结果不会被带入', () => {
  const wins = seeded()
  const batch = createShiftBatch(wins, [{ windowId: 'RW-101', days: 7 }, { windowId: 'RW-103', days: 14 }], '发行部', 1)
  const concurrent = wins.map((w) => w.id === 'RW-101' ? { ...w, exclusive: false, rev: 4, lastEditor: '法务' } : w)
  const result = applyShiftBatch(concurrent, batch, { author: '发行部' })

  const pkg = buildApprovalPackage(result.windows, initialComments, 19, result.batch)
  assert.equal(pkg.generatedFromBatch, result.batch.id)
  assert.equal(pkg.batchSummary?.parked, 1)
  assert.equal(pkg.suspended[0]!.windowId, 'RW-101')
  assert.equal(pkg.suspended[0]!.conflictRev, 4)
  // 冲突是导出瞬间现算的
  assert.deepEqual(pkg.conflicts, findConflicts(result.windows))
  // 窗口行带当前版本与旧稿标记
  assert.equal(pkg.windows.find((w) => w.windowId === 'RW-101')!.rev, 4)
  assert.equal(pkg.windows.find((w) => w.windowId === 'RW-105')!.rev, '旧稿')
})

test('批次存在写入失败时审批包标记不可审批', () => {
  const wins = seeded()
  const batch = createShiftBatch(wins, [{ windowId: 'RW-101', days: 7 }, { windowId: 'RW-102', days: 7 }], '发行部', 1)
  const failed = applyShiftBatch(wins, batch, { author: '发行部', failWindowId: 'RW-102' })
  const pkg = buildApprovalPackage(failed.windows, initialComments, 19, failed.batch)
  assert.equal(pkg.approvable, false)
  assert.match(pkg.blockReason ?? '', /恢复/)
})
