import { initTRPC } from '@trpc/server'
import { z } from 'zod'
import { initialComments } from '@/lib/mock-data'
import { findConflicts } from '@/lib/rules'
import { serverStore } from './store'

const t = initTRPC.create()
const windowInput = z.object({
  channel: z.string().min(2),
  start: z.string().date(),
  end: z.string().date(),
  exclusive: z.boolean(),
})
const batchItemInput = z.object({ ids: z.array(z.string()).min(1), days: z.number() })

export const appRouter = t.router({
  catalog: t.procedure.query(() => ({ works: ['W-001', 'W-002'], channels: ['星海影院', '云帆视频', '南华卫视', '海岛航空', '环球新媒体'] })),
  windows: t.procedure.query(() => serverStore.getWindows()),
  conflicts: t.procedure.query(() => findConflicts(serverStore.getWindows())),
  batches: t.procedure.query(() => serverStore.getBatches()),
  validateWindow: t.procedure.input(windowInput).mutation(({ input }) => {
    if (new Date(input.end) < new Date(input.start)) return { valid: false, message: '窗口结束日期不能早于开始日期。' }
    const collision = serverStore.getWindows().find((item) => item.channel === input.channel && input.start <= item.end && item.start <= input.end)
    return collision ? { valid: false, message: `与现有窗口 ${collision.id} 重叠，请调整窗口或明确优先级。` } : { valid: true, message: '窗口结构校验通过。' }
  }),
  batchPreview: t.procedure.input(batchItemInput).mutation(({ input }) => serverStore.preview(input.ids, input.days)),
  batchCommit: t.procedure.input(z.object({ batchId: z.string(), simulateFailure: z.boolean().optional() })).mutation(({ input }) => serverStore.commit(input.batchId, input.simulateFailure ?? false)),
  batchRecover: t.procedure.input(z.object({ batchId: z.string() })).mutation(({ input }) => serverStore.recover(input.batchId)),
  comments: t.procedure.query(() => initialComments),
})

export type AppRouter = typeof appRouter
