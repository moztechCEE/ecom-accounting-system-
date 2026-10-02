import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { MailroomService } from '../src/modules/mailroom/mailroom.service';
import { MailroomSyncService } from '../src/modules/mailroom/mailroom-sync.service';
import { NotificationGateway } from '../src/modules/notification/notification.gateway';
import { seedMailroom, requireLocalFixture } from './mailroom-local-fixture';
import type { MailroomCommandDto } from '../src/modules/mailroom/mailroom.dto';
requireLocalFixture();
async function main() {
  const db = new PrismaService();
  await db.$connect();
  await seedMailroom(db);
  const sync = new MailroomSyncService(db);
  const service = new MailroomService(
    db,
    { sendToUser: () => {} } as unknown as NotificationGateway,
    sync,
  );
  const entityId = 'fixture-company',
    mail = 'fixture-mail',
    repair = 'fixture-repair';
  const create = (
    category: 'REPAIR' | 'RETURN' | 'LETTER' | 'UNMATCHED',
    sourceCaseId?: string,
  ) => ({
    entityId,
    requestId: randomUUID(),
    category,
    sourceCaseId,
    ...(category === 'LETTER' ? { recipientId: 'fixture-person' } : {}),
    location: '收發室 A-01',
    items: [
      {
        productName: '示範無線充電座',
        sku: 'DEMO-001',
        ...(sourceCaseId ? { sourceItemId: sourceCaseId + '-item' } : {}),
      },
    ],
  });
  async function act(
    user: string,
    id: string,
    action: MailroomCommandDto['action'],
    values: Partial<MailroomCommandDto> = {},
  ) {
    const row = await db.mailroomItem.findUniqueOrThrow({ where: { id } });
    return service.command(user, id, {
      entityId,
      requestId: randomUUID(),
      expectedVersion: row.version,
      action,
      ...values,
    });
  }
  const input = create('REPAIR', 'fixture-repair');
  const [first, again] = await Promise.all([
    service.create(mail, input),
    service.create(mail, input),
  ]);
  assert.equal(first.id, again.id);
  assert.equal(
    await db.mailroomReceipt.count({ where: { requestId: input.requestId } }),
    1,
  );
  console.log('PASS concurrent receipt idempotency');
  const id = first.itemIds[0];
  await assert.rejects(
    service.create(mail, { ...input, location: '不同位置' }),
  );
  await assert.rejects(
    service.create(mail, {
      ...create('REPAIR', 'fixture-repair'),
      recipientId: 'fixture-person',
    }),
  );
  await assert.rejects(service.detail('fixture-outsider', entityId, id));
  await assert.rejects(service.detail('fixture-person', entityId, id));
  console.log('PASS company/recipient authorization and request conflict');
  await act(mail, id, 'inspect', {
    productName: '另一型號充電座',
    sku: 'DIFFERENT',
    matchResult: 'MISMATCH',
    note: '外盒與申報不符',
    evidence: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='],
  });
  await assert.rejects(
    act(mail, id, 'resolve_mismatch', { note: '自行同意', nextUserId: repair }),
  );
  assert.equal((await service.tasks('fixture-review', entityId)).length, 1);
  await act('fixture-review', id, 'resolve_mismatch', {
    note: '示範：客服已向顧客確認修實收品項',
    nextUserId: repair,
  });
  await assert.rejects(
    act(mail, id, 'accept', { confirmedItems: true, location: '維修桌' }),
  );
  await act(repair, id, 'accept', {
    confirmedItems: true,
    location: '維修桌 R-01',
  });
  await act(repair, id, 'start_inspection');
  const row = await db.mailroomItem.findUniqueOrThrow({ where: { id } });
  const commands = await Promise.allSettled([
    service.command(repair, id, {
      entityId,
      requestId: randomUUID(),
      expectedVersion: row.version,
      action: 'start_repair',
    }),
    service.command(repair, id, {
      entityId,
      requestId: randomUUID(),
      expectedVersion: row.version,
      action: 'await_customer',
      note: '同時送出的另一操作',
    }),
  ]);
  assert.equal(commands.filter((x) => x.status === 'fulfilled').length, 1);
  console.log(
    'PASS customer mismatch review, personal signature and concurrent transition',
  );
  const state = await db.mailroomItem.findUniqueOrThrow({ where: { id } });
  if (state.status === 'WAITING_CUSTOMER') {
    await act('fixture-review', id, 'resolve_customer', {
      note: '示範客服已確認',
    });
    await act(repair, id, 'start_repair');
  }
  await act(repair, id, 'complete_repair', { note: '檢測通過，維修完成' });
  assert.equal(
    (await db.mailroomItem.findUniqueOrThrow({ where: { id } })).custodianId,
    repair,
  );
  await act(mail, id, 'accept_return', {
    confirmedItems: true,
    location: '寄回架 C-01',
  });
  assert.equal(
    (await db.mailroomItem.findUniqueOrThrow({ where: { id } })).status,
    'READY_FOR_DISPATCH',
  );
  const blocked = await service.create(
    mail,
    create('REPAIR', 'fixture-blocked'),
  );
  const blockedId = blocked.itemIds[0];
  await act(mail, blockedId, 'inspect', {
    productName: '示範無線充電座',
    sku: 'DEMO-001',
    matchResult: 'MATCH',
    nextUserId: repair,
  });
  await act(repair, blockedId, 'accept', {
    confirmedItems: true,
    location: '維修桌',
  });
  await act(repair, blockedId, 'start_inspection');
  await assert.rejects(act(repair, blockedId, 'start_repair'));
  console.log(
    'PASS source approval blocks work; custody changes only at return signature',
  );
  for (const grade of ['AA', 'A', 'B', 'C'] as const) {
    const result = await service.create(
      mail,
      create('RETURN', 'fixture-return'),
    );
    const returned = result.itemIds[0];
    await act(mail, returned, 'grade', {
      grade,
      matchResult: 'MATCH',
      returnInspection: {packaging:'INTACT',product:'NEW_UNUSED',accessories:'COMPLETE'},
      evidence: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='],
      disposition: 'WELFARE_SALE',
      nextUserId: repair,
      note: '包裝、外觀與配件已檢查',
    });
    if (['B', 'C'].includes(grade)) {
      await act(repair, returned, 'accept', {
        confirmedItems: true,
        location: '整新桌',
      });
      await act(repair, returned, 'complete_refurbish', { note: '整理完成' });
      await act(mail, returned, 'accept_return', {
        confirmedItems: true,
        location: '福利品待入庫架',
      });
    }
  }
  const unknown = await service.create(mail, create('UNMATCHED'));
  await act(mail, unknown.itemIds[0], 'move', { location: '待辨識架 U-01', note: '等待客服查明' });
  await act(mail, unknown.itemIds[0], 'identify', { targetCategory: 'REPAIR', sourceCaseId: 'fixture-repair', sourceItemId: 'fixture-repair-item', note: '客服已確認來源案件' });
  assert.equal((await service.detail(mail, entityId, unknown.itemIds[0])).receipt.sourceCaseId, 'fixture-repair');
  await assert.rejects(act(mail, unknown.itemIds[0], 'identify', { targetCategory: 'LETTER', nextUserId: 'fixture-person', note: '不得改掛另一案件' }));
  const unknownLetter = await service.create(mail, create('UNMATCHED'));
  await act(mail, unknownLetter.itemIds[0], 'identify', { targetCategory: 'LETTER', nextUserId: 'fixture-person', note: '已確認收件同仁' });
  const evidenceDetail = await service.detail(mail, entityId, id);
  assert.equal((evidenceDetail.evidence as string[]).length, 1);
  assert.equal(evidenceDetail.history.filter(x => (x.snapshot as {evidence?:string[]}).evidence?.length).length, 1);
  console.log('PASS unidentified source resolution and preserved original photo evidence');
  const letter = await service.create(mail, create('LETTER'));
  const letterId = letter.itemIds[0];
  assert.ok(
    (await service.tasks('fixture-person', entityId)).some(
      (x) => (x.item as { id: string }).id === letterId,
    ),
  );
  await act('fixture-person', letterId, 'accept', {
    confirmedItems: true,
    location: '營運同仁已領回',
  });
  assert.ok(
    !(await service.tasks('fixture-person', entityId)).some(
      (x) => (x.item as { id: string }).id === letterId,
    ),
  );
  console.log('PASS grades, refurbishment and employee mail collection');
  const event = await db.mailroomAction.findFirstOrThrow({
    where: { itemId: id },
  });
  await assert.rejects(
    db.mailroomAction.update({
      where: { id: event.id },
      data: { note: '篡改' },
    }),
  );
  console.log('PASS append-only audit enforced by PostgreSQL');
  process.env.MAILROOM_SYNC_ENABLED = 'true';
  for (let i = 0; i < 8; i++) {
    await sync.deliverPending();
    if (
      !(await db.mailroomDelivery.count({
        where: { status: { not: 'DELIVERED' } },
      }))
    )
      break;
  }
  const remaining = await db.mailroomDelivery.findMany({
    where: { status: { not: 'DELIVERED' } },
    select: { target: true, lastError: true, attempts: true },
  });
  assert.equal(remaining.length, 0, JSON.stringify(remaining));
  console.log(
    'PASS signed source API, persisted outbox and source projection acknowledgements',
  );
  const all = await db.mailroomDelivery.findMany({ select: { payload: true } });
  assert.ok(
    all.every(
      (x) =>
        (x.payload as { inventoryPosted: boolean; refundExecuted: boolean })
          .inventoryPosted === false &&
        (x.payload as { refundExecuted: boolean }).refundExecuted === false,
    ),
  );
  assert.ok(all.every(x => !JSON.stringify(x.payload).includes('data:image')));
  const repairRole = await db.role.findUniqueOrThrow({ where: { code: 'REPAIR_TECHNICIAN' } });
  await db.userRole.delete({ where: { userId_roleId: { userId: repair, roleId: repairRole.id } } });
  try { await assert.rejects(service.list(repair, { entityId, view: 'repair' })); assert.equal((await service.list(repair, { entityId, view: 'mine' })).total, 0); assert.equal((await service.tasks(repair, entityId)).length, 0); }
  finally { await db.userRole.create({ data: { userId: repair, roleId: repairRole.id } }); }
  console.log('PASS revoked repair permissions cannot read old assignments');
  await db.$disconnect();
  console.log(
    'All local integration scenarios passed; no external services used.',
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
