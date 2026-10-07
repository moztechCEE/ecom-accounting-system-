import { BadRequestException, ValidationPipe } from '@nestjs/common';
import type { Type, ValidationPipeOptions } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { ReceiveReturnStockDto } from '../integration/after-sales/after-sales-stock.dto';
import { MailroomTabletAcceptDto } from './mailroom-tablet.dto';
import { RepairWorkflowDto } from './repair-workflow.dto';
import {
  type InspectionDocument,
  inspectionPlanHash,
} from './repair-document.contract';
import { type Actor } from './mailroom.contract';
import { RepairWorkbenchService } from './repair-workbench.service';
import {
  type RepairWorkflow,
  sentCustomerWorkflow,
} from './repair-workflow.contract';

// Read the actual bootstrap options without importing main.ts or starting AppModule.
function mainValidationPipe(): ValidationPipe {
  const main = ts.createSourceFile(
    'main.ts',
    readFileSync(resolve(__dirname, '../../main.ts'), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  let options: ts.Expression | undefined;
  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'useGlobalPipes'
    ) {
      const pipe = node.arguments[0];
      if (
        pipe &&
        ts.isNewExpression(pipe) &&
        ts.isIdentifier(pipe.expression) &&
        pipe.expression.text === 'ValidationPipe'
      ) {
        options = pipe.arguments?.[0];
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(main);
  function literal(node: ts.Expression): unknown {
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (ts.isObjectLiteralExpression(node)) {
      return Object.fromEntries(
        node.properties.map((property) => {
          if (
            !ts.isPropertyAssignment(property) ||
            !ts.isIdentifier(property.name)
          ) {
            throw new Error('Review non-literal main ValidationPipe options');
          }
          return [property.name.text, literal(property.initializer)];
        }),
      );
    }
    throw new Error('Review non-literal main ValidationPipe options');
  }
  if (!options) throw new Error('Missing main ValidationPipe options');
  const configured = literal(options) as ValidationPipeOptions;
  expect(configured).toEqual({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  });
  return new ValidationPipe(configured);
}

const rawValues: Array<{ label: string; value: unknown }> = [
  { label: 'boolean true', value: true },
  { label: 'boolean false', value: false },
  { label: 'string false', value: 'false' },
  { label: 'string true', value: 'true' },
  { label: 'string zero', value: '0' },
  { label: 'string one', value: '1' },
  { label: 'empty string', value: '' },
  { label: 'whitespace false', value: ' false ' },
  { label: 'number zero', value: 0 },
  { label: 'number one', value: 1 },
  { label: 'negative number', value: -1 },
  { label: 'null', value: null },
  { label: 'omitted', value: undefined },
  { label: 'empty array', value: [] },
  { label: 'boolean array', value: [true] },
  { label: 'object', value: { confirmed: true } },
];

const uuid = 'd05b1879-8f85-4a19-b0db-4ff89dc8adb8';
const shared = {
  entityId: 'SYNTHETIC-COMPANY',
  requestId: 'confirmed-test-123',
  expectedVersion: '7',
  location: 'SYNTHETIC-LOCATION',
};
const entries: Array<{
  name: string;
  dto: Type<object>;
  optionalConfirmation: boolean;
  body: Record<string, unknown>;
}> = [
  {
    name: 'tablet acceptance',
    dto: MailroomTabletAcceptDto,
    optionalConfirmation: false,
    body: {
      ...shared,
      employeeNo: 'SYNTHETIC-EMPLOYEE',
      password: 'SYNTHETIC-PASSWORD',
    },
  },
  {
    name: 'repair original return',
    dto: RepairWorkflowDto,
    optionalConfirmation: true,
    body: { ...shared, action: 'return_original' },
  },
  {
    name: 'factory shipment',
    dto: RepairWorkflowDto,
    optionalConfirmation: true,
    body: { ...shared, action: 'send_factory' },
  },
  {
    name: 'factory return receipt',
    dto: RepairWorkflowDto,
    optionalConfirmation: true,
    body: { ...shared, action: 'receive_factory' },
  },
  {
    name: 'return stock IN',
    dto: ReceiveReturnStockDto,
    optionalConfirmation: false,
    body: {
      ...shared,
      requestId: uuid,
      sourceItemId: uuid,
      productId: uuid,
      warehouseId: uuid,
      quantity: 1,
      unitLabel: 'SYNTHETIC-UNIT',
      sourceLocation: 'SYNTHETIC-ORIGINAL-LOCATION',
      ownershipReference: 'SYNTHETIC-OWNERSHIP',
      inspectionReference: 'SYNTHETIC-INSPECTION',
    },
  },
];

describe.each(entries)('$name uses raw JSON physical confirmation', (entry) => {
  it.each(rawValues)('$label', async ({ value }) => {
    const body = { ...entry.body };
    if (value !== undefined) body.confirmedItems = value;
    const transform = mainValidationPipe().transform(body, {
      type: 'body',
      metatype: entry.dto,
    });
    const allowedByDto =
      value === true ||
      (entry.optionalConfirmation &&
        (value === false || value === null || value === undefined));
    if (allowedByDto) {
      const transformed: unknown = await transform;
      expect(transformed).toBeInstanceOf(entry.dto);
      expect(transformed).toMatchObject({ expectedVersion: 7 });
      expect((transformed as { confirmedItems?: unknown }).confirmedItems).toBe(
        value,
      );
    } else {
      await expect(transform).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(body.expectedVersion).toBe('7');
    expect(body.confirmedItems).toBe(value);
  });
});

it('keeps non-physical repair actions optional and normal version conversion', async () => {
  const transformed: unknown = await mainValidationPipe().transform(
    { ...shared, action: 'claim_customer', inspectionRevision: '3' },
    { type: 'body', metatype: RepairWorkflowDto },
  );
  expect(transformed).toMatchObject({
    action: 'claim_customer',
    expectedVersion: 7,
    inspectionRevision: 3,
  });
  expect((transformed as RepairWorkflowDto).confirmedItems).toBeUndefined();
  const fixture = factoryFixture('send_factory');
  fixture.actor.permissions.add('mailroom:review');
  fixture.row.status = 'WAITING_CUSTOMER';
  fixture.row.repairWorkflow.csr = {
    ...fixture.row.repairWorkflow.csr!,
    status: 'SENT',
    sentToUserId: fixture.actor.id,
    ownerId: undefined,
  };
  await expect(
    fixture.service.workflow(
      fixture.actor.id,
      fixture.row.id,
      transformed as RepairWorkflowDto,
    ),
  ).resolves.toMatchObject({ duplicate: false });
  expect(fixture.row.repairWorkflow.csr).toMatchObject({
    status: 'ACCEPTED',
    ownerId: fixture.actor.id,
  });
  expect(fixture.row).toMatchObject({
    version: 8,
    status: 'WAITING_CUSTOMER',
    custodianId: fixture.actor.id,
    location: 'SYNTHETIC-OLD-LOCATION',
  });
});

function factoryFixture(action: 'send_factory' | 'receive_factory') {
  const actor: Actor = {
    id: 'SYNTHETIC-TECH',
    name: 'SYNTHETIC-TECH',
    entityIds: [shared.entityId],
    permissions: new Set(['repair_workbench:read', 'repair_workbench:update']),
  };
  const inspection: InspectionDocument = {
    number: 'SYNTHETIC-INSPECTION',
    revision: 3,
    status: 'SUBMITTED',
    authorId: actor.id,
    authorName: actor.name,
    updatedAt: '2026-10-08T00:00:00Z',
    data: {
      complaint: 'SYNTHETIC FACTORY CHECK',
      reproduction: 'YES',
      testConditions: 'SYNTHETIC TEST',
      checks: [{ name: 'SYNTHETIC', result: 'FAIL', observation: 'SYNTHETIC' }],
      diagnosis: 'SYNTHETIC FACTORY ISSUE',
      causeStatus: 'CONFIRMED',
      plan: 'FACTORY',
      planNote: 'SYNTHETIC FACTORY PLAN',
      feeSuggestion: 'FREE',
      estimateAmount: 0,
      estimateNote: 'SYNTHETIC NO PAYMENT',
    },
  };
  const planHash = inspectionPlanHash(inspection);
  const row = {
    id: uuid,
    entityId: shared.entityId,
    version: 7,
    status: action === 'send_factory' ? 'INSPECTING' : 'FACTORY_RETURNING',
    custodianId: actor.id,
    repairOwnerId: actor.id,
    nextUserId: null,
    location: 'SYNTHETIC-OLD-LOCATION',
    repairInspection: inspection,
    repairWorkflow: { schema: 1 } as RepairWorkflow,
    receipt: {
      category: 'REPAIR',
      sourceCaseId: 'SYNTHETIC-CASE',
      receivedById: 'SYNTHETIC-CLERK',
      customerServiceUserId: 'SYNTHETIC-CSR',
    },
  };
  const sent = sentCustomerWorkflow(row, actor, inspection.updatedAt, 4);
  row.repairWorkflow = {
    ...sent,
    csr: {
      ...sent.csr!,
      status: 'RESOLVED',
      ownerId: 'SYNTHETIC-CSR',
      decision: 'APPROVE',
    },
    ...(action === 'receive_factory'
      ? {
          factory: {
            stage: 'RETURNING' as const,
            physicalCustody: 'FACTORY_CARRIER' as const,
            inspectionRevision: inspection.revision,
            planHash,
            factoryName: 'SYNTHETIC-FACTORY',
            reference: 'SYNTHETIC-REFERENCE',
          },
        }
      : {}),
  };
  inspection.review = {
    inspectionRevision: inspection.revision,
    actorId: 'SYNTHETIC-CSR',
    name: 'SYNTHETIC-CSR',
    confirmedAt: inspection.updatedAt,
    decision: 'APPROVE',
    planHash,
    quoteRevision: 4,
  };
  const tx = {
    employee: {
      findFirst: jest.fn().mockResolvedValue({ id: 'SYNTHETIC-EMPLOYEE' }),
    },
    mailroomItem: {
      findUnique: jest.fn().mockResolvedValue(row),
      update: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        Object.assign(row, { ...data, version: row.version + 1 });
        return Promise.resolve(row);
      }),
    },
    mailroomAction: { findUnique: jest.fn().mockResolvedValue(null) },
    $queryRaw: jest.fn().mockResolvedValue([]),
  };
  const prisma = {
    ...tx,
    $transaction: (callback: (client: typeof tx) => Promise<unknown>) =>
      callback(tx),
  };
  const mailroom = {
    enabled: jest.fn(),
    actor: jest.fn().mockResolvedValue(actor),
    record: jest.fn().mockResolvedValue([]),
    publish: jest.fn(),
  };
  const sync = {
    cases: jest.fn().mockResolvedValue({
      items: [
        {
          id: row.receipt.sourceCaseId,
          type: 'REPAIR',
          version: 'SYNTHETIC-SOURCE-VERSION',
          repairAllowed: true,
          releaseInfo: {
            quoteRevision: 4,
            customerApprovedQuoteRevision: 4,
            customerApprovedAt: inspection.updatedAt,
            amount: 0,
            currency: 'TWD',
            confirmedPaymentQuoteRevision: null,
          },
        },
      ],
    }),
  };
  type Dependencies = ConstructorParameters<typeof RepairWorkbenchService>;
  return {
    row,
    tx,
    mailroom,
    actor,
    service: new RepairWorkbenchService(
      prisma as unknown as Dependencies[0],
      mailroom as unknown as Dependencies[1],
      sync as unknown as Dependencies[2],
    ),
  };
}

describe.each(['send_factory', 'receive_factory'] as const)(
  '%s preserves the real physical confirmation guard after main pipe',
  (action) => {
    it.each([true, false, null, undefined])(
      'raw confirmation %s',
      async (confirmedItems) => {
        const fixture = factoryFixture(action);
        const raw: Record<string, unknown> = {
          ...shared,
          action,
          note: 'SYNTHETIC FACTORY HANDOFF',
          factoryName: 'SYNTHETIC-FACTORY',
          reference: 'SYNTHETIC-REFERENCE',
          carrier: 'SYNTHETIC-CARRIER',
          trackingNumber: 'SYNTHETIC-TRACKING',
        };
        if (confirmedItems !== undefined) raw.confirmedItems = confirmedItems;
        const transformed: unknown = await mainValidationPipe().transform(raw, {
          type: 'body',
          metatype: RepairWorkflowDto,
        });
        const operation = fixture.service.workflow(
          fixture.actor.id,
          fixture.row.id,
          transformed as RepairWorkflowDto,
        );
        if (confirmedItems === true) {
          await expect(operation).resolves.toMatchObject({ duplicate: false });
          expect(fixture.tx.mailroomItem.update).toHaveBeenCalledTimes(1);
          expect(fixture.mailroom.record).toHaveBeenCalledTimes(1);
          expect(fixture.row.version).toBe(8);
          expect(fixture.row.status).toBe(
            action === 'send_factory' ? 'FACTORY_OUTBOUND' : 'INSPECTING',
          );
        } else {
          await expect(operation).rejects.toThrow('本人核對');
          expect(fixture.tx.mailroomItem.update).not.toHaveBeenCalled();
          expect(fixture.mailroom.record).not.toHaveBeenCalled();
          expect(fixture.mailroom.publish).not.toHaveBeenCalled();
          expect(fixture.row.version).toBe(7);
        }
      },
    );
  },
);
