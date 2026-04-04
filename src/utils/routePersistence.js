const TRANSIENT_ROUTE_IDS = new Set(['callback'])

export function shouldPersistRoute(routeId) {
  return !TRANSIENT_ROUTE_IDS.has(routeId)
}

export function getMountedRouteIds(currentRouteIds, activeRouteId) {
  if (!shouldPersistRoute(activeRouteId)) {
    return [activeRouteId]
  }

  const persistedRouteIds = Array.isArray(currentRouteIds)
    ? currentRouteIds.filter(shouldPersistRoute)
    : []

  if (persistedRouteIds.includes(activeRouteId)) {
    return persistedRouteIds
  }

  return [...persistedRouteIds, activeRouteId]
}
