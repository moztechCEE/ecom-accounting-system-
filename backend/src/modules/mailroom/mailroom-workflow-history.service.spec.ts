import { MailroomService } from './mailroom.service';
import { type Actor } from './mailroom.contract';

describe('repair workflow immutable history and safe logistics events', () => {
  it('completes the sent CSR task and creates a separate accepted task without treating event delivery as physical receipt', async () => {
    const service = new MailroomService({} as any, {} as any, {} as any);
    jest
      .spyOn(service, 'actor')
      .mockResolvedValue({
        id: 'csr-new',
        name: '客服',
        permissions: new Set(['mailroom:review']),
        entityIds: ['company'],
      });
    const actor: Actor = {
      id: 'csr-new',
      name: '客服',
      permissions: new Set(['mailroom:review']),
      entityIds: ['company'],
    };
    const item: any = {
      id: 'piece',
      entityId: 'company',
      receiptId: 'receipt',
      version: 6,
      label: 'DEMO',
      productName: '示範產品',
      sku: 'DEMO-SKU',
      serialNumber: 'DEMO-SN',
      status: 'WAITING_CUSTOMER',
      location: '維修桌',
      custodianId: 'tech',
      nextUserId: 'csr-new',
      repairOwnerId: 'tech',
      evidence: [],
      repairInspection: { status: 'SUBMITTED', revision: 3 },
      repairReport: null,
      repairWorkflow: {
        schema: 1,
        csr: {
          status: 'ACCEPTED',
          ownerId: 'csr-new',
          inspectionRevision: 3,
          planHash: 'example',
        },
      },
      receipt: {
        receivedById: 'clerk',
        category: 'REPAIR',
        sourceCaseId: 'case',
        sourceNumber: 'DEMO-CASE',
        customerServiceUserId: 'csr-old',
        receivedAt: new Date('2026-10-05T00:00:00Z'),
      },
    };
    const tx: any = {
      mailroomAction: {
        create: jest
          .fn()
          .mockResolvedValue({
            id: 'event',
            createdAt: new Date('2026-10-05T00:01:00Z'),
          }),
      },
      mailroomTask: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: 'sent-task', userId: 'csr-old', kind: 'WAITING_CUSTOMER' },
          ]),
        updateMany: jest.fn(),
        create: jest.fn(),
      },
      notification: { create: jest.fn() },
      mailroomDelivery: { createMany: jest.fn() },
    };
    await service.record(
      tx,
      actor,
      item,
      'claim_customer',
      'workflow-ack-001',
      'hash',
      'WAITING_CUSTOMER',
      '本人接手',
      true,
    );
    expect(tx.mailroomTask.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['sent-task'] } },
      data: { status: 'COMPLETED', completedAt: expect.any(Date) },
    });
    expect(tx.mailroomTask.create).toHaveBeenCalledWith({
      data: {
        entityId: 'company',
        itemId: 'piece',
        userId: 'csr-new',
        kind: 'CUSTOMER_ACCEPTED',
        version: 6,
      },
    });
    expect(tx.notification.create).not.toHaveBeenCalled();
    expect(
      tx.mailroomAction.create.mock.calls[0][0].data.snapshot,
    ).toMatchObject({
      repairWorkflow: item.repairWorkflow,
      custodianId: 'tech',
      physicalCustody: 'TECHNICIAN',
    });
    const deliveries = tx.mailroomDelivery.createMany.mock.calls[0][0].data;
    expect(deliveries.map((x: any) => x.target)).toEqual([
      'AFTER_SALES',
      'AI_CUSTOMER_SERVICE',
    ]);
    for (const delivery of deliveries) {
      expect(delivery.payload).toMatchObject({
        inventoryPosted: false,
        refundExecuted: false,
        item: { physicalCustody: 'TECHNICIAN', releasePurpose: null },
      });
      expect(delivery.payload.item).not.toHaveProperty('repairWorkflow');
      expect(delivery.payload.item).not.toHaveProperty('repairInspection');
      expect(delivery.payload).not.toHaveProperty('deliveredAt');
    }
  });
});
