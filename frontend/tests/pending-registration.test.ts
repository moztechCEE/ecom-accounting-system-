import assert from 'node:assert/strict'
import test from 'node:test'
import { clearPendingRegistration, pendingRegistrationKey, PendingRegistrationError, readPendingRegistration, registrationTokenMatchesActor, savePendingRegistration, validatePendingRegistration } from '../src/pages/after-sales/pending-registration.ts'
import type { PendingRegistration, PendingStorage } from '../src/pages/after-sales/pending-registration.ts'

const scope = { actorId: 'actor-a', entityId: 'entity-a' }
test('registration JWT subject must match the captured actor without granting authorization', () => {
  const token = `e30.${Buffer.from(JSON.stringify({ sub: 'actor-a' })).toString('base64url')}.fictional`
  assert.equal(registrationTokenMatchesActor(token, 'actor-a'), true)
  assert.equal(registrationTokenMatchesActor(token, 'actor-b'), false)
  assert.equal(registrationTokenMatchesActor('invalid-token', 'actor-a'), false)
})
const attempt: PendingRegistration = {
  schema: 'corely.doa.pending-registration.v1', ...scope,
  requestId: '55555555-5555-4555-8555-555555555555', createdAt: '2016-01-01T00:00:00Z',
  request: { brand: 'BONSON', customerKind: 'TO_B', payload: { type: 'REPAIR', sourceChannel: 'LINE', contactName: 'Synthetic', contactPhone: '0900000000', contactAddress: 'Synthetic address', contactEmail: 'synthetic@example.invalid', items: [{ productId: 'ERP-product-1', quantity: 1 }], detail: { faultDescription: 'Synthetic', requiresPayment: false, serialNumber: null, productId: 'ERP-product-1' } } },
}
function memory() {
  const values = new Map<string, string>()
  const storage: PendingStorage = { getItem: key => values.get(key) || null, setItem: (key, value) => { values.set(key, value) }, removeItem: key => { values.delete(key) } }
  return { storage, values }
}
test('pending attempt resumes the exact original body and UUID without expiration', () => {
  const { storage } = memory()
  savePendingRegistration(storage, scope, attempt)
  assert.equal(JSON.stringify(readPendingRegistration(storage, scope)), JSON.stringify(attempt))
  assert.equal(readPendingRegistration(storage, scope)?.createdAt, '2016-01-01T00:00:00Z')
  clearPendingRegistration(storage, scope, attempt.requestId)
  assert.equal(readPendingRegistration(storage, scope), null)
})
test('a different actor or company cannot read or substitute another pending attempt', () => {
  const { storage, values } = memory()
  savePendingRegistration(storage, scope, attempt)
  for (const other of [{ actorId: 'actor-b', entityId: scope.entityId }, { actorId: scope.actorId, entityId: 'entity-b' }]) {
    assert.equal(readPendingRegistration(storage, other), null)
    values.set(pendingRegistrationKey(other), JSON.stringify(attempt))
    assert.throws(() => readPendingRegistration(storage, other), (error: unknown) => error instanceof PendingRegistrationError && error.code === 'INVALID')
  }
  assert.equal(readPendingRegistration(storage, scope)?.requestId, attempt.requestId)
})
test('another tab intent cannot overwrite or clear an outstanding request', () => {
  const { storage } = memory()
  savePendingRegistration(storage, scope, attempt)
  const next = { ...attempt, requestId: '66666666-6666-4666-8666-666666666666' }
  assert.throws(() => savePendingRegistration(storage, scope, next), (error: unknown) => error instanceof PendingRegistrationError && error.code === 'CONFLICT' && error.pending?.requestId === attempt.requestId)
  assert.throws(() => clearPendingRegistration(storage, scope, next.requestId), (error: unknown) => error instanceof PendingRegistrationError && error.code === 'CONFLICT')
  assert.equal(JSON.stringify(readPendingRegistration(storage, scope)), JSON.stringify(attempt))
})
test('storage failures and non-registration secret fields fail closed', () => {
  const blocked: PendingStorage = { getItem: () => null, setItem: () => { throw new Error('quota') }, removeItem: () => {} }
  assert.throws(() => savePendingRegistration(blocked, scope, attempt), (error: unknown) => error instanceof PendingRegistrationError && error.code === 'STORAGE')
  for (const mutated of [{ ...attempt, token: 'forbidden' }, { ...attempt, request: { ...attempt.request, ticket: 'forbidden' } }, { ...attempt, request: { ...attempt.request, payload: { ...attempt.request.payload, detail: { ...attempt.request.payload.detail, bankCredential: 'forbidden' } } } }]) assert.throws(() => validatePendingRegistration(mutated, scope), PendingRegistrationError)
})
