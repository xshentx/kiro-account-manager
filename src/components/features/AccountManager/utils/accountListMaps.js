export function buildAccountListMaps({ tagDefinitions, groupDefinitions }) {
  const safeTagDefinitions = Array.isArray(tagDefinitions) ? tagDefinitions : []
  const safeGroupDefinitions = Array.isArray(groupDefinitions) ? groupDefinitions : []

  return {
    tagMap: new Map(safeTagDefinitions.map(tag => [tag.id, tag])),
    groupMap: new Map(safeGroupDefinitions.map(group => [group.id, group])),
  }
}
