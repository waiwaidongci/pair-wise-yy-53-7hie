'use client'

import { useState } from 'react'
import { Box, Flex, Grid, Heading, Text, Badge, Button, Textarea, Checkbox, Tabs, TabList, Tab, TabPanels, TabPanel, useToast, HStack, Alert, AlertIcon } from '@chakra-ui/react'
import { useRightsStore } from '@/store/rights'
import { versions } from '@/lib/mock-data'
import { buildApprovalPackage } from '@/lib/approval'
import { deriveBatchStatus, summarizeBatch } from '@/lib/batch'

export default function ReviewsPage() {
  const comments = useRightsStore((state) => state.comments)
  const acceptComment = useRightsStore((state) => state.acceptComment)
  const windows = useRightsStore((state) => state.windows)
  const latestBatch = useRightsStore((state) => state.latestBatch)
  const version = useRightsStore((state) => state.version)
  const [draft, setDraft] = useState('流媒体开窗日期以院线独占结束次日为准，并单独拆分港澳台物料。')
  const [accepted, setAccepted] = useState<string[]>(['RW-102 开窗日期由 11-15 调整为 11-20'])
  const toast = useToast()
  const batchSummary = latestBatch ? summarizeBatch(latestBatch) : null

  function exportPackage() {
    // 始终用窗口当前版本 + 最新批次现算冲突，旧批次预览的冲突结果不会被带入导出。
    const report = buildApprovalPackage(windows, comments, version, latestBatch)
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `发行权审批包-${report.draftVersion}${report.generatedFromBatch ? `-${report.generatedFromBatch}` : ''}.json`
    link.click()
    URL.revokeObjectURL(link.href)
    toast({
      title: report.approvable ? '审批包已导出' : '审批包已导出（含阻断项）',
      description: report.approvable
        ? `按最新批次 ${report.generatedFromBatch ?? '当前草案'} 现算冲突 ${report.conflicts.length} 条。`
        : report.blockReason,
      status: report.approvable ? 'success' : 'warning',
      duration: 7000,
    })
  }
  return (
    <Box>
      <Flex justify="space-between" mb={5} gap={4} direction={{ base: 'column', md: 'row' }}><Box><Text color="brand.600" fontSize="xs" fontWeight="bold">VERSION & APPROVAL</Text><Heading fontSize="3xl" my={1}>版本比较与条款合并</Heading><Text color="gray.600">评论锚定具体窗口和条款，任意版本可逐项接受；冲突矩阵与审批包始终按窗口当前版本和最新批次现算。</Text></Box><Button colorScheme="blue" onClick={exportPackage}>导出可追溯审批包</Button></Flex>
      {latestBatch && batchSummary && (
        <Alert status={batchSummary.failed > 0 ? 'error' : batchSummary.parked > 0 ? 'warning' : 'success'} borderRadius="8px" mb={4}>
          <AlertIcon />
          <HStack flexWrap="wrap" gap={2} fontSize="sm">
            <Badge variant="outline">{latestBatch.id}</Badge>
            <Text>最新批次状态：{deriveBatchStatus(latestBatch)}</Text>
            <Text>已生效 {batchSummary.applied} · 挂起 {batchSummary.parked} · 写入失败 {batchSummary.failed} · 待提交 {batchSummary.pending}</Text>
            <Text color="gray.600">导出审批包将实时重算冲突，挂起笔保留对方版本并随包留痕。</Text>
          </HStack>
        </Alert>
      )}
      <Tabs colorScheme="blue" variant="enclosed">
        <TabList><Tab>条款意见</Tab><Tab>版本差异</Tab><Tab>审批时间线</Tab></TabList>
        <TabPanels>
          <TabPanel px={0} pt={4}><Grid templateColumns={{ base: '1fr', lg: '1.3fr .8fr' }} gap={4}>
            <Box bg="white" border="1px solid" borderColor="gray.200" borderRadius="8px">{comments.map((comment) => <Box key={comment.id} p={4} borderBottom="1px solid" borderColor="gray.100"><Flex justify="space-between"><Box><Text fontWeight="700">{comment.role} · {comment.author}</Text><Text color="gray.500" fontSize="xs">{comment.anchor}</Text></Box><Badge colorScheme={comment.resolved ? 'green' : 'orange'}>{comment.resolved ? '已解决' : '待处理'}</Badge></Flex><Text color="gray.600" mt={3}>{comment.content}</Text>{!comment.resolved && <Button mt={3} size="sm" colorScheme="blue" variant="outline" onClick={() => acceptComment(comment.id)}>接受并合并条款</Button>}</Box>)}</Box>
            <Box bg="white" border="1px solid" borderColor="gray.200" borderRadius="8px" p={4}><Heading size="md" mb={3}>发表评论锚点</Heading><Badge mb={3}>RW-102 · 独占范围</Badge><Textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={7} /><Button mt={3} colorScheme="blue" isDisabled={!draft.trim()} onClick={() => { acceptComment(`new-${Date.now()}`); toast({ title: '评论已加入审阅草稿', status: 'success' }) }}>提交法务意见</Button></Box>
          </Grid></TabPanel>
          <TabPanel px={0} pt={4}><Grid templateColumns={{ base: '1fr', lg: '1fr 1fr' }} gap={4}>{latestBatch && <Box gridColumn={{ lg: 'span 2' }} bg="white" border="1px solid" borderColor="gray.200" borderRadius="8px" p={4}><Flex justify="space-between" mb={3}><Box><Heading size="md">{latestBatch.id} · 最新批次差异</Heading><Text color="gray.500" fontSize="sm">{latestBatch.author} 发起 · 提交时逐笔比对版本，被改过的窗口保留对方版本</Text></Box><Badge colorScheme="orange">{deriveBatchStatus(latestBatch)}</Badge></Flex><Grid templateColumns={{ base: '1fr', md: '2fr 1fr 1fr' }} gap={2} fontSize="sm">{latestBatch.items.map((item) => { const live = windows.find((win) => win.id === item.windowId); return <Box key={item.windowId} p={2} bg="gray.50" borderRadius="6px" gridColumn={{ md: 'span 3' }}><HStack justify="space-between"><HStack><Text fontWeight="700">{item.windowId}</Text><Badge>{item.status}</Badge><Text color="gray.600">{item.days > 0 ? `+${item.days}` : item.days} 天：{item.preview.start} → {item.preview.end}</Text></HStack><Text color="gray.500">基准 v{item.baseRev} → 当前 {live?.rev === undefined ? '旧稿' : `v${live.rev}`}{live?.lastEditor ? `（${live.lastEditor} 改）` : ''}</Text></HStack>{item.reason && <Text mt={1} fontSize="xs" color={item.status === '已挂起' ? 'orange.600' : 'red.600'}>{item.reason}</Text>}</Box> })}</Grid></Box>}{versions.slice(0, 2).map((version) => <Box key={version.id} bg="white" border="1px solid" borderColor="gray.200" borderRadius="8px" p={4}><Flex justify="space-between"><Box><Heading size="md">{version.id}</Heading><Text color="gray.500" fontSize="sm">{version.author} · {version.time}</Text></Box><Badge>{version.changes.length} 项</Badge></Flex><Text fontWeight="600" mt={4}>{version.summary}</Text>{version.changes.map((change) => <Checkbox key={change} mt={3} isChecked={accepted.includes(change)} onChange={(event) => setAccepted((current) => event.target.checked ? [...current, change] : current.filter((item) => item !== change))}>{change}</Checkbox>)}</Box>)}</Grid></TabPanel>
          <TabPanel px={0} pt={4}><Box bg="white" border="1px solid" borderColor="gray.200" borderRadius="8px" p={5}><HStack align="flex-start" mb={5}><Badge colorScheme="green">16:35</Badge><Box><Text fontWeight="700">章宁提交 v18</Text><Text color="gray.500" fontSize="sm">调整流媒体窗口，新增港台地区和次级授权约束。</Text></Box></HStack><HStack align="flex-start" mb={5}><Badge colorScheme="orange">16:42</Badge><Box><Text fontWeight="700">黎清提出窗口倒挂意见</Text><Text color="gray.500" fontSize="sm">意见锚定 RW-101 / RW-102 的院线独占尾部。</Text></Box></HStack><HStack align="flex-start"><Badge colorScheme="gray">待处理</Badge><Box><Text fontWeight="700">发行负责人审批</Text><Text color="gray.500" fontSize="sm">解决全部高风险冲突后进入只读审批。</Text></Box></HStack></Box></TabPanel>
        </TabPanels>
      </Tabs>
    </Box>
  )
}
