import test from 'node:test'
import assert from 'node:assert/strict'
import { getMountedRouteIds, shouldPersistRoute } from './routePersistence.js'

test('shouldPersistRoute keeps normal sidebar pages mounted', () => {
  assert.equal(shouldPersistRoute('accounts'), true)
  assert.equal(shouldPersistRoute('home'), true)
})

test('shouldPersistRoute excludes callback route from persistence', () => {
  assert.equal(shouldPersistRoute('callback'), false)
})

test('getMountedRouteIds appends unseen persistent route once', () => {
  assert.deepEqual(getMountedRouteIds(['home'], 'accounts'), ['home', 'accounts'])
})

test('getMountedRouteIds does not duplicate existing route', () => {
  assert.deepEqual(getMountedRouteIds(['home', 'accounts'], 'accounts'), ['home', 'accounts'])
})

test('getMountedRouteIds returns only transient route when active route should not persist', () => {
  assert.deepEqual(getMountedRouteIds(['home', 'accounts'], 'callback'), ['callback'])
})