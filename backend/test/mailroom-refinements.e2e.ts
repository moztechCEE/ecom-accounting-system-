/** Real localhost PostgreSQL + employee-password HTTP verification. Never uses production. */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { MailroomService } from '../src/modules/mailroom/mailroom.service';
import { MailroomSyncService } from '../src/modules/mailroom/mailroom-sync.service';
import { NotificationGateway } from '../src/modules/notification/notification.gateway';
import type { MailroomCommandDto } from '../src/modules/mailroom/mailroom.dto';
import { fixturePassword, requireLocalFixture } from './mailroom-local-fixture';
import { PrismaClient as SourcePrismaClient } from '../../../corely-after-sales-mailroom-20261001/generated/prisma';

requireLocalFixture();
const connections = JSON.parse(process.env.MAILROOM_CONNECTIONS || '[]');
assert.ok(connections.length > 0);
assert.ok(
  connections.every(
    (entry: { baseUrl: string; entityId: string }) =>
      new URL(entry.baseUrl).origin === 'http://127.0.0.1:57645' &&
      entry.entityId === 'fixture-company',
  ),
  'Refinements require only the isolated localhost source connection',
);
process.env.MAILROOM_SYNC_ENABLED = 'false';

const entityId = 'fixture-company';
const mail = 'fixture-mail';
const repair = 'fixture-repair';
const reviewer = 'fixture-review';
const photo =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';

async function main() {
  const db = new PrismaService();
  await db.$connect();
  try {
    const sync = new MailroomSyncService(db);
    const service = new MailroomService(
      db,
      { sendToUser: () => {} } as unknown as NotificationGateway,
      sync,
    );
    const financialSnapshot = async () =>
      JSON.stringify(
        await Promise.all([
          db.inventorySnapshot.findMany({ orderBy: { id: 'asc' } }),
          db.inventoryTransaction.findMany({ orderBy: { id: 'asc' } }),
          db.payment.findMany({ orderBy: { id: 'asc' } }),
          db.paymentTask.findMany({ orderBy: { id: 'asc' } }),
        ]),
      );
    const beforeFinancials = await financialSnapshot();
    const credential = await db.user.findUniqueOrThrow({
      where: { id: repair },
      select: { passwordHash: true },
    });
    assert.match(credential.passwordHash || '', /^\$2[aby]\$/);

    const create = async (category: 'REPAIR' | 'RETURN') => {
      const sourceCaseId =
        category === 'REPAIR' ? 'fixture-repair' : 'fixture-return';
      return service.create(mail, {
        entityId,
        requestId: randomUUID(),
        category,
        sourceCaseId,
        location: '本機流程驗證 · 收發台',
        items: [
          {
            productName: '示範無線充電座',
            sku: 'DEMO-001',
            sourceItemId: sourceCaseId + '-item',
          },
        ],
      });
    };
    const act = async (
      userId: string,
      id: string,
      action: MailroomCommandDto['action'],
      values: Partial<MailroomCommandDto> = {},
    ) => {
      const item = await db.mailroomItem.findUniqueOrThrow({ where: { id } });
      return service.command(userId, id, {
        entityId,
        requestId: randomUUID(),
        expectedVersion: item.version,
        action,
        ...values,
      });
    };
    const notifications = (id: string) =>
      db.notification.findMany({
        where: { category: 'mailroom', data: { path: ['itemId'], equals: id } },
        orderBy: { id: 'asc' },
      });
    const postTablet = async (id: string, body: unknown, caller = mail) => {
      const response = await fetch(
        'http://127.0.0.1:57644/api/v1/mailroom/tablet/items/' +
          encodeURIComponent(id) +
          '/accept',
        {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(8000),
          headers: {
            'content-type': 'application/json',
            authorization: 'Bearer ' + caller,
          },
          body: JSON.stringify(body),
        },
      );
      return { status: response.status, body: await response.json() };
    };

    const repaired = await create('REPAIR');
    const repairItemId = repaired.itemIds[0];
    await act(mail, repairItemId, 'inspect', {
      productName: '示範無線充電座',
      sku: 'DEMO-001',
      matchResult: 'MATCH',
      nextUserId: repair,
    });
    const repairItem = await db.mailroomItem.findUniqueOrThrow({
      where: { id: repairItemId },
    });
    const tabletBody = {
      entityId,
      requestId: randomUUID(),
      expectedVersion: repairItem.version,
      employeeNo: repair,
      password: fixturePassword,
      confirmedItems: true,
      location: '本機流程驗證 · 維修簽收區',
    };
    const repairNotifications = await notifications(repairItemId);
    assert.equal(
      (
        await postTablet(repairItemId, {
          ...tabletBody,
          password: 'WrongFixturePassword!',
        })
      ).status,
      401,
    );
    assert.equal(
      (await postTablet(repairItemId, tabletBody, repair)).status,
      403,
    );
    assert.equal(
      (await db.mailroomItem.findUniqueOrThrow({ where: { id: repairItemId } }))
        .version,
      repairItem.version,
    );
    const signed = await postTablet(repairItemId, tabletBody);
    assert.equal(signed.status, 200, JSON.stringify(signed.body));
    assert.deepEqual(signed.body, { id: repairItemId, duplicate: false });
    assert.ok(!JSON.stringify(signed.body).includes('access_token'));
    const afterSignature = await db.mailroomItem.findUniqueOrThrow({
      where: { id: repairItemId },
    });
    assert.equal(afterSignature.status, 'REPAIR_RECEIVED');
    assert.equal(afterSignature.custodianId, repair);
    const replay = await postTablet(repairItemId, tabletBody);
    assert.equal(replay.status, 200, JSON.stringify(replay.body));
    assert.deepEqual(replay.body, { id: repairItemId, duplicate: true });
    assert.equal(
      (
        await postTablet(repairItemId, {
          ...tabletBody,
          location: '改動重送內容',
        })
      ).status,
      409,
    );
    const signature = await db.mailroomAction.findUniqueOrThrow({
      where: {
        entityId_actorId_requestId: {
          entityId,
          actorId: repair,
          requestId: tabletBody.requestId,
        },
      },
    });
    assert.equal(signature.actorId, repair);
    assert.deepEqual((signature.snapshot as any).tabletHandoff, {
      clerkId: mail,
      clerkName: '行政收發（示範）',
      signerId: repair,
    });
    assert.ok(!JSON.stringify(signature).includes(fixturePassword));
    assert.ok(!JSON.stringify(signature).includes('access_token'));
    assert.deepEqual(await notifications(repairItemId), repairNotifications);
    assert.equal(
      await db.mailroomAction.count({
        where: { itemId: repairItemId, action: 'accept' },
      }),
      1,
    );
    console.log(
      'PASS real bcrypt HTTP signature: wrong password/caller denied, signer/clerk audited, exact retry safe, changed body rejected, no JWT or self reminder',
    );

    // An additional active review-capable employee proves that no department-wide broadcast occurs.
    const unrelatedReviewer =
      'fixture-review-bystander-' + randomUUID().slice(0, 8);
    await db.user.create({
      data: {
        id: unrelatedReviewer,
        name: '未承辦客服（本機驗證）',
        email: unrelatedReviewer + '@example.invalid',
        passwordHash: 'LOCAL_FIXTURE_DISABLED',
        entityMemberships: { create: { entityId, isPrimary: true } },
        roles: { create: { role: { connect: { code: 'FIXTURE_REVIEWER' } } } },
        employee: {
          create: {
            entityId,
            departmentId: 'dept-fixture-review',
            employeeNo: unrelatedReviewer,
            name: '未承辦客服（本機驗證）',
            country: 'TW',
            hireDate: new Date('2026-01-01'),
            salaryBaseOriginal: 0,
            salaryBaseBase: 0,
          },
        },
      },
    });
    const returned = await create('RETURN');
    const returnId = returned.itemIds[0];
    const receipt = await db.mailroomReceipt.findUniqueOrThrow({
      where: { id: returned.id },
    });
    assert.equal(receipt.customerServiceUserId, reviewer);
    const grade = {
      grade: 'B' as const,
      matchResult: 'MATCH' as const,
      nextUserId: repair,
      note: '包裝、產品與配件檢查完成；外觀有明顯磨損',
      returnInspection: {
        packaging: 'MINOR_DAMAGE' as const,
        product: 'VISIBLE_WEAR' as const,
        accessories: 'COMPLETE' as const,
      },
    };
    const originalVersion = (
      await db.mailroomItem.findUniqueOrThrow({ where: { id: returnId } })
    ).version;
    await assert.rejects(act(mail, returnId, 'grade', grade), /拍照/);
    await assert.rejects(
      act(mail, returnId, 'grade', {
        ...grade,
        evidence: [photo],
        returnInspection: {
          packaging: 'MINOR_DAMAGE',
          accessories: 'COMPLETE',
        } as any,
      }),
      /檢查結果不完整/,
    );
    assert.equal(
      (await db.mailroomItem.findUniqueOrThrow({ where: { id: returnId } }))
        .version,
      originalVersion,
    );
    assert.equal(
      await db.mailroomTask.count({ where: { itemId: returnId } }),
      0,
    );
    await act(mail, returnId, 'grade', { ...grade, evidence: [photo] });
    const openTasks = await db.mailroomTask.findMany({
      where: { itemId: returnId, status: 'OPEN' },
    });
    assert.equal(openTasks.length, 2);
    assert.deepEqual(
      openTasks.map((task) => [task.userId, task.kind]).sort(),
      [
        [repair, 'PENDING_REFURBISH'],
        [reviewer, 'RETURN_REVIEW'],
      ].sort(),
    );
    const reviewTask = openTasks.find((task) => task.userId === reviewer)!;
    const gradeNotifications = await notifications(returnId);
    assert.equal(gradeNotifications.length, 2);
    assert.deepEqual(
      gradeNotifications.map((notification) => notification.userId).sort(),
      [repair, reviewer].sort(),
    );
    await act(mail, returnId, 'grade', {
      ...grade,
      note: '補充檢查說明，照片與分級保持原結果',
    });
    assert.deepEqual(await notifications(returnId), gradeNotifications);
    assert.equal(
      (
        await db.mailroomTask.findUniqueOrThrow({
          where: { id: reviewTask.id },
        })
      ).status,
      'OPEN',
    );
    console.log(
      'PASS RETURN photo/complete-check gate, specific case reviewer routing, repeated checks without duplicate reminders',
    );

    await act(repair, returnId, 'accept', {
      confirmedItems: true,
      location: '本機流程驗證 · 整新區',
    });
    const refurbishment = await db.mailroomItem.findUniqueOrThrow({
      where: { id: returnId },
    });
    assert.equal(refurbishment.status, 'REFURBISHING');
    assert.equal(
      (
        await db.mailroomTask.findUniqueOrThrow({
          where: { id: reviewTask.id },
        })
      ).status,
      'OPEN',
    );
    assert.deepEqual(await notifications(returnId), gradeNotifications);
    await assert.rejects(
      act(unrelatedReviewer, returnId, 'acknowledge_inspection', {
        note: '非承辦人不可代接',
      }),
      /承辦客服/,
    );
    await act(reviewer, returnId, 'acknowledge_inspection', { note: '接手' });
    const acknowledged = await db.mailroomItem.findUniqueOrThrow({
      where: { id: returnId },
    });
    assert.equal(acknowledged.status, 'REFURBISHING');
    assert.equal(acknowledged.custodianId, repair);
    assert.equal((acknowledged.returnInspection as any).reviewedBy, reviewer);
    assert.ok((acknowledged.returnInspection as any).reviewedAt);
    assert.equal(
      (
        await db.mailroomTask.findUniqueOrThrow({
          where: { id: reviewTask.id },
        })
      ).status,
      'COMPLETED',
    );
    const remaining = await db.mailroomTask.findMany({
      where: { itemId: returnId, status: 'OPEN' },
    });
    assert.deepEqual(
      remaining.map((task) => [task.userId, task.kind]),
      [[repair, 'REFURBISHING']],
    );
    assert.deepEqual(await notifications(returnId), gradeNotifications);
    assert.equal(
      await db.notification.count({ where: { userId: unrelatedReviewer } }),
      0,
    );
    assert.equal(
      await db.mailroomTask.count({ where: { userId: unrelatedReviewer } }),
      0,
    );
    const sourceDb = new SourcePrismaClient({
      datasources: {
        db: {
          url: 'postgresql://local:mailroom-local-fixture@127.0.0.1:57643/aftersales',
        },
      },
    });
    let reassignmentCaseId: string | undefined;
    try {
      const sourceRole = await sourceDb.role.findUniqueOrThrow({
        where: { code: 'customer_service' },
      });
      const sourceA = await sourceDb.user.findUniqueOrThrow({
        where: { email: 'fixture-review@example.invalid' },
      });
      const sourceB = await sourceDb.user.create({
        data: {
          id: 'fixture-source-' + randomUUID(),
          email: unrelatedReviewer + '@example.invalid',
          name: '新承辦客服（本機驗證）',
          passwordHash: 'LOCAL_FIXTURE_DISABLED',
          roleId: sourceRole.id,
        },
      });
      reassignmentCaseId = 'fixture-owner-shift-' + randomUUID();
      const sourceItemId = reassignmentCaseId + '-item';
      await sourceDb.case.create({
        data: {
          id: reassignmentCaseId,
          caseNumber: 'DEMO-OWNER-' + randomUUID().slice(0, 8),
          type: 'REFUND_PICKUP',
          status: 'REVERSE_IN_TRANSIT',
          sourceChannel: 'LOCAL_FIXTURE',
          contactName: '原始申報顧客（本機）',
          contactPhone: '0000000000',
          assigneeId: sourceA.id,
          items: {
            create: {
              id: sourceItemId,
              productNameSnapshot: '原始申報充電座',
              productSkuSnapshot: 'DEMO-001',
              quantity: 1,
            },
          },
        },
      });
      const received = await service.create(mail, {
        entityId,
        requestId: randomUUID(),
        category: 'RETURN',
        sourceCaseId: reassignmentCaseId,
        location: '本機流程驗證 · 承辦轉派區',
        items: [
          { sourceItemId, productName: '原始申報充電座', sku: 'DEMO-001' },
        ],
      });
      const ownedId = received.itemIds[0];
      const baselineReceipt = await db.mailroomReceipt.findUniqueOrThrow({
        where: { id: received.id },
      });
      const baselineDeclared = (
        await db.mailroomItem.findUniqueOrThrow({ where: { id: ownedId } })
      ).declared;
      const aaGrade = {
        grade: 'AA' as const,
        matchResult: 'MATCH' as const,
        note: '全新未使用、配件完整，檢查完成',
        returnInspection: {
          packaging: 'INTACT' as const,
          product: 'NEW_UNUSED' as const,
          accessories: 'COMPLETE' as const,
        },
        evidence: [photo],
      };
      await act(mail, ownedId, 'grade', aaGrade);
      const oldTask = await db.mailroomTask.findFirstOrThrow({
        where: {
          itemId: ownedId,
          userId: reviewer,
          kind: 'RETURN_REVIEW',
          status: 'OPEN',
        },
      });
      await sourceDb.case.update({
        where: { id: reassignmentCaseId },
        data: {
          assigneeId: sourceB.id,
          contactName: '售後稍後更正的顧客姓名',
          items: {
            update: {
              where: { id: sourceItemId },
              data: { productNameSnapshot: '售後稍後更正的產品描述' },
            },
          },
        },
      });
      await act(mail, ownedId, 'grade', aaGrade);
      assert.equal(
        (await db.mailroomTask.findUniqueOrThrow({ where: { id: oldTask.id } }))
          .status,
        'COMPLETED',
      );
      const newTask = await db.mailroomTask.findFirstOrThrow({
        where: {
          itemId: ownedId,
          userId: unrelatedReviewer,
          kind: 'RETURN_REVIEW',
          status: 'OPEN',
        },
      });
      const reassigned = await db.mailroomReceipt.findUniqueOrThrow({
        where: { id: received.id },
      });
      assert.equal(reassigned.customerServiceUserId, unrelatedReviewer);
      const baseline = baselineReceipt.sourceSnapshot as any;
      const currentSnapshot = reassigned.sourceSnapshot as any;
      assert.equal(currentSnapshot.assigneeId, sourceB.id);
      assert.equal(
        currentSnapshot.assigneeEmail,
        unrelatedReviewer + '@example.invalid',
      );
      for (const field of [
        'items',
        'version',
        'repairAllowed',
        'customerLabel',
        'number',
        'status',
      ])
        assert.deepEqual(
          currentSnapshot[field],
          baseline[field],
          'Only routing fields may refresh: ' + field,
        );
      assert.deepEqual(
        (await db.mailroomItem.findUniqueOrThrow({ where: { id: ownedId } }))
          .declared,
        baselineDeclared,
      );
      await assert.rejects(
        act(reviewer, ownedId, 'acknowledge_inspection', {
          note: '原承辦人不可代新承辦接手',
        }),
        /承辦客服/,
      );
      await act(unrelatedReviewer, ownedId, 'acknowledge_inspection', {
        note: '新承辦接手',
      });
      assert.equal(
        (await db.mailroomTask.findUniqueOrThrow({ where: { id: newTask.id } }))
          .status,
        'COMPLETED',
      );
      const beforeIdentical = await notifications(ownedId);
      const reviewBefore = (
        await db.mailroomItem.findUniqueOrThrow({ where: { id: ownedId } })
      ).returnInspection;
      await act(mail, ownedId, 'grade', aaGrade);
      assert.deepEqual(
        (await db.mailroomItem.findUniqueOrThrow({ where: { id: ownedId } }))
          .returnInspection,
        reviewBefore,
      );
      assert.deepEqual(await notifications(ownedId), beforeIdentical);
      assert.equal(
        await db.mailroomTask.count({
          where: { itemId: ownedId, kind: 'RETURN_REVIEW', status: 'OPEN' },
        }),
        0,
      );

      // A new owner needs a fresh handoff even when the inspection contents did not change.
      await sourceDb.case.update({
        where: { id: reassignmentCaseId },
        data: { assigneeId: sourceA.id },
      });
      await act(mail, ownedId, 'grade', aaGrade);
      const ownerShifted = await db.mailroomItem.findUniqueOrThrow({
        where: { id: ownedId },
      });
      assert.ok(!(ownerShifted.returnInspection as any).reviewedAt);
      assert.equal(ownerShifted.status, 'PENDING_RESTOCK');
      assert.ok(
        await db.mailroomTask.findFirst({
          where: {
            itemId: ownedId,
            userId: reviewer,
            kind: 'RETURN_REVIEW',
            status: 'OPEN',
          },
        }),
      );
      await act(reviewer, ownedId, 'acknowledge_inspection', {
        note: '轉回原承辦，重新接手',
      });
      const beforeNewPhoto = (await notifications(ownedId)).length;
      const newPhoto =
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWM4wMzwnwAFgwJ/lMqOHwAAAABJRU5ErkJggg==';
      await act(mail, ownedId, 'grade', { ...aaGrade, evidence: [newPhoto] });
      assert.ok(
        !(
          (await db.mailroomItem.findUniqueOrThrow({ where: { id: ownedId } }))
            .returnInspection as any
        )?.reviewedAt,
      );
      assert.equal((await notifications(ownedId)).length, beforeNewPhoto + 1);
      assert.equal(
        await db.mailroomTask.count({
          where: {
            itemId: ownedId,
            userId: reviewer,
            kind: 'RETURN_REVIEW',
            status: 'OPEN',
          },
        }),
        1,
      );
      console.log(
        'PASS live upstream assignee A→B: old task closed, new owner notified/authorized, original claim preserved; identical acknowledged grade stays quiet, owner/photo changes require new handoff',
      );
    } finally {
      // Restore only this test's editable source claim, so its persisted outbox can still be ACKed later.
      if (reassignmentCaseId)
        await sourceDb.case.update({
          where: { id: reassignmentCaseId },
          data: {
            contactName: '原始申報顧客（本機）',
            items: {
              update: {
                where: { id: reassignmentCaseId + '-item' },
                data: { productNameSnapshot: '原始申報充電座' },
              },
            },
          },
        });
      await sourceDb.$disconnect();
    }
    assert.equal(await financialSnapshot(), beforeFinancials);
    const outbox = await db.mailroomDelivery.findMany({
      where: { itemId: { in: [repairItemId, returnId] } },
    });
    assert.ok(outbox.length > 0);
    for (const delivery of outbox) {
      assert.equal((delivery.payload as any).inventoryPosted, false);
      assert.equal((delivery.payload as any).refundExecuted, false);
      assert.ok(!JSON.stringify(delivery.payload).includes('data:image'));
    }
    console.log(
      'PASS CSR task survives repair acceptance, assigned-only acknowledgement closes CSR task without changing physical custody/status, no inventory/payment writes',
    );
    console.log('All localhost refinement integration scenarios passed.');
  } finally {
    await db.$disconnect();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
