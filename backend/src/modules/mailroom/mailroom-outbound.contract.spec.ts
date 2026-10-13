import { BadRequestException, ConflictException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  allocateOutboundUnits,
  outboundUnits,
  requireOutboundSource,
  requireSourceUnits,
  validateOutboundCommand,
  OutboundUnit,
} from './mailroom-outbound.contract';
import { MailroomOutboundOrder } from './mailroom-workflow-event.contract';
import { CreateOutboundDto, OutboundCommandDto } from './mailroom-outbound.dto';

const version = '2026-10-13T01:00:00.000Z';
const source = (): MailroomOutboundOrder => ({
  id: 'case-a',
  number: 'SYNTHETIC-A',
  type: 'RESHIPMENT',
  version,
  sourceChannel: 'SYNTHETIC CSR',
  brand: null,
  customerLabel: 'SYNTHETIC Customer',
  dispatchAllowed: true,
  blockReason: null,
  recipient: {
    name: 'SYNTHETIC Customer',
    phone: '0900000000',
    address: 'SYNTHETIC Address',
  },
  items: [
    {
      id: 'line-a',
      name: 'SYNTHETIC Product',
      sku: 'SYNTHETIC-SKU',
      quantity: 5,
      dispatchedQuantity: 0,
      dispatchedUnitIds: [],
    },
  ],
});
const request = (quantity = 1): CreateOutboundDto => ({
  entityId: 'company-a',
  requestId: randomUUID(),
  sourceCaseId: 'case-a',
  sourceVersion: version,
  lines: [{ sourceCaseItemId: 'line-a', quantity }],
});
const unit = (unitId = randomUUID()): OutboundUnit => ({
  unitId,
  sourceCaseItemId: 'line-a',
  productName: 'SYNTHETIC Product',
  sku: 'SYNTHETIC-SKU',
  quantity: 1,
});

describe('outbound capacity and physical identity', () => {
  it('allocates distinct physical units from authoritative Source labels only', () => {
    const units = allocateOutboundUnits(source(), request(3), []);
    expect(units).toHaveLength(3);
    expect(new Set(units.map((value) => value.unitId)).size).toBe(3);
    expect(
      units.every(
        (value) =>
          value.quantity === 1 &&
          value.productName === 'SYNTHETIC Product' &&
          value.sku === 'SYNTHETIC-SKU',
      ),
    ).toBe(true);
  });
  it('counts the union of ACKed and native IDs exactly once, plus unmapped legacy units', () => {
    const input = source(),
      first = unit(),
      second = unit();
    input.items[0].quantity = 4;
    input.items[0].dispatchedQuantity = 2;
    input.items[0].dispatchedUnitIds = [first.unitId];
    expect(
      allocateOutboundUnits(input, request(1), [first, second]),
    ).toHaveLength(1);
    expect(() =>
      allocateOutboundUnits(input, request(2), [first, second]),
    ).toThrow(ConflictException);
  });
  it.each([0, -1, 1.5, NaN, Infinity])(
    'rejects an invalid physical quantity %p',
    (quantity) => {
      expect(() =>
        allocateOutboundUnits(source(), request(quantity), []),
      ).toThrow(BadRequestException);
    },
  );
  it('rejects missing or duplicated declared lines and Source products without SKU', () => {
    const missing = request();
    missing.lines[0].sourceCaseItemId = 'not-declared';
    expect(() => allocateOutboundUnits(source(), missing, [])).toThrow(
      BadRequestException,
    );
    const duplicate = request();
    duplicate.lines.push({ ...duplicate.lines[0] });
    expect(() => allocateOutboundUnits(source(), duplicate, [])).toThrow(
      BadRequestException,
    );
    const input = source();
    input.items[0].sku = null;
    expect(() => allocateOutboundUnits(input, request(), [])).toThrow(
      BadRequestException,
    );
  });
  it('enforces the two-hundred physical-unit boundary across multiple declared lines', () => {
    const input = source();
    input.items[0].quantity = 200;
    expect(allocateOutboundUnits(input, request(200), [])).toHaveLength(200);
    input.items.push({ ...input.items[0], id: 'line-b' });
    const inputRequest = request(200);
    inputRequest.lines.push({ sourceCaseItemId: 'line-b', quantity: 1 });
    expect(() => allocateOutboundUnits(input, inputRequest, [])).toThrow(
      BadRequestException,
    );
  });
  it('requires the exact Source case/version and an affirmative dispatch gate', () => {
    expect(() => requireOutboundSource(undefined, 'case-a', version)).toThrow(
      ConflictException,
    );
    expect(() =>
      requireOutboundSource(source(), 'case-other', version),
    ).toThrow(ConflictException);
    expect(() =>
      requireOutboundSource(source(), 'case-a', '2026-10-13T02:00:00.000Z'),
    ).toThrow(ConflictException);
    const blocked = source();
    blocked.dispatchAllowed = false;
    blocked.blockReason = '等待核款';
    expect(() => requireOutboundSource(blocked, 'case-a', version)).toThrow(
      '等待核款',
    );
  });
  it('rejects changed name/SKU or an absent Source line before physical action', () => {
    for (const patch of [
      { productName: 'different' },
      { sku: 'different' },
      { sourceCaseItemId: 'other' },
    ]) {
      expect(() =>
        requireSourceUnits(source(), [{ ...unit(), ...patch }]),
      ).toThrow(ConflictException);
    }
    expect(() => requireSourceUnits(source(), [unit()])).not.toThrow();
  });
  it('reads one piece per stored unit and refuses duplicate, empty, missing or quantity-two records', () => {
    const original = [unit()];
    const result = outboundUnits(original);
    result[0].sku = 'CHANGED';
    expect(original[0].sku).toBe('SYNTHETIC-SKU');
    for (const input of [
      null,
      [],
      [null],
      [{ ...unit(), quantity: 2 }],
      [{ ...unit(), sku: '' }],
      [original[0], original[0]],
    ])
      expect(() => outboundUnits(input)).toThrow(ConflictException);
  });
  it.each([
    { action: 'cancel', confirmedItems: true },
    { action: 'retry_sync', carrier: 'CLIENT-OVERRIDE' },
    { action: 'refresh_source', items: [] },
    { action: 'accept', nextUserId: 'OTHER' },
    { action: 'dispatch', location: 'OTHER' },
  ])('rejects cross-node field mutation on $action', (extra) => {
    expect(() =>
      validateOutboundCommand({
        entityId: 'company-a',
        requestId: randomUUID(),
        expectedVersion: 1,
        ...extra,
      } as OutboundCommandDto),
    ).toThrow(BadRequestException);
  });
});
