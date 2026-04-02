import { useEffect } from 'react'
import { fetchGatewayRequestLogs, fetchGatewayStatus } from './gatewayPageState'
import { formatGatewayTimestamp } from './gatewayPageUtils'

export function useGatewayPolling({
  activeTab,
  fallbackConfig,
  onStatus,
  onRequestLogs,
}) {
  useEffect(() => {
    const timer = setInterval(() => {
      fetchGatewayStatus()
        .then((status) => {
          onStatus({
            status,
            fallbackConfig,
            syncedAt: formatGatewayTimestamp(),
          })
        })
        .catch(() => {})
    }, 2000)

    return () => clearInterval(timer)
  }, [fallbackConfig, onStatus])

  useEffect(() => {
    if (activeTab !== 'observability') {
      return undefined
    }

    fetchGatewayRequestLogs()
      .then((logs) => {
        onRequestLogs({
          logs,
          syncedAt: formatGatewayTimestamp(),
        })
      })
      .catch(() => {})

    const timer = setInterval(() => {
      fetchGatewayRequestLogs()
        .then((logs) => {
          onRequestLogs({
            logs,
            syncedAt: formatGatewayTimestamp(),
          })
        })
        .catch(() => {})
    }, 5000)

    return () => clearInterval(timer)
  }, [activeTab, onRequestLogs])
}
