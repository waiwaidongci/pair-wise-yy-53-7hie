'use client'

import { useMemo, useState } from 'react'
import {
  Box, Flex, Grid, Heading, Text, Badge, Button, Input, Select, Checkbox, Table, Thead, Tbody, Tr, Th, Td,
  useToast, HStack, Modal, ModalOverlay, ModalContent, ModalHeader, ModalBody, ModalFooter, ModalCloseButton,
  FormControl, FormLabel, Switch,
} from '@chakra-ui/react'
import { useRightsStore, useConflicts, useLatestBatch } from '@/store/rights'
import type { Territory } from '@/lib/types'
import { windowVersion } from '@/lib/batches'

const territories: (Territory | '全部地区')[] = ['全部地区', '中国大陆', '中国香港', '中国台湾', '新加坡', '马来西亚', '北美']

const batchStatusColor: Record<string, string> = { 预览: 'gray', 已生效: 'green', 部分生效: 'orange', 失败: 'red' }
const itemStatusColor: Record<string, string> = { 待生效: 'gray', 已生效: 'green', 已挂起: 'orange' }

export default function WindowsPage() {
  const windows = useRightsStore((state) => state.windows)
  const updateWindow = useRightsStore((state) => state.updateWindow)
  const createBatchPreview = useRightsStore((state) => state.createBatchPreview)
  const commitBatch = useRightsStore((state) => state.commitBatch)
  const recoverBatch = useRightsStore((state) => state.recoverBatch)
  const simulateConcurrentCommit = useRightsStore((state) => state.simulateConcurrentCommit)
  const batches = useRightsStore((state) => state.batches)
  const latestBatch = useLatestBatch()
  const selectedWindowId = useRightsStore((state) => state.selectedWindowId)
  const selectWindow = useRightsStore((state) => state.selectWindow)
  const selectedTerritory = useRightsStore((state) => state.selectedTerritory)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [shiftDays, setShiftDays] = useState(7)
  const [previewBatchId, setPreviewBatchId] = useState<string | null>(null)
  const [simulateFailure, setSimulateFailure] = useState(false)
  const toast = useToast()
  const conflicts = useConflicts()
  const filtered = useMemo(() => selectedTerritory === '全部地区' ? windows : windows.filter((item) => item.territory === selectedTerritory), [windows, selectedTerritory])
  const selected = windows.find((item) => item.id === selectedWindowId)
  const previewBatch = batches.find((b) => b.id === previewBatchId) ?? null

  function validateAndSave() {
    if (!selected) return
    if (new Date(selected.end) < new Date(selected.start)) return toast({ title: '窗口无效', description: '结束日期不能早于开始日期。', status: 'error' })
    const collision = conflicts.find((issue) => issue.windowIds.includes(selected.id))
    updateWindow(selected.id, { status: collision ? '冲突' : '已确认' })
    toast({ title: collision ? '已保存，仍存在冲突' : '窗口已确认', description: collision?.explanation ?? '授权窗口已通过规则校验。', status: collision ? 'warning' : 'success' })
  }

  function requireSelection(): boolean {
    if (selectedIds.length) return true
    toast({ title: '请选择窗口', description: '先勾选需要批量调窗的授权窗口。', status: 'warning' })
    return false
  }

  function handlePreview() {
    if (!requireSelection()) return
    setPreviewBatchId(createBatchPreview(selectedIds, shiftDays))
  }

  function handleCommit() {
    if (!previewBatch) return
    commitBatch(previewBatch.id, simulateFailure)
    toast({ title: '批次已提交', description: '已按窗口当前版本比对生效；被他人改过的窗口已挂起并保留对方版本。', status: 'info' })
  }

  function handleConcurrent() {
    if (!requireSelection()) return
    simulateConcurrentCommit(selectedIds, shiftDays)
    toast({ title: '已模拟两笔并发提交', description: '两笔基于同一版本的批次只允许一笔生效，另一笔已挂起。', status: 'info' })
  }

  const appliedCount = previewBatch?.items.filter((i) => i.status === '已生效').length ?? 0
  const suspendedCount = previewBatch?.items.filter((i) => i.status === '已挂起').length ?? 0
  const pendingCount = previewBatch?.items.filter((i) => i.status === '待生效').length ?? 0

  return (
    <Box>
      <Flex justify="space-between" mb={5} gap={4} direction={{ base: 'column', md: 'row' }}><Box><Text color="brand.600" fontSize="xs" fontWeight="bold">TIME × TERRITORY</Text><Heading fontSize="3xl" my={1}>授权窗口与地区矩阵</Heading><Text color="gray.600">批量调窗先生成可恢复批次预览，提交时按窗口当前版本比对，冲突只挂起不覆盖。</Text></Box><Flex gap={2}><Select maxW="150px" value={selectedTerritory} onChange={(event) => useRightsStore.setState({ selectedTerritory: event.target.value })}>{territories.map((territory) => <option key={territory}>{territory}</option>)}</Select><Button colorScheme="blue" onClick={validateAndSave}>校验并保存</Button></Flex></Flex>
      <Grid templateColumns={{ base: '1fr', xl: 'minmax(0,1.1fr) minmax(360px,.8fr)' }} gap={4}>
        <Box bg="white" border="1px solid" borderColor="gray.200" borderRadius="8px" overflow="hidden">
          <Flex p={4} justify="space-between" align="center" flexWrap="wrap" gap={2}><Heading size="md">授权窗口清单</Heading><HStack><Select size="sm" w="110px" value={shiftDays} onChange={(event) => setShiftDays(Number(event.target.value))}><option value={7}>+7 天</option><option value={14}>+14 天</option><option value={-7}>-7 天</option><option value={-14}>-14 天</option></Select><Button size="sm" onClick={handlePreview}>批量调窗</Button><Button size="sm" variant="outline" onClick={handleConcurrent} title="模拟发行部与法务同时基于同一版本提交两笔批次">模拟并发提交</Button></HStack></Flex>
          <Table size="sm"><Thead><Tr><Th w="36px"></Th><Th>作品 / 渠道</Th><Th>地区</Th><Th>开始</Th><Th>结束</Th><Th>版本</Th><Th>独占</Th></Tr></Thead><Tbody>{filtered.map((item) => <Tr key={item.id} bg={selectedWindowId === item.id ? 'blue.50' : undefined} cursor="pointer" onClick={() => selectWindow(item.id)}><Td onClick={(event) => event.stopPropagation()}><Checkbox isChecked={selectedIds.includes(item.id)} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} /></Td><Td><Text fontWeight="600">{item.work}</Text><Text color="gray.500" fontSize="xs">{item.channel} · {item.id}</Text></Td><Td>{item.territory}</Td><Td>{item.start}</Td><Td>{item.end}</Td><Td><Badge variant="outline" colorScheme="blue">v{windowVersion(item)}</Badge></Td><Td><Badge colorScheme={item.exclusive ? 'purple' : 'gray'}>{item.exclusive ? '独占' : '普通'}</Badge></Td></Tr>)}</Tbody></Table>
        </Box>
        <Box bg="white" border="1px solid" borderColor="gray.200" borderRadius="8px" p={5}>
          <Heading size="md" mb={1}>窗口条款</Heading><Text color="gray.500" fontSize="sm" mb={4}>{selected?.id ?? '请选择窗口'}</Text>
          {selected && <Grid templateColumns="1fr 1fr" gap={4}>
            <Box gridColumn="span 2"><Text fontSize="sm" mb={1}>渠道</Text><Input value={selected.channel} onChange={(event) => updateWindow(selected.id, { channel: event.target.value })} /></Box>
            <Box><Text fontSize="sm" mb={1}>开始日期</Text><Input type="date" value={selected.start} onChange={(event) => updateWindow(selected.id, { start: event.target.value })} /></Box>
            <Box><Text fontSize="sm" mb={1}>结束日期</Text><Input type="date" value={selected.end} onChange={(event) => updateWindow(selected.id, { end: event.target.value })} /></Box>
            <Box><Text fontSize="sm" mb={1}>优先顺序</Text><Input type="number" value={selected.priority} onChange={(event) => updateWindow(selected.id, { priority: Number(event.target.value) })} /></Box>
            <Box><Text fontSize="sm" mb={1}>地区</Text><Select value={selected.territory} onChange={(event) => updateWindow(selected.id, { territory: event.target.value as Territory })}>{territories.filter((item) => item !== '全部地区').map((territory) => <option key={territory}>{territory}</option>)}</Select></Box>
            <Checkbox isChecked={selected.exclusive} onChange={(event) => updateWindow(selected.id, { exclusive: event.target.checked })}>独占窗口</Checkbox><Checkbox isChecked={selected.sublicense} onChange={(event) => updateWindow(selected.id, { sublicense: event.target.checked })}>允许次级授权</Checkbox>
          </Grid>}
          {selected && conflicts.filter((issue) => issue.windowIds.includes(selected.id)).map((issue) => <Box key={issue.id} mt={4} p={3} bg={issue.severity === '高' ? 'red.50' : 'orange.50'} borderLeft="3px solid" borderLeftColor={issue.severity === '高' ? 'red.500' : 'orange.400'}><Text fontWeight="700" fontSize="sm">{issue.type}</Text><Text fontSize="sm" color="gray.600" mt={1}>{issue.explanation}</Text></Box>)}
          <Button w="100%" mt={5} colorScheme="blue" onClick={validateAndSave}>保存并重新校验</Button>
        </Box>
      </Grid>

      <Box bg="white" border="1px solid" borderColor="gray.200" borderRadius="8px" p={5} mt={4}>
        <Flex justify="space-between" align="center" mb={3} flexWrap="wrap" gap={2}>
          <Heading size="md">调窗批次</Heading>
          {latestBatch && <HStack><Text fontSize="sm" color="gray.500">最新批次</Text><Badge colorScheme={batchStatusColor[latestBatch.status]}>{latestBatch.id} · {latestBatch.status}</Badge></HStack>}
        </Flex>
        {batches.length === 0 ? (
          <Text color="gray.500" fontSize="sm">暂无批次。勾选窗口后点击「批量调窗」生成预览；提交时按窗口当前版本比对，被他人改过的窗口会挂起并保留对方版本。</Text>
        ) : (
          <Table size="sm"><Thead><Tr><Th>批次号</Th><Th>状态</Th><Th>顺延</Th><Th>窗口明细</Th><Th>创建时间</Th><Th></Th></Tr></Thead><Tbody>
            {batches.slice().reverse().map((batch) => {
              const applied = batch.items.filter((i) => i.status === '已生效').length
              const suspended = batch.items.filter((i) => i.status === '已挂起').length
              const pending = batch.items.filter((i) => i.status === '待生效').length
              return (
                <Tr key={batch.id}>
                  <Td><Text fontWeight="600">{batch.id}</Text></Td>
                  <Td><Badge colorScheme={batchStatusColor[batch.status]}>{batch.status}</Badge></Td>
                  <Td>{batch.days > 0 ? `+${batch.days}` : batch.days} 天</Td>
                  <Td><Text fontSize="sm">共 {batch.items.length} 个 · 已生效 {applied} · 已挂起 {suspended}{pending > 0 ? ` · 待生效 ${pending}` : ''}</Text></Td>
                  <Td><Text fontSize="xs" color="gray.500">{new Date(batch.createdAt).toLocaleTimeString('zh-CN')}</Text></Td>
                  <Td><HStack>
                    <Button size="xs" variant="outline" onClick={() => setPreviewBatchId(batch.id)}>查看</Button>
                    {(batch.status === '失败' || batch.status === '部分生效') && (
                      <Button size="xs" colorScheme="blue" onClick={() => { recoverBatch(batch.id); toast({ title: '批次已恢复', description: '剩余窗口继续生效，已生效窗口不重复顺延。', status: 'success' }) }}>恢复批次</Button>
                    )}
                  </HStack></Td>
                </Tr>
              )
            })}
          </Tbody></Table>
        )}
      </Box>

      <Modal isOpen={!!previewBatch} onClose={() => setPreviewBatchId(null)} size="3xl" scrollBehavior="inside">
        <ModalOverlay />
        {previewBatch && <ModalContent>
          <ModalHeader>批量调窗预览</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <HStack mb={3} flexWrap="wrap"><Text fontWeight="700">{previewBatch.id}</Text><Badge colorScheme={batchStatusColor[previewBatch.status]}>{previewBatch.status}</Badge><Badge variant="outline">{previewBatch.days > 0 ? `+${previewBatch.days}` : previewBatch.days} 天</Badge></HStack>
            <Text fontSize="sm" color="gray.600" mb={3}>预览基于每个授权窗口的当前版本生成；提交时若版本已被他人改动，该笔将挂起并保留对方版本，不会覆盖。</Text>
            <Table size="sm"><Thead><Tr><Th>窗口</Th><Th>基准版本</Th><Th>原日期</Th><Th>预览日期</Th><Th>状态</Th></Tr></Thead><Tbody>
              {previewBatch.items.map((item) => (
                <Tr key={item.windowId}>
                  <Td><Text fontWeight="600">{item.baseSnapshot.channel}</Text><Text color="gray.500" fontSize="xs">{item.windowId}</Text></Td>
                  <Td><Badge variant="outline" colorScheme="blue">v{item.baseVersion}</Badge></Td>
                  <Td><Text fontSize="xs">{item.baseSnapshot.start} → {item.baseSnapshot.end}</Text></Td>
                  <Td><Text fontSize="xs">{item.planned.start} → {item.planned.end}</Text></Td>
                  <Td><Badge colorScheme={itemStatusColor[item.status]}>{item.status}</Badge>{item.reason && <Text fontSize="xs" color="orange.600" mt={1}>{item.reason}</Text>}</Td>
                </Tr>
              ))}
            </Tbody></Table>
            {previewBatch.status !== '预览' && (
              <Box mt={3} p={3} bg="gray.50" borderRadius="6px" fontSize="sm">
                <Text>已生效 {appliedCount} · 已挂起 {suspendedCount}{pendingCount > 0 ? ` · 待生效 ${pendingCount}` : ''}</Text>
                {suspendedCount > 0 && <Text color="orange.600" mt={1}>挂起条目保留对方刚改的版本，未被顺延覆盖。</Text>}
                {pendingCount > 0 && <Text color="red.600" mt={1}>存在未写入窗口，可点击「恢复批次」继续；已生效窗口不会重复顺延。</Text>}
              </Box>
            )}
            {previewBatch.status === '预览' && (
              <FormControl display="flex" alignItems="center" mt={4}>
                <FormLabel mb={0} fontSize="sm">模拟写入失败（首个窗口写入后中断，用于演示恢复）</FormLabel>
                <Switch isChecked={simulateFailure} onChange={(event) => setSimulateFailure(event.target.checked)} />
              </FormControl>
            )}
          </ModalBody>
          <ModalFooter>
            {previewBatch.status === '预览' ? (
              <HStack><Button variant="ghost" onClick={() => setPreviewBatchId(null)}>取消</Button><Button colorScheme="blue" onClick={handleCommit}>提交批次</Button></HStack>
            ) : (
              <HStack>
                {(previewBatch.status === '失败' || previewBatch.status === '部分生效') && (
                  <Button colorScheme="blue" onClick={() => { recoverBatch(previewBatch.id); toast({ title: '批次已恢复', description: '剩余窗口继续生效，已生效窗口不重复顺延。', status: 'success' }) }}>恢复批次</Button>
                )}
                <Button variant="ghost" onClick={() => setPreviewBatchId(null)}>关闭</Button>
              </HStack>
            )}
          </ModalFooter>
        </ModalContent>}
      </Modal>
    </Box>
  )
}
