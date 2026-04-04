import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeAccountForUi, getSafeAccountDisplayName } from './accountRuntime.js'

test('normalizeAccountForUi repairs legacy nullable account fields', () => {
  const normalized = normalizeAccountForUi({
    id: 'acc-1',
    email: '   ',
    userId: 'user-1',
    label: null,
    status: null,
    provider: null,
    tagLinks: null,
    usageData: null,
  })

  assert.equal(normalized.id, 'acc-1')
  assert.equal(normalized.label, '')
  assert.equal(normalized.status, 'unknown')
  assert.equal(normalized.provider, '')
  assert.deepEqual(normalized.tagLinks, [])
  assert.equal(getSafeAccountDisplayName(normalized), 'user-1')
})
