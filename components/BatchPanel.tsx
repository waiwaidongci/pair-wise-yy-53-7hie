'use client'

import {
  Badge,
  Box,
  Button,
  Flex,
  Heading,
  HStack,
  Select,
  Table,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tr,
  useToast,
} from '@chakra-ui/react'
import { useRightsStore, type Role } from '@/store/rights'
import { deriveBatchStatus, revLabel, summarizeBatch, type BatchItem, type ShiftBatch } from '@/lib/batch'

const statusColor: Record<BatchItem['status'], string> = {
  待提交: 'gray',
  已生效: 'green',
  已挂起: 'orange',
  写入失败: 'red',
  已取消: 'gray',
}

const batchStatusColor: Record<string, string> = {
  预览: 'blue',
  部分生效: 'teal',
  全部生效: 'green',
  待恢复: 'red',
  有挂起: 'orange',
  已取消: 'gray',
}

function BatchRows({ batch, windows }: { batch: ShiftBatch; windows: { id: string; channel: string; rev?: number; lastEditor?: string }[] }) {
  return (
    <Table size="sm" variant="simple">
      <Thead>
        <Tr>
          <Th>窗口</Th>
          <Th>顺延</Th>
          <Th>基准版本</Th>
          <Th>当前版本</Th>
          <Th>预览排期</Th>
          <Th>结果</Th>
        </Tr>
      </Thead>
      <Tbody>
        {batch.items.map((item) => {
          const live = windows.find((win) => win.id === item.windowId)
          return (
            <Tr key={item.windowId} opacity={item.status === '已取消' ? 0.45 : 1}>
              <Td>
                <Text fontWeight="600">{live?.channel ?? item.windowId}</Text>
                <Text fontSize="xs" color="gray.500">{item.windowId}</Text>
              </Td>
              <Td>{item.days > 0 ? `+${item.days}` : item.days} 天</Td>
              <Td>v{item.baseRev}{item.baseRev === 0 ? '（旧稿）' : ''}</Td>
              <Td>{live ? revLabel(live as Parameters<typeof revLabel>[0]) : '—'}{live?.lastEditor ? <Text fontSize="xs" color="gray.500">{live.lastEditor} 改</Text> : null}</Td>
              <Td>
                <Text fontSize="xs">{item.preview.start} → {item.preview.end}</Text>
                {item.reason && <Text fontSize="xs" color={item.status === '已挂起' ? 'orange.600' : 'red.600'} mt={1}>{item.reason}</Text>}
              </Td>
              <Td><Badge colorScheme={statusColor[item.status]}>{item.status}</Badge></Td>
            </Tr>
          )
        })}
      </Tbody>
    </Table>
  )
}

export function BatchPanel({ failWindowId, setFailWindowId }: { failWindowId: string; setFailWindowId: (value: string) => void }) {
  const windows = useRightsStore((state) => state.windows)
  const latestBatch = useRightsStore((state) => state.latestBatch)
  const batchHistory = useRightsStore((state) => state.batchHistory)
  const role = useRightsStore((state) => state.role)
  const commitBatch = useRightsStore((state) => state.commitBatch)
  const resumeBatch = useRightsStore((state) => state.resumeBatch)
  const rebaseBatch = useRightsStore((state) => state.rebaseBatch)
  const cancelLatestBatch = useRightsStore((state) => state.cancelLatestBatch)
  const toast = useToast()

  function report(result: ReturnType<typeof commitBatch>, resumed = false) {
    if (result.failed) {
      toast({ title: '写入已中断，批次可恢复', description: `${result.failed.windowId}：${result.failed.reason}`, status: 'error', duration: 6000 })
    } else {
      toast({
        title: resumed ? '恢复完成' : '批次已提交',
        description: `生效 ${result.applied.length} 笔，挂起 ${result.parked.length} 笔。挂起笔已保留对方版本。`,
        status: result.parked.length ? 'warning' : 'success',
      })
    }
  }

  const summary = latestBatch ? summarizeBatch(latestBatch) : null
  const pendingIds = latestBatch?.items.filter((item) => item.status === '待提交' || item.status === '写入失败').map((item) => item.windowId) ?? []

  return (
    <Box bg="white" border="1px solid" borderColor="gray.200" borderRadius="8px" p={4}>
      <Flex justify="space-between" align="center" mb={3}>
        <Box>
          <Heading size="md">可恢复调窗批次</Heading>
          <Text color="gray.500" fontSize="sm">预览基于授权窗口当前版本生成；提交时对席改过则挂起并保留对方版本，写入失败可从断点恢复。</Text>
        </Box>
        {latestBatch && summary && <Badge colorScheme={batchStatusColor[deriveBatchStatus(latestBatch)]} fontSize="sm" px={2} py={1}>{deriveBatchStatus(latestBatch)}</Badge>}
      </Flex>

      {!latestBatch && <Text color="gray.500" fontSize="sm">勾选窗口并点击“生成预览”后，这里会出现可复核、可恢复的批次。</Text>}

      {latestBatch && (
        <>
          <HStack fontSize="xs" color="gray.500" mb={2}>
            <Badge variant="outline">{latestBatch.id}</Badge>
            <Text>发起人：{latestBatch.author}</Text>
            <Text>排队序号：{latestBatch.seq}（同版本竞争时序号小者生效）</Text>
            <Text>生效 {summary?.applied} · 挂起 {summary?.parked} · 失败 {summary?.failed} · 待提交 {summary?.pending}</Text>
          </HStack>
          <Box overflowX="auto"><BatchRows batch={latestBatch} windows={windows} /></Box>

          <HStack mt={4} flexWrap="wrap" gap={2}>
            <Button
              size="sm"
              colorScheme="blue"
              isDisabled={summary?.pending === 0}
              onClick={() => report(commitBatch(failWindowId || undefined))}
            >
              提交批次
            </Button>
            <Button
              size="sm"
              colorScheme="red"
              variant="outline"
              isDisabled={!summary || summary.failed === 0}
              onClick={() => report(resumeBatch(failWindowId || undefined), true)}
            >
              恢复并继续剩余窗口
            </Button>
            <Button
              size="sm"
              colorScheme="orange"
              variant="outline"
              isDisabled={!summary || summary.parked === 0}
              onClick={() => { rebaseBatch(); toast({ title: '挂起笔已按对方最新版本重新生成预览', status: 'info' }) }}
            >
              按对方版本重订挂起笔
            </Button>
            <Button size="sm" variant="ghost" isDisabled={summary?.pending === 0 && !summary?.failed} onClick={cancelLatestBatch}>取消未生效笔</Button>
            <Box ml="auto">
              <HStack>
                <Text fontSize="xs" color="gray.500">模拟写入失败窗口：</Text>
                <Select size="xs" w="170px" value={failWindowId} onChange={(event) => setFailWindowId(event.target.value)}>
                  <option value="">（不注入失败）</option>
                  {pendingIds.map((id) => <option key={id} value={id}>{id} 下一笔失败</option>)}
                </Select>
              </HStack>
            </Box>
          </HStack>
          <Text fontSize="xs" color="gray.400" mt={2}>当前提交席位：{role}。可在右上角切换“法务”模拟对席先改独占范围。</Text>
        </>
      )}

      {batchHistory.length > 1 && (
        <Box mt={5}>
          <Heading size="xs" mb={2} color="gray.600">历史批次（可用于复现同版本并发提交）</Heading>
          {batchHistory.slice(1, 6).map((batch) => {
            const s = summarizeBatch(batch)
            const committable = s.pending > 0
            return (
              <Flex key={batch.id} justify="space-between" align="center" py={1.5} borderTop="1px solid" borderColor="gray.100">
                <HStack fontSize="xs">
                  <Badge variant="outline">{batch.id}</Badge>
                  <Text color="gray.500">{batch.author} · 序号 {batch.seq}</Text>
                  <Text color="gray.500">生效 {s.applied} / 挂起 {s.parked} / 待提交 {s.pending}</Text>
                </HStack>
                <Button
                  size="xs"
                  variant="outline"
                  isDisabled={!committable}
                  onClick={() => report(commitBatch(failWindowId || undefined, batch.id))}
                >
                  {committable ? '提交此批次（同版本竞争）' : deriveBatchStatus(batch)}
                </Button>
              </Flex>
            )
          })}
        </Box>
      )}
    </Box>
  )
}

export function RoleSwitch() {
  const role = useRightsStore((state) => state.role)
  const setRole = useRightsStore((state) => state.setRole)
  const options: Role[] = ['发行部', '法务']
  return (
    <HStack bg="white" border="1px solid" borderColor="gray.200" borderRadius="8px" p={1}>
      {options.map((value) => (
        <Button
          key={value}
          size="sm"
          variant={role === value ? 'solid' : 'ghost'}
          colorScheme={role === value ? (value === '法务' ? 'purple' : 'blue') : 'gray'}
          onClick={() => setRole(value)}
        >
          {value}席位
        </Button>
      ))}
    </HStack>
  )
}
