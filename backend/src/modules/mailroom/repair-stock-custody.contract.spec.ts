/* Malformed proof and Prisma mocks are deliberate runtime-boundary inputs. */
/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call */
import { consumedReturnCustody } from './repair-stock-custody.contract';
import {
  physicalCustody,
  requireTechnicianCustody,
} from './repair-workflow.contract';
import { MailroomService } from './mailroom.service';
import { transition, type Actor, type Command } from './mailroom.contract';

function fixture() {
  const inbound = {
    unitId: 'unit',
    inTransactionId: 'formal-in',
    sourceItemId: 'donor',
    sourceCaseId: 'source-return',
    sourceCaseItemId: 'source-line',
    quantity: 1,
  };
  const donor = {
    id: 'donor',
    entityId: 'company',
    sku: 'SKU',
    serialNumber: 'RETURN-SN',
    status: 'STOCKED',
    custodianId: 'inventory-owner',
    repairOwnerId: 'tech',
    location: 'original warehouse bin',
    version: 9,
    evidence: [],
    declared: { id: 'source-line' },
    repairWorkflow: { schema: 1, inventoryReceipt: inbound },
    receipt: {
      category: 'RETURN',
      entityId: 'company',
      sourceCaseId: 'source-return',
    },
  };
  const target = {
    id: 'repair',
    entityId: 'company',
    sku: 'SKU',
    status: 'WAITING_RETURN_ACCEPTANCE',
    version: 8,
    custodianId: 'tech',
    repairOwnerId: 'tech',
    location: 'technician bench',
    receipt: {
      entityId: 'company',
      category: 'REPAIR',
      sourceCaseId: 'source-repair',
      sourceNumber: 'REPAIR-001',
    },
  };
  const unit = {
    id: 'unit',
    entityId: 'company',
    productId: 'product',
    warehouseId: 'warehouse',
    sourceItemId: 'donor',
    status: 'CONSUMED',
    kind: 'REFURBISHED',
    serialNumber: 'RETURN-SN',
    qualification: { sku: 'SKU', inbound },
    reservations: [
      {
        id: 'reservation',
        entityId: 'company',
        unitId: 'unit',
        itemId: 'repair',
        status: 'POSTED',
        outTransactionId: 'formal-out',
        outTransaction: {
          id: 'formal-out',
          entityId: 'company',
          productId: 'product',
          warehouseId: 'warehouse',
          direction: 'OUT',
          quantity: '1',
          referenceType: 'AFTER_SALES_REPLACEMENT',
          referenceId: 'reservation',
        },
        item: target,
      },
    ],
  };
  return { donor, unit, target };
}
const actor: Actor = {
  id: 'tech',
  name: 'Tech',
  entityIds: ['company'],
  permissions: new Set(['repair_workbench:read', 'repair_workbench:update']),
};

describe('consumed native RETURN current-custody projection', () => {
  it('proves the OUT and follows current technician then clerk custody without changing the historical IN', () => {
    const { donor, unit, target } = fixture(),
      original = structuredClone(donor);
    const first = consumedReturnCustody(donor, [unit])!;
    expect(first.physicalCustody).toBe('LINKED_CASE');
    expect(first.linkedReplacementCustody).toMatchObject({
      itemId: 'repair',
      outTransactionId: 'formal-out',
      physicalCustody: 'TECHNICIAN',
      custodianId: 'tech',
      location: 'technician bench',
      targetVersion: 8,
    });
    Object.assign(target, {
      status: 'READY_FOR_DISPATCH',
      custodianId: 'clerk',
      location: 'clerk dispatch area',
      version: 9,
    });
    const second = consumedReturnCustody(donor, [unit])!;
    expect(second.linkedReplacementCustody).toMatchObject({
      physicalCustody: 'MAILROOM',
      custodianId: 'clerk',
      location: 'clerk dispatch area',
      targetVersion: 9,
    });
    expect(donor).toEqual(original);
  });
  it('tracks actual claim, signoff, completion and clerk return receipt rather than assuming technician custody from status', () => {
    const tech = {
      ...actor,
      permissions: new Set([
        'repair_workbench:read',
        'repair_workbench:update',
      ]),
    };
    const clerk = {
      ...actor,
      id: 'clerk',
      permissions: new Set(['mailroom:read', 'mailroom:update']),
    };
    let item: any = {
      id: 'repair',
      entityId: 'company',
      version: 1,
      status: 'WAITING_REPAIR_ACCEPTANCE',
      repairOwnerId: null,
      nextUserId: null,
      custodianId: 'clerk',
      location: 'clerk intake',
      receipt: {
        category: 'REPAIR',
        receivedById: 'clerk',
        sourceCaseId: 'source-repair',
      },
    };
    const apply = (command: Command, acting: Actor) => {
      const { changes } = transition(
        item,
        { entityId: 'company', expectedVersion: item.version, ...command },
        acting,
        true,
      );
      item = { ...item, ...changes, version: item.version + 1 };
    };
    expect(physicalCustody(item)).toBe('MAILROOM');
    apply({ action: 'claim' }, tech);
    expect(item.custodianId).toBe('clerk');
    expect(physicalCustody(item)).toBe('MAILROOM');
    apply(
      { action: 'accept', confirmedItems: true, location: 'tech bench' },
      tech,
    );
    expect(physicalCustody(item)).toBe('TECHNICIAN');
    item.status = 'REPAIRING';
    apply({ action: 'complete_repair', note: 'actual test completion' }, tech);
    expect(item.status).toBe('WAITING_RETURN_ACCEPTANCE');
    expect(physicalCustody(item)).toBe('TECHNICIAN');
    apply(
      {
        action: 'accept_return',
        confirmedItems: true,
        location: 'clerk dispatch',
      },
      clerk,
    );
    expect(item.status).toBe('READY_FOR_DISPATCH');
    expect(physicalCustody(item)).toBe('MAILROOM');
  });
  it('fails closed for absent holder and preserves external factory custody ahead of internal historical holder fields', () => {
    const { target } = fixture();
    expect(physicalCustody({ ...target, custodianId: '' })).toBe('UNKNOWN');
    expect(
      physicalCustody({
        ...target,
        status: 'FACTORY_RECEIVED',
        custodianId: 'tech',
      }),
    ).toBe('FACTORY');
    expect(
      physicalCustody({
        ...target,
        status: 'FACTORY_RETURNING',
        custodianId: 'tech',
      }),
    ).toBe('FACTORY_CARRIER');
    expect(
      physicalCustody({
        ...target,
        repairWorkflow: { schema: 1, factory: { physicalCustody: 'FACTORY' } },
      }),
    ).toBe('FACTORY');
    expect(
      physicalCustody({
        ...target,
        status: 'READY_FOR_DISPATCH',
        custodianId: 'clerk',
        repairWorkflow: {
          schema: 1,
          factory: { physicalCustody: 'TECHNICIAN' },
        },
      }),
    ).toBe('MAILROOM');
  });
  it('keeps an unconsumed real IN in INVENTORY; does not infer OUT from a reservation alone', () => {
    const { donor, unit } = fixture();
    expect(consumedReturnCustody(donor, [])).toBeUndefined();
    expect(
      consumedReturnCustody(donor, [{ ...unit, status: 'RESERVED' }]),
    ).toBeUndefined();
    expect(physicalCustody(donor)).toBe('INVENTORY');
  });
  it.each([
    [
      'foreign unit',
      (v: any) => {
        v.unit.entityId = 'foreign';
      },
    ],
    [
      'foreign target',
      (v: any) => {
        v.target.entityId = 'foreign';
      },
    ],
    [
      'foreign receipt',
      (v: any) => {
        v.target.receipt.entityId = 'foreign';
      },
    ],
    [
      'foreign movement',
      (v: any) => {
        v.unit.reservations[0].outTransaction.entityId = 'foreign';
      },
    ],
    [
      'unposted reservation',
      (v: any) => {
        v.unit.reservations[0].status = 'RESERVED';
      },
    ],
    [
      'missing movement',
      (v: any) => {
        v.unit.reservations[0].outTransaction = null;
      },
    ],
    [
      'wrong direction',
      (v: any) => {
        v.unit.reservations[0].outTransaction.direction = 'IN';
      },
    ],
    [
      'wrong quantity',
      (v: any) => {
        v.unit.reservations[0].outTransaction.quantity = '2';
      },
    ],
    [
      'wrong unit reference',
      (v: any) => {
        v.unit.reservations[0].unitId = 'other-unit';
      },
    ],
    [
      'wrong item reference',
      (v: any) => {
        v.unit.reservations[0].itemId = 'other-item';
      },
    ],
    [
      'wrong formal OUT id',
      (v: any) => {
        v.unit.reservations[0].outTransactionId = 'other-out';
      },
    ],
    [
      'wrong OUT reference',
      (v: any) => {
        v.unit.reservations[0].outTransaction.referenceId = 'other-reservation';
      },
    ],
    [
      'wrong SKU',
      (v: any) => {
        v.target.sku = 'OTHER-SKU';
      },
    ],
    [
      'wrong SN',
      (v: any) => {
        v.unit.serialNumber = 'OTHER-SN';
      },
    ],
    [
      'wrong source piece',
      (v: any) => {
        v.donor.declared.id = 'other-source-line';
      },
    ],
    [
      'wrong IN proof',
      (v: any) => {
        v.donor.repairWorkflow.inventoryReceipt = {
          ...v.donor.repairWorkflow.inventoryReceipt,
          inTransactionId: 'other-in',
        };
      },
    ],
    [
      'multiple POSTED rows',
      (v: any) => {
        v.unit.reservations.push(structuredClone(v.unit.reservations[0]));
      },
    ],
  ])('fails closed without leaking target details for %s', (_name, mutate) => {
    const value = fixture();
    mutate(value);
    expect(consumedReturnCustody(value.donor, [value.unit])).toEqual({
      physicalCustody: 'UNKNOWN',
      statusLabel: '退貨品出庫關聯待核對',
    });
  });
  it('links an individual nonserial unit through the source identity and formal movement without inventing an SN', () => {
    const value: any = fixture();
    value.donor.serialNumber = null;
    value.unit.serialNumber = null;
    const projection = consumedReturnCustody(value.donor, [value.unit]);
    expect(projection?.physicalCustody).toBe('LINKED_CASE');
    expect(projection?.linkedReplacementCustody?.unitId).toBe('unit');
    expect(projection?.linkedReplacementCustody).not.toHaveProperty(
      'serialNumber',
    );
  });
  it('returns only a logistics whitelist even when related rows contain documents and financial/customer data', () => {
    const { donor, unit, target } = fixture();
    Object.assign(target, {
      repairInspection: { secret: 'TECHNICAL_SECRET' },
      customerLabel: 'CUSTOMER_SECRET',
      financialNote: 'FINANCIAL_SECRET',
    });
    const output = JSON.stringify(consumedReturnCustody(donor, [unit]));
    expect(output).not.toMatch(
      /SECRET|repairInspection|customerLabel|financialNote|qualification/,
    );
  });
  it('preserves LINKED_CASE/UNKNOWN across the document read helper and never enables editing of an archived donor', () => {
    const { donor } = fixture();
    for (const value of ['LINKED_CASE', 'UNKNOWN'] as const) {
      const projected = { ...donor, physicalCustody: value };
      expect(physicalCustody(projected)).toBe(value);
      expect(() => requireTechnicianCustody(actor, projected)).toThrow();
    }
  });
  it('batch decorates list/detail rows with the linked current staff name and keeps all raw historical stock fields', async () => {
    const { donor, unit } = fixture();
    const prisma = {
      afterSalesStockUnit: { findMany: jest.fn().mockResolvedValue([unit]) },
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'inventory-owner', name: 'Historical stock owner' },
          { id: 'tech', name: 'Current technician' },
        ]),
      },
    };
    const service = new MailroomService(prisma as any, {} as any, {} as any);
    const view = (await service.views([donor as any], 'tech', actor))[0];
    expect(view).toMatchObject({
      status: 'STOCKED',
      custodianId: 'inventory-owner',
      custodianName: 'Historical stock owner',
      location: 'original warehouse bin',
      physicalCustody: 'LINKED_CASE',
      linkedReplacementCustody: {
        custodianId: 'tech',
        custodianName: 'Current technician',
        location: 'technician bench',
      },
    });
    expect(prisma.afterSalesStockUnit.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          sourceItemId: { in: ['donor'] },
          status: 'CONSUMED',
        },
      }),
    );
    expect(donor.custodianId).toBe('inventory-owner');
  });
  it('reuses existing entity and audience guards before loading any consumed link', async () => {
    const { donor } = fixture();
    const prisma = {
      afterSalesStockUnit: { findMany: jest.fn() },
      user: { findMany: jest.fn() },
    };
    const service = new MailroomService(prisma as any, {} as any, {} as any);
    for (const denied of [
      { ...actor, entityIds: ['foreign'] },
      { ...actor, permissions: new Set<string>() },
    ]) {
      await expect(
        service.views([donor as any], 'tech', denied),
      ).rejects.toThrow();
    }
    expect(prisma.afterSalesStockUnit.findMany).not.toHaveBeenCalled();
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });
  it('ordinary logistics viewers receive only the safe linked logistics projection and no full documents', async () => {
    const { donor, unit } = fixture();
    Object.assign(donor, {
      repairInspection: { secret: 'TECHNICAL_SECRET' },
      repairReport: { secret: 'TECHNICAL_SECRET' },
    });
    const prisma = {
      afterSalesStockUnit: { findMany: jest.fn().mockResolvedValue([unit]) },
      user: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new MailroomService(prisma as any, {} as any, {} as any);
    const row = (
      await service.views([donor as any], 'clerk', {
        ...actor,
        id: 'clerk',
        permissions: new Set(['mailroom:read']),
      })
    )[0];
    expect(row.physicalCustody).toBe('LINKED_CASE');
    expect(row.linkedReplacementCustody?.custodianId).toBe('tech');
    expect(row).not.toHaveProperty('repairInspection');
    expect(row).not.toHaveProperty('repairReport');
    expect(row).not.toHaveProperty('repairWorkflow');
  });
  it('does not query foreign linked staff names or return foreign case fields for malformed consumption', async () => {
    const { donor, unit, target } = fixture();
    target.entityId = 'foreign';
    target.custodianId = 'foreign-staff';
    const prisma = {
      afterSalesStockUnit: { findMany: jest.fn().mockResolvedValue([unit]) },
      user: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new MailroomService(prisma as any, {} as any, {} as any);
    const row = (await service.views([donor as any], 'tech', actor))[0];
    expect(row.physicalCustody).toBe('UNKNOWN');
    expect(row).not.toHaveProperty('linkedReplacementCustody');
    expect(prisma.user.findMany.mock.calls[0][0].where.id.in).not.toContain(
      'foreign-staff',
    );
  });
});
