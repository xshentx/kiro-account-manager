export function extractCachedAvailableModels(account) {
  const models = account?.availableModelsCache?.response?.models
  return Array.isArray(models) ? models : null
}

export function resolveAvailableModels(availableModels, account) {
  if (Array.isArray(availableModels)) {
    return availableModels
  }

  return extractCachedAvailableModels(account)
}
