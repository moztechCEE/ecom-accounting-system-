import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AfterSalesTasksController } from './after-sales-tasks.controller';
import { RegisterAfterSalesCaseDto } from './after-sales-tasks.dto';
import { AfterSalesTasksService } from './after-sales-tasks.service';

describe('native after-sales registration actor consistency', () => {
  const register = jest.fn();
  const controller = new AfterSalesTasksController({
    register,
  } as unknown as AfterSalesTasksService);
  const body = {
    entityId: 'company-a',
    requestId: '83362099-c6d6-4831-9d06-0b539ea9ad37',
    brand: 'MOZTECH',
    customerKind: 'CONSUMER',
    payload: { type: 'REPAIR' },
  } as unknown as RegisterAfterSalesCaseDto;

  beforeEach(() => register.mockReset());

  it.each([undefined, '', 'actor-a, actor-b', ' actor-a', 'x'.repeat(129)])(
    'rejects missing or malformed actor %p before calling Source',
    (expectedActorId) => {
      expect(() =>
        controller.register({ user: { id: 'actor-a' } }, body, expectedActorId),
      ).toThrow(BadRequestException);
      expect(register).not.toHaveBeenCalled();
    },
  );

  it('rejects a journal from actor A dispatched with actor B JWT before Source', () => {
    expect(() =>
      controller.register({ user: { id: 'actor-b' } }, body, 'actor-a'),
    ).toThrow(ForbiddenException);
    expect(register).not.toHaveBeenCalled();
  });

  it('passes the unchanged idempotency body using authenticated actor identity', () => {
    const result = { caseId: 'case-a' };
    register.mockReturnValue(result);
    expect(
      controller.register({ user: { id: 'actor-a' } }, body, 'actor-a'),
    ).toBe(result);
    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith('actor-a', body);
  });
});
