import test from 'node:test'
import assert from 'node:assert/strict'
import { buildAccountListMaps } from './accountListMaps.js'

test('buildAccountListMaps creates lookup maps for tags and groups', () => {
  const { tagMap, groupMap } = buildAccountListMaps({
    tagDefinitions: [
      { id: 'tag-a', name: '标签A', color: '#123456' },
    ],
    groupDefinitions: [
      { id: 'group-a', name: '分组A', color: '#654321' },
    ],
  })

  assert.equal(tagMap.get('tag-a')?.name, '标签A')
  assert.equal(groupMap.get('group-a')?.name, '分组A')
})

test('buildAccountListMaps tolerates missing arrays', () => {
  const { tagMap, groupMap } = buildAccountListMaps({
    tagDefinitions: null,
    groupDefinitions: undefined,
  })

  assert.equal(tagMap.size, 0)
  assert.equal(groupMap.size, 0)
})