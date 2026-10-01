/**
 * Synthetic localhost fixture. Never imported by AppModule or a production entrypoint.
 * After preparing the separate PostgreSQL cluster/schema on 57663, run in backend:
 * REPAIR_LOCAL_TEST=true DATABASE_URL='postgresql://local:doa-local-fixture@127.0.0.1:57663/doa_workbench' node -r ts-node/register/transpile-only test/repair-local-fixture.ts
 * Frontend (separate terminal in frontend): REPAIR_LOCAL_TEST=true node scripts/repair-preview.mjs
 * Open http://127.0.0.1:57656/_repair_fixture; API uses Bearer fixture-doa-tech/clerk/csr/other.
 * Restarting preserves existing item progress/documents. No original fixture or external worker is used.
 */
import 'reflect-metadata';
import { Controller, Get, Module, Param, Patch, Req, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { AuthService } from '../src/modules/auth/auth.service';
import { MailroomController } from '../src/modules/mailroom/mailroom.controller';
import { MailroomService } from '../src/modules/mailroom/mailroom.service';
import { MailroomSyncService } from '../src/modules/mailroom/mailroom-sync.service';
import { MailroomTabletController } from '../src/modules/mailroom/mailroom-tablet.controller';
import { MailroomTabletService } from '../src/modules/mailroom/mailroom-tablet.service';
import { RepairWorkbenchController } from '../src/modules/mailroom/repair-workbench.controller';
import { RepairWorkbenchService } from '../src/modules/mailroom/repair-workbench.service';
import { NotificationGateway } from '../src/modules/notification/notification.gateway';
import type { SourceCase } from '../src/modules/mailroom/mailroom.contract';

export const repairLocalDatabase = 'postgresql://local:doa-local-fixture@127.0.0.1:57663/doa_workbench';
export const repairFixturePassword = 'DoaFixturePass2026!';
const COMPANY = 'fixture-doa-company';
const OTHER_COMPANY = 'fixture-doa-other';
const USERS = ['fixture-doa-tech', 'fixture-doa-clerk', 'fixture-doa-csr', 'fixture-doa-other'] as const;
export function requireRepairLocalFixture() {
  if (process.env.REPAIR_LOCAL_TEST !== 'true' || process.env.DATABASE_URL !== repairLocalDatabase)
    throw new Error('Requires the isolated DOA fixture database and REPAIR_LOCAL_TEST=true.');
}
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
function source(id: string, status: string, allowed: boolean): SourceCase {
  return {
    id, number: id.replace('fixture-doa-', 'DOA-DEMO-'), type: 'REPAIR',
    brand: 'MOZTECH 本機示範', version: 'fixture-v1', status,
    statusLabel: status === 'IN_TRANSIT' ? '在途' : status === 'PENDING_ARRIVAL' ? '待到貨' : status === 'PENDING_PAYMENT' ? '待付款／對帳（示範）' : status === 'PENDING_REPAIR' ? '維修已放行（示範）' : '客服確認中（示範）',
    repairAllowed: allowed, customerLabel: '合成測試顧客',
    assigneeId: 'fixture-doa-csr', assigneeEmail: 'fixture-doa-csr@example.invalid', assigneeName: '客服覆核（示範）',
    items: [{ id: `${id}-line`, name: '行動電源（本機合成樣本）', sku: 'DOA-DEMO-PB', serialNumber: `SN-${id}`, quantity: 1 }],
  };
}
const SOURCES = [
  source('fixture-doa-source-unclaimed', 'PENDING_REPAIR', true),
  source('fixture-doa-source-owned', 'PENDING_REPAIR', true),
  source('fixture-doa-source-held', 'PENDING_PAYMENT', false),
  source('fixture-doa-source-waiting', 'PENDING_REPAIR', true),
  source('fixture-doa-awaiting', 'PENDING_ARRIVAL', false),
  source('fixture-doa-transit', 'IN_TRANSIT', false),
];

/** Fixed synthetic sources only. This object never calls MailroomSyncService.request(). */
export function repairFixtureSync(db: PrismaService): MailroomSyncService {
  return {
    async cases(entityId: string, search = '', id?: string, options: { awaiting?: boolean; cursor?: string } = {}) {
      requireRepairLocalFixture();
      if (entityId !== COMPANY) return { items: [], nextCursor: null };
      const found: SourceCase[] = [];
      for (const original of SOURCES) {
        if (id && original.id !== id) continue;
        if (search && !`${original.number} ${original.customerLabel}`.toLowerCase().includes(search.toLowerCase())) continue;
        const received = await db.mailroomItem.count({ where: { entityId, receipt: { sourceCaseId: original.id } } });
        const remaining = Math.max(0, 1 - received);
        if (!id && options.awaiting && !remaining) continue;
        found.push({ ...original, expectedQuantity: 1, receivedQuantity: received, remainingQuantity: remaining,
          items: original.items.map((item) => ({ ...item, receivedQuantity: received, remainingQuantity: remaining })) });
      }
      return { items: found, nextCursor: null };
    },
    // Deliberately no delivery worker: local outbox stays pending and inspectable.
    async deliverPending() {},
  } as unknown as MailroomSyncService;
}

export async function seedRepairFixture(db: PrismaService) {
  requireRepairLocalFixture();
  const personal = ['profile_self:read', 'attendance_self:read', 'leave_self:read'];
  const roleDefinitions = [
    { code: 'REPAIR_TECHNICIAN', name: '維修師', grants: ['repair_workbench:read', 'repair_workbench:update', ...personal] },
    { code: 'MAILROOM_OPERATOR', name: '收發室人員', grants: ['mailroom:read', 'mailroom:create', 'mailroom:update', ...personal] },
    { code: 'FIXTURE_DOA_CSR', name: '客服覆核（DOA 示範）', grants: ['mailroom:read', 'mailroom:review', ...personal] },
  ];
  for (const definition of roleDefinitions) {
    const permissions: { id: string }[] = [];
    for (const grant of definition.grants) {
      const [resource, action] = grant.split(':');
      permissions.push(await db.permission.upsert({ where: { resource_action: { resource, action } }, update: {},
        create: { resource, action, description: '隔離 DOA fixture 權限' } }));
    }
    const role = await db.role.upsert({ where: { code: definition.code }, update: { name: definition.name },
      create: { code: definition.code, name: definition.name } });
    // Restore only fixture role policies; never delete or reset documents/cases.
    await db.rolePermission.deleteMany({ where: { roleId: role.id, permissionId: { notIn: permissions.map((p) => p.id) } } });
    for (const permission of permissions)
      await db.rolePermission.upsert({ where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } }, update: {},
        create: { roleId: role.id, permissionId: permission.id } });
  }
  for (const id of [COMPANY, OTHER_COMPANY])
    await db.entity.upsert({ where: { id }, update: {}, create: { id, loginCode: id, name: id === COMPANY ? 'DOA 本機合成公司' : 'DOA 他公司合成測試', country: 'TW', baseCurrency: 'TWD' } });
  const passwordHash = await bcrypt.hash(repairFixturePassword, 10);
  for (const [id, name, code, department] of [
    ['fixture-doa-tech', '維修師（示範）', 'REPAIR_TECHNICIAN', '維修部'],
    ['fixture-doa-clerk', '收發室人員（示範）', 'MAILROOM_OPERATOR', '行政部'],
    ['fixture-doa-csr', '客服覆核（示範）', 'FIXTURE_DOA_CSR', '客服部'],
    ['fixture-doa-other', '他公司維修師（示範）', 'REPAIR_TECHNICIAN', '維修部'],
  ] as const) {
    const entityId = id === 'fixture-doa-other' ? OTHER_COMPANY : COMPANY;
    const departmentId = `dept-${id}`;
    await db.department.upsert({ where: { id: departmentId }, update: {}, create: { id: departmentId, entityId, name: department } });
    await db.user.upsert({ where: { id }, update: { passwordHash }, create: {
      id, name, email: `${id}@example.invalid`, passwordHash,
      entityMemberships: { create: { entityId, isPrimary: true } },
      roles: { create: { role: { connect: { code } } } },
      employee: { create: { entityId, departmentId, employeeNo: id, name, country: 'TW', hireDate: new Date('2026-01-01'), salaryBaseOriginal: 0, salaryBaseBase: 0 } },
    } });
  }
  const submittedInspection = {
    number: 'INS-DOA-DEMO-WAITING', revision: 1, status: 'SUBMITTED', authorId: 'fixture-doa-tech', authorName: '維修師（示範）',
    updatedAt: '2026-10-02T04:00:00.000Z', submittedAt: '2026-10-02T04:00:00.000Z',
    data: { complaint: '顧客描述無法充電（合成示範）', reproduction: 'YES', testConditions: '示範充電器與線材交叉測試',
      checks: [{ name: '充電功能', result: 'FAIL', observation: '在合成測試條件下重現' }], diagnosis: '充電模組異常（合成示範）',
      causeStatus: 'CONFIRMED', plan: 'REPLACE', planNote: '建議一對一整新品替換，待客服確認', feeSuggestion: 'PAID', estimateAmount: 350, estimateNote: '合成估價 350，非正式對客報價' },
  };
  for (const item of [
    { id: 'fixture-doa-unclaimed', sourceId: 'fixture-doa-source-unclaimed', status: 'WAITING_REPAIR_ACCEPTANCE', owner: null, next: null, company: COMPANY },
    { id: 'fixture-doa-owned', sourceId: 'fixture-doa-source-owned', status: 'REPAIR_RECEIVED', owner: 'fixture-doa-tech', next: 'fixture-doa-tech', company: COMPANY },
    { id: 'fixture-doa-held', sourceId: 'fixture-doa-source-held', status: 'INSPECTING', owner: 'fixture-doa-tech', next: 'fixture-doa-tech', company: COMPANY },
    { id: 'fixture-doa-waiting', sourceId: 'fixture-doa-source-waiting', status: 'WAITING_CUSTOMER', owner: 'fixture-doa-tech', next: 'fixture-doa-tech', company: COMPANY },
    { id: 'fixture-doa-other-item', sourceId: null, status: 'REPAIR_RECEIVED', owner: 'fixture-doa-other', next: 'fixture-doa-other', company: OTHER_COMPANY },
  ]) {
    const original = SOURCES.find((s) => s.id === item.sourceId);
    const clerkId = item.company === COMPANY ? 'fixture-doa-clerk' : 'fixture-doa-other';
    const receiptId = `receipt-${item.id}`;
    await db.mailroomReceipt.upsert({ where: { id: receiptId }, update: {}, create: {
      id: receiptId, entityId: item.company, number: `RCV-${item.id}`, category: 'REPAIR',
      sourceCaseId: item.sourceId, sourceNumber: original?.number,
      ...(original ? { sourceSnapshot: json(original), customerServiceUserId: 'fixture-doa-csr' } : {}),
      receivedById: clerkId, requestId: `seed-${item.id}`, requestHash: 'isolated-doa-fixture',
      senderLabel: '本機合成顧客', trackingNumber: `TRACK-${item.id}`,
    } });
    // Empty update is essential: restarting cannot overwrite existing work or versions.
    await db.mailroomItem.upsert({ where: { id: item.id }, update: {}, create: {
      id: item.id, receiptId, entityId: item.company, label: `DOA-DEMO-${item.id.replace('fixture-doa-', '').toUpperCase()}`,
      productName: '行動電源（本機合成樣本）', sku: 'DOA-DEMO-PB', serialNumber: original?.items[0].serialNumber || `SN-${item.id}`,
      ...(original ? { declared: json(original.items[0]) } : {}), status: item.status, matchResult: 'MATCH',
      location: item.owner ? '維修工作站 DEMO-01' : '收發室待交接 DEMO-01',
      custodianId: item.owner || clerkId, repairOwnerId: item.owner, nextUserId: item.next,
      ...(item.id === 'fixture-doa-waiting' ? { repairInspection: json(submittedInspection), conditionNote: '付費方案已送客服，待本人回覆（本機示範）' } : {}),
    } });
    if (item.next) await db.mailroomTask.upsert({ where: { itemId_userId_kind_version: { itemId: item.id, userId: item.next, kind: item.status, version: 1 } }, update: {},
      create: { entityId: item.company, itemId: item.id, userId: item.next, kind: item.status, version: 1 } });
    if (item.id === 'fixture-doa-waiting')
      await db.mailroomTask.upsert({ where: { itemId_userId_kind_version: { itemId: item.id, userId: 'fixture-doa-csr', kind: 'WAITING_CUSTOMER', version: 1 } }, update: {},
        create: { entityId: item.company, itemId: item.id, userId: 'fixture-doa-csr', kind: 'WAITING_CUSTOMER', version: 1 } });
  }
}

export async function startRepairFixture() {
  requireRepairLocalFixture();
  process.env.MAILROOM_ENABLED = 'true';
  process.env.MAILROOM_SYNC_ENABLED = 'false';
  const db = new PrismaService();
  const sync = repairFixtureSync(db);
  const mailroom = new MailroomService(db, { sendToUser: () => {} } as unknown as NotificationGateway, sync);
  const repair = new RepairWorkbenchService(db, mailroom, sync);
  const fixtureAuth = new AuthService({} as any, new JwtService({ secret: 'local-doa-fixture-only-signing-key' }), new ConfigService(), {} as any, db);
  const tablet = new MailroomTabletService(db, mailroom, fixtureAuth);
  @Controller()
  class FixtureController {
    @Get('users/me') async me(@Req() req: any) {
      const actor = await mailroom.actor(req.user.id);
      const user = await db.user.findUniqueOrThrow({ where: { id: actor.id }, include: { roles: { include: { role: true } } } });
      return { id: user.id, name: user.name, email: user.email, roles: user.roles,
        effectivePermissions: [...actor.permissions], isActive: true, mustChangePassword: false };
    }
    @Get('notifications') notifications(@Req() req: any) { return db.notification.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: 'desc' } }); }
    @Patch('notifications/read-all') async readAll(@Req() req: any) { await db.notification.updateMany({ where: { userId: req.user.id }, data: { read: true } }); return { ok: true }; }
    @Patch('notifications/:id/read') async read(@Req() req: any, @Param('id') id: string) { await db.notification.updateMany({ where: { id, userId: req.user.id }, data: { read: true } }); return { ok: true }; }
    @Get('ai/models') models() { return []; }
  }
  @Module({
    controllers: [MailroomController, MailroomTabletController, RepairWorkbenchController, FixtureController],
    providers: [{ provide: MailroomService, useValue: mailroom }, { provide: MailroomTabletService, useValue: tablet }, { provide: RepairWorkbenchService, useValue: repair }],
  })
  class FixtureModule {}
  await db.$connect();
  await seedRepairFixture(db);
  const app = await NestFactory.create<NestExpressApplication>(FixtureModule, { logger: ['error', 'warn'] });
  app.setGlobalPrefix('api/v1');
  app.useBodyParser('json', { limit: '6mb' });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalGuards({ canActivate(context) {
    const req = context.switchToHttp().getRequest();
    const auth = String(req.headers.authorization || '');
    const id = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!USERS.some((user) => user === id)) throw new UnauthorizedException();
    req.user = { id }; return true;
  } });
  await app.listen(57654, '127.0.0.1');
  console.log('Isolated DOA fixture API: http://127.0.0.1:57654/api/v1 (synthetic records only; no external delivery).');
  const close = async () => { await app.close(); await db.$disconnect(); };
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.once(signal, () => { void close().then(() => process.exit(0)); });
  return { app, db, close };
}
if (require.main === module)
  void startRepairFixture().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
