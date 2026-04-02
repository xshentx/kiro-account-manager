import { invoke } from '@tauri-apps/api/core'
import { parseAllowedIps } from './gatewayPageUtils'

export const DEFAULT_GATEWAY_CONFIG = {
  enabled: false,
  host: '127.0.0.1',
  port: 8765,
  apiKey: '',
  region: 'us-east-1',
  accountMode: 'single',
  accountId: null,
  groupId: null,
  strategy: 'round_robin',
  threshold: 90,
  localOnly: true,
  allowedIpsText: '',
  logLevel: 'debug',
}

export const DEFAULT_GATEWAY_STATUS = {
  running: false,
  host: '127.0.0.1',
  port: 8765,
  requestCount: 0,
  lastError: null,
}

export const buildGatewayConfigSnapshot = (config) => JSON.stringify({
  enabled: !!config.enabled,
  host: config.host || '',
  port: Number(config.port) || 0,
  apiKey: config.apiKey || '',
  region: config.region || 'us-east-1',
  accountMode: config.accountMode || 'single',
  accountId: config.accountId || null,
  groupId: config.groupId || null,
  strategy: config.strategy || 'round_robin',
  threshold: Number(config.threshold) || 90,
  localOnly: !!config.localOnly,
  allowedIpsText: config.allowedIpsText || '',
  logLevel: config.logLevel || 'debug',
})

export const buildGatewayRuntimeSnapshot = (config) => JSON.stringify({
  host: config.host || '',
  port: Number(config.port) || 0,
  apiKey: config.apiKey || '',
  region: config.region || 'us-east-1',
  accountMode: config.accountMode || 'single',
  accountId: config.accountId || null,
  groupId: config.groupId || null,
  strategy: config.strategy || 'round_robin',
  threshold: Number(config.threshold) || 90,
  localOnly: !!config.localOnly,
  allowedIpsText: config.allowedIpsText || '',
  logLevel: config.logLevel || 'debug',
})

export const hydrateGatewayConfig = (gatewayConfig) => ({
  enabled: gatewayConfig?.enabled ?? false,
  host: gatewayConfig?.host || '127.0.0.1',
  port: gatewayConfig?.port || 8765,
  apiKey: gatewayConfig?.access_token || gatewayConfig?.accessToken || '',
  region: gatewayConfig?.region || 'us-east-1',
  accountMode: gatewayConfig?.account_mode === 'local'
    ? 'single'
    : (gatewayConfig?.account_mode || gatewayConfig?.accountMode || 'single'),
  accountId: gatewayConfig?.account_id || gatewayConfig?.accountId || null,
  groupId: gatewayConfig?.group_id || gatewayConfig?.groupId || null,
  strategy: gatewayConfig?.strategy || 'round_robin',
  threshold: gatewayConfig?.threshold ?? 90,
  localOnly: gatewayConfig?.local_only ?? gatewayConfig?.localOnly ?? true,
  allowedIpsText: Array.isArray(gatewayConfig?.allowed_ips || gatewayConfig?.allowedIps)
    ? (gatewayConfig.allowed_ips || gatewayConfig.allowedIps).join('\n')
    : '',
  logLevel: gatewayConfig?.log_level || gatewayConfig?.logLevel || 'debug',
})

export const buildGatewayStatusState = (gatewayStatus, gatewayConfig, fallbackConfig = DEFAULT_GATEWAY_CONFIG) => ({
  running: gatewayStatus?.running ?? false,
  host: gatewayStatus?.host || gatewayConfig?.host || fallbackConfig.host,
  port: gatewayStatus?.port || gatewayConfig?.port || fallbackConfig.port,
  requestCount: gatewayStatus?.requestCount || 0,
  lastError: gatewayStatus?.lastError || null,
})

export const buildGatewayPayload = (config) => ({
  enabled: !!config.enabled,
  host: config.host,
  port: Number(config.port),
  accessToken: config.apiKey || null,
  region: config.region,
  accountMode: config.accountMode,
  accountId: config.accountId || null,
  groupId: config.groupId || null,
  strategy: config.strategy,
  threshold: Number(config.threshold) || 90,
  localOnly: !!config.localOnly,
  allowedIps: parseAllowedIps(config.allowedIpsText),
  logLevel: config.logLevel,
})

export const loadGatewayPageData = async () => {
  const [gatewayConfig, gatewayStatus, accounts, groups, logDir] = await Promise.all([
    invoke('get_gateway_config'),
    invoke('get_gateway_status'),
    invoke('get_accounts'),
    invoke('get_groups'),
    invoke('get_gateway_log_dir'),
  ])

  return {
    gatewayConfig,
    gatewayStatus,
    accounts: Array.isArray(accounts) ? accounts : [],
    groups: Array.isArray(groups) ? groups : [],
    logDir: String(logDir || ''),
  }
}

export const fetchGatewayStatus = async () => invoke('get_gateway_status')

export const fetchGatewayRequestLogs = async (limit = 120) => {
  const logs = await invoke('get_gateway_request_logs', { limit })
  return Array.isArray(logs) ? logs : []
}

export const saveGatewayConfig = async (config) => invoke('save_gateway_config', {
  config: buildGatewayPayload(config),
})

export const startGateway = async (config) => invoke('start_gateway', {
  config: buildGatewayPayload(config),
})

export const stopGateway = async () => invoke('stop_gateway')

export const openGatewayLogDir = async () => invoke('open_gateway_log_dir')

export const clearGatewayRequestLogs = async () => invoke('clear_gateway_request_logs')
