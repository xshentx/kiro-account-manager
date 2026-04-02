import { startTransition, useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { Copy, Play, Square, Activity, Shield, Server, RefreshCw, Radio, Check, RotateCcw, FolderOpen, Search, AlertTriangle } from 'lucide-react'
import { Alert, Button, Card, Group, Stack, Text, TextInput, Textarea, NumberInput, Select, Badge, Code, Tooltip, Switch, Tabs } from '@mantine/core'
import { useApp } from '../../hooks/useApp'
import { applyGatewayLocalOnlyChange, buildClientSamples, buildGatewayActionSummary, buildGatewayIntegrationSummary, buildGatewayMetricsSummary, buildGatewayRequestLogSummary, buildGatewayRoutingSummary, buildGatewaySecuritySummary, buildGatewayStatusSummary, createGatewayFieldErrors, filterGatewayRequestLogs, formatGatewayAccountOptionLabel, formatGatewayRequestDuration, formatGatewayTimestamp, getGatewayRequestOutcomeColor, mergeErrorHistory } from './gatewayPageUtils'
import {
  buildGatewayConfigSnapshot,
  buildGatewayRuntimeSnapshot,
  buildGatewayStatusState,
  clearGatewayRequestLogs,
  DEFAULT_GATEWAY_CONFIG,
  DEFAULT_GATEWAY_STATUS,
  fetchGatewayRequestLogs,
  hydrateGatewayConfig,
  loadGatewayPageData,
  openGatewayLogDir,
  saveGatewayConfig,
  startGateway,
  stopGateway,
} from './gatewayPageState'
import { useGatewayPolling } from './useGatewayPolling'

function GatewayPage() {
  const { colors } = useApp()
  const [config, setConfig] = useState(DEFAULT_GATEWAY_CONFIG)
  const [status, setStatus] = useState(DEFAULT_GATEWAY_STATUS)
  const [errorHistory, setErrorHistory] = useState([])
  const [accounts, setAccounts] = useState([])
  const [groups, setGroups] = useState([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [copySuccess, setCopySuccess] = useState('')
  const [logDir, setLogDir] = useState('')
  const [activeTab, setActiveTab] = useState('overview')
  const [requestLogs, setRequestLogs] = useState([])
  const [requestLogsLoading, setRequestLogsLoading] = useState(false)
  const [requestLogOutcome, setRequestLogOutcome] = useState('all')
  const [requestLogQuery, setRequestLogQuery] = useState('')
  const [lastRequestLogsSyncAt, setLastRequestLogsSyncAt] = useState('-')
  const [savedConfigSnapshot, setSavedConfigSnapshot] = useState(() => buildGatewayConfigSnapshot(DEFAULT_GATEWAY_CONFIG))
  const [appliedRuntimeSnapshot, setAppliedRuntimeSnapshot] = useState(null)
  const [lastStatusSyncAt, setLastStatusSyncAt] = useState('-')

  const accountOptions = useMemo(
    () => accounts.map(account => ({
      value: account.id,
      label: formatGatewayAccountOptionLabel(account),
    })),
    [accounts]
  )

  const groupOptions = useMemo(
    () => groups.map(group => ({ value: group.id, label: group.name })),
    [groups]
  )

  const baseUrl = useMemo(() => `http://${config.host}:${config.port}`, [config.host, config.port])
  const fieldErrors = useMemo(() => createGatewayFieldErrors(config), [config])
  const hasFieldErrors = Object.keys(fieldErrors).length > 0
  const configSnapshot = useMemo(() => buildGatewayConfigSnapshot(config), [config])
  const runtimeSnapshot = useMemo(() => buildGatewayRuntimeSnapshot(config), [config])
  const hasUnsavedChanges = configSnapshot !== savedConfigSnapshot
  const hasRuntimeChanges = !!status.running && !!appliedRuntimeSnapshot && runtimeSnapshot !== appliedRuntimeSnapshot
  const clientSamples = useMemo(() => buildClientSamples(baseUrl, config.apiKey), [baseUrl, config.apiKey])
  const statusSummary = useMemo(
    () => buildGatewayStatusSummary({ config, status, errorHistory, lastStatusSyncAt }),
    [config, status, errorHistory, lastStatusSyncAt]
  )
  const actionSummary = useMemo(
    () => buildGatewayActionSummary({ running: status.running, hasUnsavedChanges, hasRuntimeChanges, hasFieldErrors }),
    [status.running, hasUnsavedChanges, hasRuntimeChanges, hasFieldErrors]
  )
  const securitySummary = useMemo(
    () => buildGatewaySecuritySummary({ config }),
    [config]
  )
  const integrationSummary = useMemo(
    () => buildGatewayIntegrationSummary({ baseUrl, apiKey: config.apiKey, logDir, errorHistory }),
    [baseUrl, config.apiKey, logDir, errorHistory]
  )
  const deferredRequestLogQuery = useDeferredValue(requestLogQuery)
  const isObservabilityTab = activeTab === 'observability'
  const requestLogSummary = useMemo(
    () => isObservabilityTab ? buildGatewayRequestLogSummary(requestLogs) : buildGatewayRequestLogSummary([]),
    [isObservabilityTab, requestLogs]
  )
  const filteredRequestLogs = useMemo(
    () => isObservabilityTab
      ? filterGatewayRequestLogs(requestLogs, { outcome: requestLogOutcome, query: deferredRequestLogQuery })
      : [],
    [isObservabilityTab, requestLogs, requestLogOutcome, deferredRequestLogQuery]
  )
  const filteredRequestLogSummary = useMemo(
    () => buildGatewayRequestLogSummary(filteredRequestLogs),
    [filteredRequestLogs]
  )
  const requestMetrics = useMemo(
    () => buildGatewayMetricsSummary(filteredRequestLogs),
    [filteredRequestLogs]
  )
  const routingSummary = useMemo(
    () => buildGatewayRoutingSummary({
      config,
      counts: {
        accounts: accounts.length,
        groups: groups.length,
      },
      selectedLabels: {
        single: accountOptions.find(item => item.value === config.accountId)?.label,
        group: groupOptions.find(item => item.value === config.groupId)?.label,
      },
    }),
    [config, accounts.length, groups.length, accountOptions, groupOptions]
  )
  const latestErrorEntry = useMemo(
    () => errorHistory[0] || null,
    [errorHistory]
  )
  const runtimeBadgeColor = status.running ? 'green' : 'gray'
  const endpointBadgeColor = config.localOnly ? 'teal' : 'yellow'
  const pollingFallbackConfig = useMemo(
    () => ({
      host: config.host,
      port: config.port,
    }),
    [config.host, config.port]
  )
  const renderMetricList = (items, emptyLabel) => {
    if (!items.length) {
      return <Text size="sm" className={colors.textMuted}>{emptyLabel}</Text>
    }

    return (
      <Stack gap={6}>
        {items.map(item => (
          <Group key={`${item.label}-${item.count}`} justify="space-between" gap="xs">
            <Text size="sm" className={colors.text} style={{ wordBreak: 'break-word' }}>{item.label}</Text>
            <Badge variant="light">{item.count}</Badge>
          </Group>
        ))}
      </Stack>
    )
  }

  const pushError = (msg) => {
    const normalized = String(msg?.message || msg || '').trim()
    if (!normalized) return
    setErrorHistory(prev => mergeErrorHistory(prev, normalized, formatGatewayTimestamp(), 8))
  }

  const loadRequestLogs = useCallback(async (limit = 120) => {
    setRequestLogsLoading(true)
    try {
      const logs = await fetchGatewayRequestLogs(limit)
      setRequestLogs(logs)
      setLastRequestLogsSyncAt(formatGatewayTimestamp())
    } catch (e) {
      pushError(e)
    } finally {
      setRequestLogsLoading(false)
    }
  }, [])

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const { gatewayConfig, gatewayStatus, accounts: accountList, groups: groupList, logDir: gatewayLogDir } = await loadGatewayPageData()

      const nextConfig = hydrateGatewayConfig(gatewayConfig)
      setConfig(nextConfig)
      setSavedConfigSnapshot(buildGatewayConfigSnapshot(nextConfig))
      setAppliedRuntimeSnapshot(gatewayStatus?.running ? buildGatewayRuntimeSnapshot(nextConfig) : null)
      setStatus(buildGatewayStatusState(gatewayStatus, gatewayConfig, nextConfig))
      setLastStatusSyncAt(formatGatewayTimestamp())
      setAccounts(accountList)
      setGroups(groupList)
      setLogDir(gatewayLogDir)

      if (gatewayStatus?.lastError) {
        pushError(gatewayStatus.lastError)
      }
    } catch (e) {
      pushError(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    startTransition(() => {
      loadAll()
    })
  }, [loadAll])

  const handleStatusPoll = useCallback(({ status: nextStatus, fallbackConfig, syncedAt }) => {
    setStatus(buildGatewayStatusState(nextStatus, nextStatus, fallbackConfig))
    setLastStatusSyncAt(syncedAt)
    if (nextStatus?.lastError) {
      pushError(nextStatus.lastError)
    }
  }, [])

  const handleRequestLogsPoll = useCallback(({ logs, syncedAt }) => {
    setRequestLogs(logs)
    setLastRequestLogsSyncAt(syncedAt)
  }, [])

  useGatewayPolling({
    activeTab,
    fallbackConfig: pollingFallbackConfig,
    onStatus: handleStatusPoll,
    onRequestLogs: handleRequestLogsPoll,
  })

  const setField = (key, value) => setConfig(prev => ({ ...prev, [key]: value }))

  const createGeneratedApiKey = () => {
    const random = crypto?.randomUUID?.().replace(/-/g, '') || `${Date.now()}${Math.random().toString(36).slice(2)}`
    return `sk-${random}`
  }

  const handleRefresh = async () => {
    await loadAll()
  }

  const handleClearErrors = () => {
    setErrorHistory([])
  }

  const handleGenerateApiKey = () => {
    setConfig(prev => ({ ...prev, apiKey: createGeneratedApiKey() }))
  }

  const handleOpenLogDir = async () => {
    try {
      const dir = await openGatewayLogDir()
      setLogDir(String(dir || ''))
    } catch (e) {
      pushError(e)
    }
  }

  const handleClearRequestLogs = async () => {
    setRequestLogsLoading(true)
    try {
      await clearGatewayRequestLogs()
      setRequestLogs([])
      setLastRequestLogsSyncAt(formatGatewayTimestamp())
    } catch (e) {
      pushError(e)
    } finally {
      setRequestLogsLoading(false)
    }
  }

  const guardInvalidConfig = () => {
    if (!hasFieldErrors) {
      return false
    }
    pushError('请先修正表单错误后再继续')
    return true
  }

  const handleSave = async () => {
    if (guardInvalidConfig()) return
    setSaving(true)
    try {
      await saveGatewayConfig(config)
      setSavedConfigSnapshot(buildGatewayConfigSnapshot(config))
    } catch (e) {
      pushError(e)
    } finally {
      setSaving(false)
    }
  }

  const handleStart = async () => {
    if (guardInvalidConfig()) return
    setSaving(true)
    try {
      const st = await startGateway(config)
      setStatus(st)
      setAppliedRuntimeSnapshot(buildGatewayRuntimeSnapshot(config))
      setLastStatusSyncAt(formatGatewayTimestamp())
    } catch (e) {
      pushError(e)
    } finally {
      setSaving(false)
    }
  }

  const handleRestart = async () => {
    if (guardInvalidConfig()) return
    setSaving(true)
    try {
      if (status.running) {
        await stopGateway()
      }
      const st = await startGateway(config)
      setStatus(st)
      setAppliedRuntimeSnapshot(buildGatewayRuntimeSnapshot(config))
      setLastStatusSyncAt(formatGatewayTimestamp())
    } catch (e) {
      pushError(e)
    } finally {
      setSaving(false)
    }
  }

  const handleStop = async () => {
    setSaving(true)
    try {
      await stopGateway()
      setStatus(prev => ({ ...prev, running: false }))
      setAppliedRuntimeSnapshot(null)
      setLastStatusSyncAt(formatGatewayTimestamp())
    } catch (e) {
      pushError(e)
    } finally {
      setSaving(false)
    }
  }

  const copyText = async (text, successMessage) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopySuccess(successMessage)
      setTimeout(() => setCopySuccess(''), 1600)
    } catch (e) {
      pushError(e)
    }
  }

  return (
    <div className={`h-full overflow-y-auto p-6 ${colors.main}`}>
      <Stack gap="md">
        <Card withBorder radius="md" className={`${colors.card} ${colors.cardBorder}`}>
          <Text fw={700} className={colors.text}>Kiro API 网关</Text>
          <Text size="sm" className={colors.textMuted} mt={6}>本地代理仅转发至 Kiro API，不经过任何第三方服务器。Kiro access token 从本地账号自动读取，页面里填写的是客户端 API Key。</Text>
        </Card>

        <Card withBorder radius="md" className={`${colors.card} ${colors.cardBorder}`}>
          <Stack gap="sm">
            <Group justify="space-between" align="flex-start">
              <Stack gap={4}>
                <Group gap="xs">
                  <Badge color={runtimeBadgeColor}>{status.running ? '网关运行中' : '网关未启动'}</Badge>
                  <Badge color={endpointBadgeColor}>{config.localOnly ? '仅本机访问' : '允许远程访问'}</Badge>
                  <Badge variant="light" color={hasUnsavedChanges ? 'yellow' : 'teal'}>
                    {hasUnsavedChanges ? '存在未保存配置' : '配置已保存'}
                  </Badge>
                </Group>
                <Text fw={700} className={colors.text}>当前入口 {baseUrl}</Text>
                <Text size="sm" className={colors.textMuted}>
                  {routingSummary.modeLabel} · {routingSummary.selectionValue} · {securitySummary.apiKeyState}
                </Text>
              </Stack>

              <Group gap="xs">
                <Button
                  variant="default"
                  leftSection={<Activity size={16} />}
                  onClick={handleSave}
                  loading={saving || loading}
                  disabled={!hasUnsavedChanges || hasFieldErrors || saving || loading}
                >
                  保存配置
                </Button>
                {status.running ? (
                  <Button
                    variant="light"
                    leftSection={<RotateCcw size={16} />}
                    onClick={handleRestart}
                    loading={saving || loading}
                    disabled={hasFieldErrors || saving || loading}
                  >
                    重启网关
                  </Button>
                ) : null}
                {!status.running ? (
                  <Button
                    color="green"
                    leftSection={<Play size={16} />}
                    onClick={handleStart}
                    loading={saving || loading}
                    disabled={hasFieldErrors || saving || loading}
                  >
                    启动网关
                  </Button>
                ) : (
                  <Button
                    color="red"
                    leftSection={<Square size={16} />}
                    onClick={handleStop}
                    loading={saving || loading}
                    disabled={saving || loading}
                  >
                    停止网关
                  </Button>
                )}
              </Group>
            </Group>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Card withBorder radius="md">
                <Text size="xs" className={colors.textMuted}>运行快照</Text>
                <Text fw={700} className={colors.text}>{statusSummary.listen}</Text>
                <Text size="sm" className={colors.textMuted} mt={4}>
                  {statusSummary.routing} · {statusSummary.region}
                </Text>
              </Card>
              <Card withBorder radius="md">
                <Text size="xs" className={colors.textMuted}>接入与鉴权</Text>
                <Text fw={700} className={colors.text}>{integrationSummary.endpointLabel}</Text>
                <Text size="sm" className={colors.textMuted} mt={4}>
                  {integrationSummary.authLabel}
                </Text>
              </Card>
              <Card withBorder radius="md">
                <Text size="xs" className={colors.textMuted}>最新风险</Text>
                <Text fw={700} className={colors.text}>
                  {latestErrorEntry ? '最近有错误请求' : '最近未发现错误'}
                </Text>
                <Text size="sm" className={colors.textMuted} mt={4}>
                  {latestErrorEntry?.occurredAt || lastStatusSyncAt}
                </Text>
              </Card>
            </div>

            <Alert color={actionSummary.tone} variant="light" title={actionSummary.title}>
              {actionSummary.description}
            </Alert>
          </Stack>
        </Card>

        <Tabs
          value={activeTab}
          keepMounted={false}
          onChange={(value) => {
            startTransition(() => {
              setActiveTab(value || 'overview')
            })
          }}
        >
          <Tabs.List>
            <Tabs.Tab value="overview">总览</Tabs.Tab>
            <Tabs.Tab value="integration">接入</Tabs.Tab>
            <Tabs.Tab value="observability">观测</Tabs.Tab>
            <Tabs.Tab value="advanced">高级</Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="overview" pt="md">
            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)] gap-4">
              <Card withBorder radius="md" className={`${colors.card} ${colors.cardBorder}`}>
                <Stack gap="sm">
                  <Group justify="space-between" align="flex-start">
                    <Stack gap={4}>
                      <Group gap="xs">
                        <Radio size={16} />
                        <Text fw={600} className={colors.text}>控制台总览</Text>
                      </Group>
                      <Text size="sm" className={colors.textMuted}>
                        日常只看这里：入口、状态、当前账号来源和下一步动作都收口，不再把大表单放在第一页。
                      </Text>
                    </Stack>
                    <Button variant="light" size="xs" leftSection={<RefreshCw size={14} />} onClick={handleRefresh} loading={loading}>
                      刷新
                    </Button>
                  </Group>

                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                    <Card withBorder radius="md">
                      <Text size="xs" className={colors.textMuted}>客户端入口</Text>
                      <Text fw={700} className={colors.text}>{baseUrl}</Text>
                    </Card>
                    <Card withBorder radius="md">
                      <Text size="xs" className={colors.textMuted}>{routingSummary.selectionLabel}</Text>
                      <Text fw={700} className={colors.text}>{routingSummary.selectionValue}</Text>
                    </Card>
                    <Card withBorder radius="md">
                      <Text size="xs" className={colors.textMuted}>客户端 Key</Text>
                      <Text fw={700} className={colors.text}>{securitySummary.apiKeyState}</Text>
                    </Card>
                    <Card withBorder radius="md">
                      <Text size="xs" className={colors.textMuted}>请求计数 / 错误</Text>
                      <Text fw={700} className={colors.text}>{statusSummary.requests} / {statusSummary.errorCount}</Text>
                    </Card>
                  </div>

                  <Card withBorder radius="md">
                    <Stack gap={8}>
                      <Group justify="space-between">
                        <Text size="sm" fw={600}>当前建议动作</Text>
                        <Badge color={actionSummary.tone}>{actionSummary.title}</Badge>
                      </Group>
                      <Text size="sm" className={colors.textMuted}>{actionSummary.description}</Text>
                    </Stack>
                  </Card>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <Card withBorder radius="md">
                      <Stack gap={8}>
                        <Text size="xs" className={colors.textMuted}>快速复制</Text>
                        <Text fw={700} className={colors.text}>基础入口</Text>
                        <Button variant="light" size="xs" leftSection={<Copy size={14} />} onClick={() => copyText(baseUrl, '网关入口已复制')}>
                          复制入口地址
                        </Button>
                      </Stack>
                    </Card>
                    <Card withBorder radius="md">
                      <Stack gap={8}>
                        <Text size="xs" className={colors.textMuted}>OpenAI 兼容接入</Text>
                        <Text fw={700} className={colors.text}>OpenAI Responses 兼容</Text>
                        <Button
                          variant="light"
                          size="xs"
                          leftSection={<Copy size={14} />}
                          onClick={() => copyText(clientSamples.openai.env, 'OpenAI 兼容配置已复制')}
                        >
                          复制 OpenAI 兼容环境变量
                        </Button>
                      </Stack>
                    </Card>
                    <Card withBorder radius="md">
                      <Stack gap={8}>
                        <Text size="xs" className={colors.textMuted}>排障入口</Text>
                        <Text fw={700} className={colors.text}>日志目录</Text>
                        <Button variant="light" size="xs" leftSection={<FolderOpen size={14} />} onClick={handleOpenLogDir}>
                          打开日志目录
                        </Button>
                      </Stack>
                    </Card>
                  </div>

                  {copySuccess ? <Badge color="green" leftSection={<Check size={12} />}>{copySuccess}</Badge> : null}
                </Stack>
              </Card>

              <Card withBorder radius="md" className={`${colors.card} ${colors.cardBorder}`}>
                <Stack gap="sm">
                  <Group justify="space-between">
                    <Group gap="xs">
                      <Shield size={16} />
                      <Text fw={600} className={colors.text}>状态与边界</Text>
                    </Group>
                    <Badge color={config.localOnly ? 'teal' : 'yellow'}>{securitySummary.exposureLabel}</Badge>
                  </Group>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Card withBorder radius="md">
                      <Text size="xs" className={colors.textMuted}>路由模式</Text>
                      <Text fw={700} className={colors.text}>{routingSummary.modeLabel}</Text>
                    </Card>
                    <Card withBorder radius="md">
                      <Text size="xs" className={colors.textMuted}>池策略</Text>
                      <Text fw={700} className={colors.text}>{routingSummary.strategySummary}</Text>
                    </Card>
                    <Card withBorder radius="md">
                      <Text size="xs" className={colors.textMuted}>Region / 日志级别</Text>
                      <Text fw={700} className={colors.text}>{statusSummary.region} / {statusSummary.logLevel}</Text>
                    </Card>
                    <Card withBorder radius="md">
                      <Text size="xs" className={colors.textMuted}>最后同步</Text>
                      <Text fw={700} className={colors.text}>{statusSummary.sync}</Text>
                    </Card>
                  </div>

                  <Card withBorder radius="md">
                    <Text size="xs" fw={600}>日志目录</Text>
                    <Text size="xs" mt={6} style={{ fontFamily: 'JetBrains Mono, monospace', wordBreak: 'break-all' }}>
                      {logDir || '尚未获取'}
                    </Text>
                  </Card>

                  <Card withBorder radius="md">
                    <Stack gap={8}>
                      <Group justify="space-between">
                        <Text size="sm" fw={600}>最近风险</Text>
                        <Badge color={latestErrorEntry ? 'orange' : 'teal'}>
                          {latestErrorEntry ? '需要排查' : '状态平稳'}
                        </Badge>
                      </Group>
                      {latestErrorEntry ? (
                        <Code block style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                          {`首次: ${latestErrorEntry.firstSeenAt}\n最近: ${latestErrorEntry.lastSeenAt}\n次数: ${latestErrorEntry.count}\n${latestErrorEntry.message}`}
                        </Code>
                      ) : (
                        <Text size="sm" className={colors.textMuted}>最近没有流式或上游错误命中。</Text>
                      )}
                    </Stack>
                  </Card>

                  <Alert color="blue" variant="light" title="页面边界">
                    网关页只负责入口控制、接入和观测。账号增删改、分组治理继续放在账号管理页面，避免在这里再造一套后台。
                  </Alert>
                </Stack>
              </Card>
            </div>
          </Tabs.Panel>

          <Tabs.Panel value="advanced" pt="md">
            <div className="grid grid-cols-1 gap-4">
          <Card withBorder radius="md" className={`${colors.card} ${colors.cardBorder}`}>
            <Stack gap="sm">
                <Group justify="space-between">
                  <Group gap="xs"><Server size={16} /><Text fw={600} className={colors.text}>高级配置</Text></Group>
                  <Group gap="xs">
                    {hasFieldErrors ? <Badge color="red">配置待修正</Badge> : null}
                    {hasUnsavedChanges ? <Badge color="yellow">未保存变更</Badge> : <Badge color="teal">已同步</Badge>}
                  </Group>
                </Group>

                <Text size="sm" className={colors.textMuted}>
                  监听地址、安全暴露、账号来源和池调度都收口到这里，属于低频但决定网关行为边界的配置。
                </Text>

              <Card withBorder radius="md">
                <Stack gap="sm">
                  <Group justify="space-between">
                    <Text size="sm" fw={600}>基础网络</Text>
                    <Badge color="indigo">基础配置</Badge>
                  </Group>

                  <TextInput
                    label="监听地址"
                    value={config.host}
                    onChange={(e) => setField('host', e.currentTarget.value || '127.0.0.1')}
                    error={fieldErrors.host}
                  />

                  <NumberInput
                    label="端口"
                    value={config.port}
                    min={1}
                    max={65535}
                    onChange={(v) => setField('port', Number(v) || 8765)}
                    error={fieldErrors.port}
                  />

                  <Stack gap={6}>
                    <TextInput
                      label="客户端 API Key"
                      description="客户端连接本地网关时始终使用。Kiro API 的 access token 由网关从本地账号自动读取；这里填写的是网关自己的客户端鉴权 Key，不是 Kiro access token。"
                      placeholder="sk-..."
                      value={config.apiKey}
                      onChange={(e) => setField('apiKey', e.currentTarget.value)}
                      error={fieldErrors.apiKey}
                    />
                    <Group justify="flex-end">
                      <Tooltip label="生成一个 sk- 格式的 API Key">
                        <Button size="xs" variant="light" onClick={handleGenerateApiKey}>生成客户端 Key</Button>
                      </Tooltip>
                    </Group>
                  </Stack>

                  <Select
                    label="Region"
                    data={[
                      { value: 'us-east-1', label: 'us-east-1' },
                      { value: 'eu-central-1', label: 'eu-central-1' },
                      { value: 'us-west-2', label: 'us-west-2' },
                      { value: 'ap-northeast-1', label: 'ap-northeast-1' },
                      { value: 'ap-southeast-1', label: 'ap-southeast-1' },
                      { value: 'us-gov-west-1', label: 'us-gov-west-1' },
                    ]}
                    value={config.region}
                    onChange={(v) => setField('region', v || 'us-east-1')}
                    error={fieldErrors.region}
                  />
                </Stack>
              </Card>

              <Card withBorder radius="md">
                <Stack gap="sm">
                  <Group justify="space-between">
                    <Text size="sm" fw={600}>安全访问</Text>
                    <Badge color={config.localOnly ? 'teal' : 'yellow'}>{securitySummary.exposureLabel}</Badge>
                  </Group>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Card withBorder radius="md">
                      <Text size="xs" className={colors.textMuted}>暴露范围</Text>
                      <Text fw={700} className={colors.text}>{securitySummary.exposureLabel}</Text>
                    </Card>
                    <Card withBorder radius="md">
                      <Text size="xs" className={colors.textMuted}>白名单条目</Text>
                      <Text fw={700} className={colors.text}>{securitySummary.allowedIpsCount}</Text>
                    </Card>
                    <Card withBorder radius="md">
                      <Text size="xs" className={colors.textMuted}>客户端 Key</Text>
                      <Text fw={700} className={colors.text}>{securitySummary.apiKeyState}</Text>
                    </Card>
                    <Card withBorder radius="md">
                      <Text size="xs" className={colors.textMuted}>日志级别</Text>
                      <Text fw={700} className={colors.text}>{securitySummary.logLevel}</Text>
                    </Card>
                  </div>

                  <Switch
                    label="随应用启动自动拉起网关"
                    description="仅影响下次启动应用时是否自动启动，不会立即修改当前运行状态。"
                    checked={!!config.enabled}
                    onChange={(e) => setField('enabled', e.currentTarget.checked)}
                  />

                  <Switch
                    label="仅允许本机访问"
                    description="开启后，网关会拒绝非 127.0.0.1 / ::1 请求，即使你把监听地址改成 0.0.0.0。无论是否开启，客户端都必须携带客户端 API Key。"
                    checked={!!config.localOnly}
                    onChange={(e) => {
                      const nextLocalOnly = e.currentTarget.checked
                      setConfig(prev => applyGatewayLocalOnlyChange(prev, nextLocalOnly, createGeneratedApiKey))
                    }}
                  />

                  <Textarea
                    label="IP 白名单"
                    description="支持单个 IP 或 CIDR，每行或逗号分隔；仅在关闭“仅允许本机访问”后生效。"
                    placeholder={'192.168.1.10\n10.0.0.0/24'}
                    autosize
                    minRows={3}
                    value={config.allowedIpsText}
                    onChange={(e) => setField('allowedIpsText', e.currentTarget.value)}
                    disabled={!!config.localOnly}
                    error={fieldErrors.allowedIpsText}
                  />

                  <Select
                    label="日志级别"
                    description="控制应用日志插件级别；保存后需重启应用才能完全生效。"
                    data={[
                      { value: 'debug', label: 'debug' },
                      { value: 'info', label: 'info' },
                      { value: 'warn', label: 'warn' },
                      { value: 'error', label: 'error' },
                    ]}
                    value={config.logLevel}
                    onChange={(v) => setField('logLevel', v || 'debug')}
                  />

                  <Alert color="orange" variant="light" title="风险提示">
                    该网关会直接使用本地或托管账号的 Kiro 凭证访问上游。不要把客户端 API Key、错误日志或网关端口暴露给不受信任环境。
                  </Alert>
                </Stack>
              </Card>

              <Card withBorder radius="md">
                <Stack gap="sm">
                  <Group justify="space-between">
                    <Text size="sm" fw={600}>账号来源与路由</Text>
                    <Badge color="blue">{routingSummary.modeLabel}</Badge>
                  </Group>
                  <Text size="sm" className={colors.textMuted}>{routingSummary.modeDescription}</Text>

                  <Select
                    label="账号来源"
                    data={[
                      { value: 'single', label: '指定单账号' },
                      { value: 'group', label: '按分组账号池' },
                    ]}
                    value={config.accountMode}
                    onChange={(v) => setField('accountMode', v || 'single')}
                    error={fieldErrors.accountMode}
                  />

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Card withBorder radius="md">
                      <Text size="xs" className={colors.textMuted}>{routingSummary.selectionLabel}</Text>
                      <Text fw={700} className={colors.text}>{routingSummary.selectionValue}</Text>
                    </Card>
                    <Card withBorder radius="md">
                      <Text size="xs" className={colors.textMuted}>候选范围</Text>
                      <Text fw={700} className={colors.text}>{routingSummary.inventorySummary}</Text>
                    </Card>
                    <Card withBorder radius="md" className="sm:col-span-2">
                      <Text size="xs" className={colors.textMuted}>路由策略</Text>
                      <Text fw={700} className={colors.text}>{routingSummary.strategySummary}</Text>
                    </Card>
                  </div>

                  {config.accountMode === 'single' ? (
                    <Card withBorder radius="md">
                      <Select
                        searchable
                        label="指定账号"
                        placeholder="选择一个账号"
                        data={accountOptions}
                        value={config.accountId}
                        onChange={(v) => setField('accountId', v)}
                        error={fieldErrors.accountId}
                      />
                    </Card>
                  ) : null}

                  {config.accountMode === 'group' ? (
                    <Card withBorder radius="md">
                      <Select
                        searchable
                        label="账号分组"
                        placeholder="选择一个分组"
                        data={groupOptions}
                        value={config.groupId}
                        onChange={(v) => setField('groupId', v)}
                        error={fieldErrors.groupId}
                      />
                    </Card>
                  ) : null}

                  {config.accountMode !== 'local' ? (
                    <Card withBorder radius="md">
                      <Stack gap="sm">
                        <Text size="sm" fw={600}>账号池调度</Text>
                        <Select
                          label="账号策略"
                          data={[
                            { value: 'round_robin', label: '轮询 round_robin' },
                            { value: 'most_quota', label: '优先剩余额度 most_quota' },
                            { value: 'random', label: '随机 random' },
                          ]}
                          value={config.strategy}
                          onChange={(v) => setField('strategy', v || 'round_robin')}
                        />

                        <NumberInput
                          label="切换阈值"
                          description="当账号使用率达到该阈值且仍有其他候选账号时，网关会优先尝试下一个账号。"
                          value={config.threshold}
                          min={1}
                          max={100}
                          onChange={(v) => setField('threshold', Number(v) || 90)}
                        />
                      </Stack>
                    </Card>
                  ) : null}
                </Stack>
              </Card>

              {hasFieldErrors ? (
                <Alert color="red" variant="light" title="保存前需修正">
                  {Object.values(fieldErrors).join('；')}
                </Alert>
              ) : null}
            </Stack>
          </Card>
          {hasFieldErrors ? (
            <Alert color="red" variant="light" title="保存前需修正">
              {Object.values(fieldErrors).join('；')}
            </Alert>
          ) : (
            <Alert color={actionSummary.tone} variant="light" title={actionSummary.title}>
              {actionSummary.description}
            </Alert>
          )}
            </div>
          </Tabs.Panel>

          <Tabs.Panel value="integration" pt="md">
            <div className="grid grid-cols-1 gap-4">
              <Card withBorder radius="md" className={`${colors.card} ${colors.cardBorder}`}>
                <Stack gap="sm">
                  <Group justify="space-between">
                    <Text size="sm" fw={600}>接入指南</Text>
                    <Badge color="indigo">客户端接入</Badge>
                  </Group>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Card withBorder radius="md">
                      <Text size="xs" className={colors.textMuted}>接入地址</Text>
                      <Text fw={700} className={colors.text}>{integrationSummary.endpointLabel}</Text>
                    </Card>
                    <Card withBorder radius="md">
                      <Text size="xs" className={colors.textMuted}>认证头</Text>
                      <Text fw={700} className={colors.text}>{integrationSummary.authLabel}</Text>
                    </Card>
                  </div>

                  <Card withBorder radius="md">
                    <Text size="xs" fw={600}>Claude / Anthropic</Text>
                    <Code block mt="xs">{clientSamples.anthropic.env}</Code>
                    <Group mt="sm" gap="xs">
                      <Button
                        variant="light"
                        size="xs"
                        leftSection={<Copy size={14} />}
                        onClick={() => copyText(clientSamples.anthropic.env, 'Claude / Anthropic 配置已复制')}
                      >
                        复制 Claude / Anthropic 配置
                      </Button>
                    </Group>
                  </Card>

                  <Card withBorder radius="md">
                     <Text size="xs" fw={600}>OpenAI Responses 兼容</Text>
                    <Code block mt="xs">{clientSamples.openai.env}</Code>
                    <Text size="xs" mt={8} className={colors.textMuted}>
                      OpenAI 兼容客户端仅支持 <Code>/v1/responses</Code>，示例 model 可替换为任意网关支持的模型。
                    </Text>
                    <Code block mt="xs">{clientSamples.openai.curl}</Code>
                    <Group mt="sm" gap="xs">
                      <Button
                        variant="light"
                        size="xs"
                        leftSection={<Copy size={14} />}
                        onClick={() => copyText(clientSamples.openai.env, 'OpenAI 兼容配置已复制')}
                      >
                        复制 OpenAI 兼容配置
                      </Button>
                      <Button
                        variant="light"
                        size="xs"
                        leftSection={<Copy size={14} />}
                        onClick={() => copyText(clientSamples.openai.curl, '兼容 Responses curl 已复制')}
                      >
                        复制兼容 Responses curl
                      </Button>
                      {copySuccess ? <Badge color="green" leftSection={<Check size={12} />}>{copySuccess}</Badge> : null}
                    </Group>
                  </Card>

                  <Card withBorder radius="md">
                    <Text size="xs" fw={600}>凭证口径</Text>
                    <Stack gap={6} mt="xs">
                      <Text size="xs" className={colors.textMuted}>客户端 {'->'} 本地网关 使用 API Key</Text>
                      <Code block>{integrationSummary.authLabel}</Code>
                      <Text size="xs" className={colors.textMuted}>本地网关 {'->'} Kiro API 使用本地 access token</Text>
                      <Code block>Authorization: Bearer &lt;local kiro access token&gt;</Code>
                    </Stack>
                  </Card>
                </Stack>
              </Card>

              <Alert color="blue" variant="light" title="接入提醒">
                客户端连本地网关只需要两件事：接入地址和客户端 API Key。运行状态、日志目录、错误排查统一放到“观测”页，不再在这里重复堆叠。
              </Alert>
            </div>
          </Tabs.Panel>

          <Tabs.Panel value="observability" pt="md">
            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.1fr)_minmax(340px,0.9fr)] gap-4">
              <Card withBorder radius="md" className={`${colors.card} ${colors.cardBorder}`}>
                <Stack gap="sm">
                  <Group justify="space-between">
                    <Group gap="xs">
                      <Shield size={16} />
                      <Text fw={600} className={colors.text}>观测总览</Text>
                    </Group>
                    <Group gap="xs">
                      <Badge color="blue" leftSection={<Radio size={12} />}>{`账号池 ${config.strategy}`}</Badge>
                      <Badge color={config.localOnly ? 'teal' : 'yellow'}>{config.localOnly ? '仅本机' : '允许远程'}</Badge>
                      <Badge color={status.running ? 'green' : 'red'}>{status.running ? '运行中' : '已停止'}</Badge>
                      <Button variant="light" size="xs" leftSection={<RefreshCw size={14} />} onClick={handleRefresh} loading={loading}>
                        刷新状态
                      </Button>
                      <Button variant="light" size="xs" color="gray" onClick={handleClearErrors} disabled={!errorHistory.length}>
                        清空错误
                      </Button>
                    </Group>
                  </Group>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Card withBorder radius="md">
                      <Text size="xs" className={colors.textMuted}>监听地址</Text>
                      <Text fw={700} className={colors.text}>{statusSummary.listen}</Text>
                    </Card>
                    <Card withBorder radius="md">
                      <Text size="xs" className={colors.textMuted}>请求计数</Text>
                      <Text fw={700} className={colors.text}>{statusSummary.requests}</Text>
                    </Card>
                    <Card withBorder radius="md">
                      <Text size="xs" className={colors.textMuted}>路由策略</Text>
                      <Text fw={700} className={colors.text}>{statusSummary.routing}</Text>
                    </Card>
                    <Card withBorder radius="md">
                      <Text size="xs" className={colors.textMuted}>暴露范围</Text>
                      <Text fw={700} className={colors.text}>{statusSummary.exposure}</Text>
                    </Card>
                    <Card withBorder radius="md">
                      <Text size="xs" className={colors.textMuted}>Region / 日志级别</Text>
                      <Text fw={700} className={colors.text}>{statusSummary.region} / {statusSummary.logLevel}</Text>
                    </Card>
                    <Card withBorder radius="md">
                      <Text size="xs" className={colors.textMuted}>最后同步</Text>
                      <Text fw={700} className={colors.text}>{statusSummary.sync}</Text>
                    </Card>
                  </div>

                  <Alert color={errorHistory.length ? 'orange' : 'teal'} variant="light" title="运行摘要">
                    {`错误历史 ${statusSummary.errorCount}，当前${status.running ? '已启动' : '未启动'}，${hasUnsavedChanges ? '页面存在未保存变更。' : '页面配置已与已保存状态同步。'}`}
                  </Alert>
                </Stack>
              </Card>

              <Card withBorder radius="md" className={`${colors.card} ${colors.cardBorder}`}>
                <Stack gap="sm">
                  <Group justify="space-between">
                    <Text size="sm" fw={600}>运维与排障</Text>
                    <Badge color={errorHistory.length ? 'orange' : 'teal'}>{integrationSummary.errorDigest}</Badge>
                  </Group>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Card withBorder radius="md">
                      <Text size="xs" className={colors.textMuted}>日志状态</Text>
                      <Text fw={700} className={colors.text}>{integrationSummary.logDirState}</Text>
                    </Card>
                    <Card withBorder radius="md">
                      <Text size="xs" className={colors.textMuted}>错误摘要</Text>
                      <Text fw={700} className={colors.text}>{integrationSummary.errorDigest}</Text>
                    </Card>
                  </div>

                  <Card withBorder radius="md">
                    <Text size="xs" fw={600}>日志目录</Text>
                    <Text size="xs" mt={6} style={{ fontFamily: 'JetBrains Mono, monospace', wordBreak: 'break-all' }}>
                      {logDir || '尚未获取'}
                    </Text>
                    <Group mt="sm" gap="xs">
                      <Button variant="light" leftSection={<FolderOpen size={16} />} onClick={handleOpenLogDir}>
                        打开日志目录
                      </Button>
                    </Group>
                  </Card>

                  <Card withBorder radius="md">
                    <Text size="xs" fw={600}>流式 / 上游错误明细</Text>
                    <Stack gap={6} mt="xs">
                      {(errorHistory.length ? errorHistory : [{ message: '暂无流式错误', firstSeenAt: '-', lastSeenAt: '-', count: 1 }]).map((item, idx) => (
                        <Card key={`${item.message}-${idx}`} withBorder radius="md">
                          <Group justify="space-between" align="flex-start" mb="xs">
                            <Group gap="xs">
                              <AlertTriangle size={14} />
                              <Text size="sm" fw={600}>错误命中 {item.count} 次</Text>
                            </Group>
                            <Badge color="orange">{item.lastSeenAt}</Badge>
                          </Group>
                          <Code block style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                            {`首次: ${item.firstSeenAt}\n最近: ${item.lastSeenAt}\n次数: ${item.count}\n${item.message}`}
                          </Code>
                        </Card>
                      ))}
                    </Stack>
                  </Card>
                </Stack>
              </Card>
            </div>

            <Stack gap="md">
              <Card withBorder radius="md" className={`${colors.card} ${colors.cardBorder}`}>
                <Stack gap="sm">
                  <Group justify="space-between">
                    <Group gap="xs">
                      <Activity size={16} />
                      <Text fw={600} className={colors.text}>请求日志</Text>
                    </Group>
                    <Group gap="xs">
                      <Badge color="indigo">gateway-request-log.jsonl</Badge>
                      <Button
                        variant="light"
                        size="xs"
                        leftSection={<RefreshCw size={14} />}
                        onClick={() => loadRequestLogs()}
                        loading={requestLogsLoading}
                      >
                        刷新日志
                      </Button>
                      <Button
                        variant="light"
                        size="xs"
                        color="red"
                        onClick={handleClearRequestLogs}
                        loading={requestLogsLoading}
                        disabled={!requestLogs.length}
                      >
                        清空日志
                      </Button>
                      <Button
                        variant="light"
                        size="xs"
                        leftSection={<FolderOpen size={14} />}
                        onClick={handleOpenLogDir}
                      >
                        打开目录
                      </Button>
                    </Group>
                  </Group>

                  <Text size="sm" className={colors.textMuted}>
                    这里展示最近 120 条网关请求记录，按时间倒序读取本地 JSONL 文件。最后同步时间：{lastRequestLogsSyncAt}
                  </Text>

                  <div className="grid grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)] gap-3">
                    <Select
                      label="结果过滤"
                      data={[
                        { value: 'all', label: '全部结果' },
                        { value: 'success', label: '仅成功' },
                        { value: 'stream', label: '仅流式' },
                        { value: 'error', label: '仅错误' },
                      ]}
                      value={requestLogOutcome}
                      onChange={(value) => setRequestLogOutcome(value || 'all')}
                    />
                    <TextInput
                      label="关键词搜索"
                      placeholder="搜索模型、端点、IP、错误、原始请求或原始响应"
                      value={requestLogQuery}
                      onChange={(event) => setRequestLogQuery(event.currentTarget.value)}
                      leftSection={<Search size={14} />}
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                    <Card withBorder radius="md">
                      <Text size="xs" className={colors.textMuted}>显示中 / 总记录</Text>
                      <Text fw={700} className={colors.text}>{filteredRequestLogSummary.total} / {requestLogSummary.total}</Text>
                    </Card>
                    <Card withBorder radius="md">
                      <Text size="xs" className={colors.textMuted}>成功 / 流式</Text>
                      <Text fw={700} className={colors.text}>{filteredRequestLogSummary.success} / {filteredRequestLogSummary.streaming}</Text>
                    </Card>
                    <Card withBorder radius="md">
                      <Text size="xs" className={colors.textMuted}>错误数</Text>
                      <Text fw={700} className={colors.text}>{filteredRequestLogSummary.errors}</Text>
                    </Card>
                    <Card withBorder radius="md">
                      <Text size="xs" className={colors.textMuted}>最新记录 / 最长耗时</Text>
                      <Text fw={700} className={colors.text}>{filteredRequestLogSummary.latestOccurredAt}</Text>
                      <Text size="sm" className={colors.textMuted} mt={4}>{filteredRequestLogSummary.maxDurationLabel}</Text>
                    </Card>
                  </div>

                  <Card withBorder radius="md">
                    <Text size="xs" fw={600}>日志目录</Text>
                    <Text size="xs" mt={6} style={{ fontFamily: 'JetBrains Mono, monospace', wordBreak: 'break-all' }}>
                      {logDir || '尚未获取'}
                    </Text>
                  </Card>
                </Stack>
              </Card>

              <Card withBorder radius="md" className={`${colors.card} ${colors.cardBorder}`}>
                <Stack gap="sm">
                  <Group justify="space-between">
                    <Group gap="xs">
                      <Radio size={16} />
                      <Text fw={600} className={colors.text}>统计视图</Text>
                    </Group>
                    <Badge color={requestMetrics.errorRateLabel === '0%' ? 'teal' : 'orange'}>
                      成功率 {requestMetrics.successRateLabel} / 错误率 {requestMetrics.errorRateLabel}
                    </Badge>
                  </Group>

                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                    <Card withBorder radius="md">
                      <Text size="xs" className={colors.textMuted}>平均耗时</Text>
                      <Text fw={700} className={colors.text}>{requestMetrics.avgDurationLabel}</Text>
                    </Card>
                    <Card withBorder radius="md">
                      <Text size="xs" className={colors.textMuted}>模型数</Text>
                      <Text fw={700} className={colors.text}>{requestMetrics.uniqueModels}</Text>
                    </Card>
                    <Card withBorder radius="md">
                      <Text size="xs" className={colors.textMuted}>上游来源数</Text>
                      <Text fw={700} className={colors.text}>{requestMetrics.uniqueUpstreams}</Text>
                    </Card>
                    <Card withBorder radius="md">
                      <Text size="xs" className={colors.textMuted}>统计样本</Text>
                      <Text fw={700} className={colors.text}>{requestMetrics.total}</Text>
                    </Card>
                  </div>

                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                    <Card withBorder radius="md">
                      <Text size="xs" fw={600}>热门模型</Text>
                      <Stack mt="sm" gap={6}>
                        {renderMetricList(requestMetrics.topModels, '暂无模型统计')}
                      </Stack>
                    </Card>
                    <Card withBorder radius="md">
                      <Text size="xs" fw={600}>热门上游来源</Text>
                      <Stack mt="sm" gap={6}>
                        {renderMetricList(requestMetrics.topUpstreams, '暂无上游来源统计')}
                      </Stack>
                    </Card>
                    <Card withBorder radius="md">
                      <Text size="xs" fw={600}>状态码分布</Text>
                      <Stack mt="sm" gap={6}>
                        {renderMetricList(requestMetrics.topStatuses, '暂无状态码统计')}
                      </Stack>
                    </Card>
                    <Card withBorder radius="md">
                      <Text size="xs" fw={600}>端点 / Region</Text>
                      <Stack mt="sm" gap="xs">
                        <div>
                          <Text size="xs" className={colors.textMuted}>端点</Text>
                          <Stack mt={6} gap={6}>
                            {renderMetricList(requestMetrics.topEndpoints, '暂无端点统计')}
                          </Stack>
                        </div>
                        <div>
                          <Text size="xs" className={colors.textMuted}>Region</Text>
                          <Stack mt={6} gap={6}>
                            {renderMetricList(requestMetrics.topRegions, '暂无 Region 统计')}
                          </Stack>
                        </div>
                      </Stack>
                    </Card>
                  </div>
                </Stack>
              </Card>

              <Card withBorder radius="md" className={`${colors.card} ${colors.cardBorder}`}>
                <Stack gap="sm">
                  <Group justify="space-between">
                    <Text fw={600} className={colors.text}>最近请求明细</Text>
                    <Badge color={filteredRequestLogSummary.errors ? 'red' : 'teal'}>
                      {filteredRequestLogSummary.errors ? `${filteredRequestLogSummary.errors} 条错误` : '无错误记录'}
                    </Badge>
                  </Group>

                  {!filteredRequestLogs.length ? (
                    <Alert color="gray" variant="light" title="暂无请求日志">
                      {requestLogs.length
                        ? '当前筛选条件下没有匹配结果，请调整结果过滤或搜索关键词。'
                        : '当前还没有网关请求写入本地日志文件。启动网关并发起请求后，这里会显示最新记录。'}
                    </Alert>
                  ) : (
                    <Stack gap="sm">
                      {filteredRequestLogs.map((item, idx) => (
                        <Card
                          key={`${item.requestIndex || idx}-${item.occurredAt || idx}`}
                          withBorder
                          radius="md"
                        >
                          <Stack gap="xs">
                            <Group justify="space-between" align="flex-start">
                              <Stack gap={2}>
                                <Group gap="xs">
                                  <Badge color={getGatewayRequestOutcomeColor(item.outcome)}>{item.outcome || 'unknown'}</Badge>
                                  <Badge variant="light">{item.endpoint || '-'}</Badge>
                                  <Badge variant="light" color={item.statusCode >= 400 ? 'red' : 'gray'}>{item.statusCode || 0}</Badge>
                                  <Badge variant="light" color={item.stream ? 'blue' : 'gray'}>{item.stream ? 'stream' : 'non-stream'}</Badge>
                                </Group>
                                <Text size="sm" className={colors.textMuted}>
                                  #{item.requestIndex ?? '-'} · {item.occurredAt || '-'} · {item.clientIp || '-'}
                                </Text>
                              </Stack>
                              <Text size="sm" fw={700} className={colors.text}>
                                {formatGatewayRequestDuration(item.durationMs)}
                              </Text>
                            </Group>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              <Card withBorder radius="md">
                                <Text size="xs" className={colors.textMuted}>模型 / Region</Text>
                                <Text size="sm" fw={600} className={colors.text}>
                                  {item.model || '未记录模型'} / {item.region || '-'}
                                </Text>
                              </Card>
                              <Card withBorder radius="md">
                                <Text size="xs" className={colors.textMuted}>上游来源</Text>
                                <Text size="sm" fw={600} className={colors.text}>
                                  {item.upstreamSource || '未解析上游来源'}
                                </Text>
                              </Card>
                              <Card withBorder radius="md">
                                <Text size="xs" className={colors.textMuted}>客户端 / 计数</Text>
                                <Text size="sm" fw={600} className={colors.text}>
                                  {item.clientIp || '-'} / #{item.requestIndex ?? '-'}
                                </Text>
                              </Card>
                              <Card withBorder radius="md">
                                <Text size="xs" className={colors.textMuted}>请求类型</Text>
                                <Text size="sm" fw={600} className={colors.text}>
                                  {item.stream ? '流式返回' : '非流式返回'} / {item.endpoint || '-'}
                                </Text>
                              </Card>
                            </div>

                            {item.error ? (
                              <Code block style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                                {item.error}
                              </Code>
                            ) : null}

                            {item.requestBody || item.responseBody ? (
                              <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                                {item.requestBody ? (
                                  <details open={item.outcome === 'error'}>
                                    <summary className="cursor-pointer text-sm font-medium">原始请求</summary>
                                    <Code block mt="xs" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                                      {item.requestBody}
                                    </Code>
                                  </details>
                                ) : null}

                                {item.responseBody ? (
                                  <details open={item.outcome === 'error'}>
                                    <summary className="cursor-pointer text-sm font-medium">原始响应</summary>
                                    <Code block mt="xs" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                                      {item.responseBody}
                                    </Code>
                                  </details>
                                ) : null}
                              </div>
                            ) : null}
                          </Stack>
                        </Card>
                      ))}
                    </Stack>
                  )}
                </Stack>
              </Card>
            </Stack>
          </Tabs.Panel>
        </Tabs>
      </Stack>
    </div>
  )
}

export default GatewayPage
