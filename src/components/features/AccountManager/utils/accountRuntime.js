function pickNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed) return trimmed
    }
  }
  return ''
}

function normalizeTagLinks(tagLinks) {
  if (!Array.isArray(tagLinks)) return []

  return tagLinks
    .filter(link => link && typeof link === 'object')
    .map(link => ({
      ...link,
      tagId: pickNonEmptyString(link.tagId),
      tagName: pickNonEmptyString(link.tagName) || null,
      linkedAt: pickNonEmptyString(link.linkedAt),
    }))
    .filter(link => link.tagId)
}

export function getSafeAccountDisplayName(account) {
  return pickNonEmptyString(
    account?.email,
    account?.userId,
    account?.user_id,
    account?.label,
  ) || 'Unknown'
}

export function getSafeAccountInitial(account) {
  return getSafeAccountDisplayName(account).charAt(0).toUpperCase() || 'U'
}

export function normalizeAccountForUi(account) {
  const source = account && typeof account === 'object' ? account : {}

  return {
    ...source,
    email: pickNonEmptyString(source.email),
    userId: pickNonEmptyString(source.userId),
    user_id: pickNonEmptyString(source.user_id),
    label: pickNonEmptyString(source.label),
    status: pickNonEmptyString(source.status) || 'unknown',
    provider: pickNonEmptyString(source.provider),
    authMethod: pickNonEmptyString(source.authMethod, source.auth_method),
    addedAt: pickNonEmptyString(source.addedAt),
    expiresAt: pickNonEmptyString(source.expiresAt),
    groupId: pickNonEmptyString(source.groupId) || null,
    machineId: pickNonEmptyString(source.machineId),
    tagLinks: normalizeTagLinks(source.tagLinks),
    usageData: source.usageData && typeof source.usageData === 'object' ? source.usageData : null,
  }
}
