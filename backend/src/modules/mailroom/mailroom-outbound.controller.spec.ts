import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  ValidationPipe,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CreateOutboundDto, OutboundCommandDto } from './mailroom-outbound.dto';
import { MailroomOutboundController } from './mailroom-outbound.controller';
import { MailroomOutboundService } from './mailroom-outbound.service';

const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});
const create = () => ({
  entityId: 'company-a',
  requestId: randomUUID(),
  sourceCaseId: 'case-a',
  sourceVersion: '2026-10-13T01:00:00.000Z',
  lines: [{ sourceCaseItemId: 'line-a', quantity: 1 }],
});
const action = () => ({
  entityId: 'company-a',
  requestId: randomUUID(),
  expectedVersion: 1,
  action: 'accept',
  confirmedItems: true,
  location: 'A1',
});

describe('production outbound DTO pipeline and authenticated identity forwarding', () => {
  it.each(['true', 'false', 1, 0, [], {}])(
    'does not coerce physical confirmation %p into a boolean',
    async (confirmedItems) => {
      await expect(
        pipe.transform(
          { ...action(), confirmedItems },
          { type: 'body', metatype: OutboundCommandDto },
        ),
      ).rejects.toThrow(BadRequestException);
    },
  );
  it.each([true, false])(
    'preserves a literal physical boolean %p for the service to decide',
    async (confirmedItems) => {
      const result = await pipe.transform(
        { ...action(), confirmedItems },
        { type: 'body', metatype: OutboundCommandDto },
      );
      expect(result.confirmedItems).toBe(confirmedItems);
    },
  );
  it('rejects caller Source snapshots and nested product identity before the service', async () => {
    await expect(
      pipe.transform(
        { ...create(), sourceSnapshot: { dispatchAllowed: true } },
        { type: 'body', metatype: CreateOutboundDto },
      ),
    ).rejects.toThrow(BadRequestException);
    await expect(
      pipe.transform(
        {
          ...create(),
          lines: [
            { sourceCaseItemId: 'line-a', quantity: 1, sku: 'CLIENT-SKU' },
          ],
        },
        { type: 'body', metatype: CreateOutboundDto },
      ),
    ).rejects.toThrow(BadRequestException);
    await expect(
      pipe.transform(
        { ...action(), actorId: 'another-user' },
        { type: 'body', metatype: OutboundCommandDto },
      ),
    ).rejects.toThrow(BadRequestException);
  });
  it('passes the validated original request body using req.user identity', async () => {
    const service = {
      create: jest.fn().mockResolvedValue({ id: 'order-a', duplicate: false }),
      command: jest.fn().mockResolvedValue({ id: 'order-a', duplicate: true }),
      detail: jest
        .fn()
        .mockResolvedValue({ id: 'order-a', status: 'PENDING_PICK' }),
    };
    const controller = new MailroomOutboundController(
      service as unknown as MailroomOutboundService,
    );
    const input = await pipe.transform(create(), {
      type: 'body',
      metatype: CreateOutboundDto,
    });
    const operation = await pipe.transform(action(), {
      type: 'body',
      metatype: OutboundCommandDto,
    });
    await expect(
      controller.create({ user: { id: 'authenticated-clerk' } }, input),
    ).resolves.toEqual({
      id: 'order-a',
      status: 'PENDING_PICK',
      duplicate: false,
    });
    await expect(
      controller.command(
        { user: { id: 'authenticated-clerk' } },
        'order-a',
        operation,
      ),
    ).resolves.toEqual({
      id: 'order-a',
      status: 'PENDING_PICK',
      duplicate: true,
    });
    expect(service.create).toHaveBeenCalledWith('authenticated-clerk', input);
    expect(service.command).toHaveBeenCalledWith(
      'authenticated-clerk',
      'order-a',
      operation,
    );
    expect(service.detail).toHaveBeenCalledWith(
      'authenticated-clerk',
      'company-a',
      'order-a',
    );
  });
  it.each([
    ['create', new ForbiddenException('read access revoked')],
    ['command', new NotFoundException('receipt unavailable')],
  ] as const)(
    'returns retryable 503 after %s committed but its detail read failed',
    async (operation, readError) => {
      const service = {
        create: jest
          .fn()
          .mockResolvedValue({ id: 'order-a', duplicate: false }),
        command: jest
          .fn()
          .mockResolvedValue({ id: 'order-a', duplicate: false }),
        detail: jest.fn().mockRejectedValue(readError),
      };
      const controller = new MailroomOutboundController(
        service as unknown as MailroomOutboundService,
      );
      const req = { user: { id: 'authenticated-clerk' } };
      const promise =
        operation === 'create'
          ? controller.create(req, create())
          : controller.command(req, 'order-a', action() as OutboundCommandDto);
      await expect(promise).rejects.toThrow(ServiceUnavailableException);
      await expect(promise).rejects.toMatchObject({ status: 503 });
      expect(service[operation]).toHaveBeenCalledTimes(1);
      expect(service.detail).toHaveBeenCalledTimes(1);
      expect(
        service[operation === 'create' ? 'command' : 'create'],
      ).not.toHaveBeenCalled();
    },
  );
  it.each(['create', 'command'] as const)(
    'preserves original %s writer validation errors without reading detail',
    async (operation) => {
      const error = new BadRequestException('invalid original operation');
      const service = {
        create: jest.fn().mockRejectedValue(error),
        command: jest.fn().mockRejectedValue(error),
        detail: jest.fn(),
      };
      const controller = new MailroomOutboundController(
          service as unknown as MailroomOutboundService,
        ),
        req = { user: { id: 'authenticated-clerk' } };
      const promise =
        operation === 'create'
          ? controller.create(req, create())
          : controller.command(req, 'order-a', action() as OutboundCommandDto);
      await expect(promise).rejects.toBe(error);
      expect(service[operation]).toHaveBeenCalledTimes(1);
      expect(service.detail).not.toHaveBeenCalled();
    },
  );
});
