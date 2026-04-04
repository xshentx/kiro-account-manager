import test from 'node:test'
import assert from 'node:assert/strict'
import { extractCachedAvailableModels, resolveAvailableModels } from './availableModelsState.js'

const cachedModels = [{ modelId: 'm-1', modelName: 'Model 1' }]

test('extractCachedAvailableModels returns models from account cache response', () => {
  const models = extractCachedAvailableModels({
    availableModelsCache: {
      response: {
        models: cachedModels,
      },
    },
  })

  assert.deepEqual(models, cachedModels)
})

test('resolveAvailableModels prefers already loaded models over cache', () => {
  const localModels = [{ modelId: 'live-1', modelName: 'Live 1' }]
  const resolved = resolveAvailableModels(localModels, {
    availableModelsCache: {
      response: {
        models: cachedModels,
      },
    },
  })

  assert.deepEqual(resolved, localModels)
})

test('resolveAvailableModels falls back to cache when local state is empty', () => {
  const resolved = resolveAvailableModels(null, {
    availableModelsCache: {
      response: {
        models: cachedModels,
      },
    },
  })

  assert.deepEqual(resolved, cachedModels)
})

test('extractCachedAvailableModels tolerates malformed cache', () => {
  const models = extractCachedAvailableModels({
    availableModelsCache: {
      response: null,
    },
  })

  assert.equal(models, null)
})