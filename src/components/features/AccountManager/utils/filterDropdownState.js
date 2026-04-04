const STATUS_LABELS = {
  normal: '正常',
  capped: '封顶',
  banned: '封禁',
  invalid: '失效',
  expired: '过期',
}

const SPECIAL_GROUP_LABELS = {
  __none__: '无分组',
  __has__: '有分组',
}

const SPECIAL_TAG_LABELS = {
  __none__: '无标签',
  __has__: '有标签',
}

function pickFirst(values) {
  return Array.isArray(values) ? values[0] || '' : values || ''
}

export function resolveGroupFilterLabel(selectedGroup, allGroups = []) {
  if (!selectedGroup) return ''

  const groupMap = new Map((Array.isArray(allGroups) ? allGroups : []).map(group => [group.id, group]))
  return SPECIAL_GROUP_LABELS[selectedGroup] || groupMap.get(selectedGroup)?.name || selectedGroup
}

export function countActiveFilters({ filters, selectedGroup, selectedTag }) {
  return [
    filters?.subscriptions?.length || 0,
    filters?.statuses?.length || 0,
    filters?.providers?.length || 0,
    filters?.usageRange ? 1 : 0,
    selectedGroup ? 1 : 0,
    selectedTag ? 1 : 0,
  ].reduce((total, count) => total + count, 0)
}

export function buildFilterSummaryItems({
  filters,
  selectedGroup,
  selectedTag,
  allGroups = [],
  allTags = [],
}) {
  const items = []
  const tagMap = new Map((Array.isArray(allTags) ? allTags : []).map(tag => [tag.id, tag]))

  if (selectedGroup) {
    items.push({
      key: 'group',
      label: '分组',
      value: resolveGroupFilterLabel(selectedGroup, allGroups),
    })
  }

  if (selectedTag) {
    items.push({
      key: 'tag',
      label: '标签',
      value: SPECIAL_TAG_LABELS[selectedTag] || tagMap.get(selectedTag)?.name || selectedTag,
    })
  }

  const subscription = pickFirst(filters?.subscriptions)
  if (subscription) {
    items.push({ key: 'subscription', label: '订阅', value: subscription })
  }

  const status = pickFirst(filters?.statuses)
  if (status) {
    items.push({ key: 'status', label: '状态', value: STATUS_LABELS[status] || status })
  }

  const provider = pickFirst(filters?.providers)
  if (provider) {
    items.push({ key: 'provider', label: '登录方式', value: provider })
  }

  if (filters?.usageRange) {
    items.push({ key: 'usageRange', label: '使用量', value: filters.usageRange })
  }

  return items
}
