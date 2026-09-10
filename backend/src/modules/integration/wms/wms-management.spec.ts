import { generateKeyPairSync } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { projectManagement } from './wms-management.contract';
import { WmsWorkspaceBridge } from './wms-workspace-bridge';
const report = {
  contractVersion: 'wms.management-read.v1',
  source: 'wms',
  mode: 'read_only',
  section: 'logs',
  coverage: 'approved_order_mappings',
  observedAt: '2026-09-11T00:00:00Z',
  allowedActions: [],
  days: 30,
  page: 1,
  total: 1005,
  records: Array.from({ length: 25 }, (_, i) => ({
    id: String(i),
    orderId: 'order-1',
    orderNumber: 'TEST-1',
    brand: 'TEST',
    actor: 'Test worker',
    occurredAt: '2026-09-11T00:00:00Z',
  })),
  breakdown: [{ label: 'pick', count: 1005 }],
};
describe('warehouse management contract', () => {
  it('rejects partial counts, writes, cross-report payloads and drops unknown fields', () => {
    expect(
      projectManagement({ ...report, privateData: 'secret' }, 'logs'),
    ).not.toHaveProperty('privateData');
    expect(() =>
      projectManagement({ ...report, allowedActions: ['approve'] }, 'logs'),
    ).toThrow();
    expect(() => projectManagement({ ...report, total: 2 }, 'logs')).toThrow();
    expect(() =>
      projectManagement({ ...report, records: [] }, 'logs'),
    ).toThrow();
    expect(() => projectManagement(report, 'defects')).toThrow();
  });
  it('requires each live report permission; preserves actor and uses only the read path even when commands enabled', async () => {
    const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const p: any = {
      user: { findUnique: jest.fn().mockResolvedValue({ isActive: true }) },
      userRole: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            {
              role: {
                code: 'EMPLOYEE',
                permissions: ['wms_tasks', 'wms_logs'].map((resource) => ({
                  permission: { resource, action: 'read' },
                })),
              },
            },
          ]),
      },
    };
    const env = {
      WMS_WORKSPACE_READ_ENABLED: 'true',
      WMS_WORKSPACE_COMMANDS_ENABLED: 'true',
      WMS_WORKSPACE_URL: 'https://wms.example/',
      WMS_WORKSPACE_ISSUER: 'test-erp',
      WMS_WORKSPACE_AUDIENCE: 'test-wms',
      WMS_WORKSPACE_PRIVATE_KEY: keys.privateKey
        .export({ type: 'pkcs8', format: 'pem' })
        .toString(),
    };
    const fetcher = jest.fn().mockImplementation(async (url, options) => {
      expect(String(url)).toContain('/api/integrations/erp/v1/management/logs');
      expect(String(url)).toContain('days=30');
      expect(options.method).toBe('GET');
      const token = await new JwtService().verifyAsync(
        options.headers.Authorization.slice(7),
        {
          publicKey: keys.publicKey
            .export({ type: 'spki', format: 'pem' })
            .toString(),
          algorithms: ['RS256'],
          issuer: 'test-erp',
          audience: 'test-wms',
        },
      );
      expect(token.sub).toBe('staff');
      expect(token.entityId).toBe('company');
      expect(token.station).toBe('logs');
      expect(token.scope).toBe('wms.workspace.read');
      return new Response(JSON.stringify(report), {
        headers: { 'content-type': 'application/json' },
      });
    });
    const bridge = new WmsWorkspaceBridge(p, env, fetcher);
    await bridge.readManagement(
      'staff',
      { entityId: 'company', days: 30 },
      'logs',
    );
    await expect(
      bridge.readManagement('staff', { entityId: 'company' }, 'exceptions'),
    ).rejects.toThrow('WMS_STATION_DENIED');
    await expect(
      bridge.readManagement(
        'staff',
        { entityId: 'company' },
        'constructor' as any,
      ),
    ).rejects.toThrow('WMS_SECTION_INVALID');
    p.userRole.findMany.mockResolvedValue([
      {
        role: {
          code: 'EMPLOYEE',
          permissions: [
            { permission: { resource: 'wms_tasks', action: 'read' } },
          ],
        },
      },
    ]);
    await expect(
      bridge.readManagement('staff', { entityId: 'company' }, 'logs'),
    ).rejects.toThrow('WMS_STATION_DENIED');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
