import assert from 'node:assert/strict'
import test from 'node:test'
import { wmsPortalOrigin, wmsPortalLinks, wmsPortalDestination, WMS_PORTAL_SECTIONS } from '../src/config/wms-portal'
import { navigationLeaves, workspaceNavigation } from '../src/config/navigation'
import type { User } from '../src/types'
const admin = { roles: ['ADMIN'], permissions: [] } as unknown as User
const picker = { roles: ['EMPLOYEE'], permissions: ['wms_tasks:read', 'wms_picking:execute', 'profile_self:read'] } as unknown as User
const origin = 'https://corely-wms-dev-sp5g377smq-de.a.run.app'
Object.defineProperty(globalThis, 'window', { value: { __APP_CONFIG__: { devEnvironment: true, wmsPortalUrl: origin } }, configurable: true })

test('all sections lead to WMS routes without ERP credentials', () => {
  const links = navigationLeaves(workspaceNavigation(admin, 'all')).filter(x => x.externalUrl)
  assert.equal(links.length, WMS_PORTAL_SECTIONS.length)
  for (const link of links) {
    assert.equal(new URL(link.externalUrl!).origin, origin)
    assert(!/token|password|email|entityId/.test(link.externalUrl!))
  }
  assert.equal(wmsPortalDestination(admin, '/warehouse/scan-errors')?.externalUrl, origin + '/admin/scan-errors')
  assert.equal(wmsPortalDestination(picker, '/warehouse/workstation')?.externalUrl, origin + '/tasks')
})
test('operators retain only authorized sections and personal pages', () => {
  const links = navigationLeaves(workspaceNavigation(picker, 'warehouse'))
  assert(links.some(x => x.key === '/warehouse/picking'))
  assert(links.some(x => x.key === '/profile'))
  assert(!links.some(x => ['/warehouse/packing','/warehouse/dispatch','/warehouse/overview','/warehouse/users','/warehouse/logistics'].includes(x.key)))
  assert.equal(wmsPortalDestination(picker, '/warehouse/users'), undefined)
  assert.equal(wmsPortalLinks({ ...picker, permissions: [] }).length, 0)
})
test('DEV rejects production, arbitrary hosts and credential-bearing URLs', () => {
  const config = window.__APP_CONFIG__!
  for (const url of ['https://corely-wms-sp5g377smq-de.a.run.app', 'https://evil.example', origin + '/login', origin + '?token=x', origin + '#x', 'https://u:p@corely-wms-dev-sp5g377smq-de.a.run.app', 'http://corely-wms-dev-sp5g377smq-de.a.run.app']) {
    config.wmsPortalUrl = url
    assert.equal(wmsPortalOrigin(), '')
  }
  config.wmsPortalUrl = origin
  assert.equal(wmsPortalOrigin(), origin)
  config.devEnvironment = false
  assert.equal(wmsPortalOrigin(), '')
  config.wmsPortalUrl = 'https://corely-wms-sp5g377smq-de.a.run.app'
  assert.equal(wmsPortalOrigin(), config.wmsPortalUrl)
  config.devEnvironment = true
  config.wmsPortalUrl = origin
})
