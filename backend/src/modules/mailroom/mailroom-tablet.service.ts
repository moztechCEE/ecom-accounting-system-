import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { requireEntity, requirePermission } from './mailroom.contract';
import { MailroomTabletAcceptDto } from './mailroom-tablet.dto';
import { MailroomService } from './mailroom.service';

type AttemptWindow = { count: number; expiresAt: number };
const ACCEPTABLE_STATES = ['WAITING_REPAIR_ACCEPTANCE', 'PENDING_REFURBISH'];
const ATTEMPT_WINDOW_MS = 5 * 60 * 1000;
const MAX_ATTEMPT_KEYS = 2000;

@Injectable()
export class MailroomTabletService {
  // Failed attempts are bounded per clerk and recipient, without storing passwords or tokens.
  // This is a process-local guard; a multi-instance release must also apply its shared ingress limit.
  private readonly attempts = new Map<string, AttemptWindow>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailroom: MailroomService,
    private readonly auth: AuthService,
  ) {}

  private consumeAttempt(keys: Array<{ key: string; limit: number }>) {
    const now = Date.now();
    for (const [key, value] of this.attempts)
      if (value.expiresAt <= now) this.attempts.delete(key);
    for (const { key, limit } of keys) {
      const value = this.attempts.get(key);
      if (value && value.count >= limit)
        throw new HttpException('本人確認嘗試次數過多，請稍後再試', 429);
    }
    const newKeys = keys.filter(({ key }) => !this.attempts.has(key)).length;
    if (this.attempts.size + newKeys > MAX_ATTEMPT_KEYS)
      throw new HttpException('本人確認暫時繁忙，請稍後再試', 429);
    for (const { key } of keys) {
      const value = this.attempts.get(key);
      this.attempts.set(key, {
        count: (value?.count || 0) + 1,
        expiresAt: value?.expiresAt || now + ATTEMPT_WINDOW_MS,
      });
    }
  }

  async accept(clerkId: string, id: string, input: MailroomTabletAcceptDto) {
    this.mailroom.enabled();
    const clerk = await this.mailroom.actor(clerkId);
    requireEntity(clerk, input.entityId);
    requirePermission(clerk, 'mailroom:update');
    if (input.confirmedItems !== true || !input.location?.trim())
      throw new BadRequestException('請核對本次實際交接物件並填寫存放位置');

    const item = await this.prisma.mailroomItem.findUnique({
      where: { id },
      select: {
        entityId: true,
        version: true,
        status: true,
        custodianId: true,
        nextUserId: true,
        receipt: { select: { category: true } },
      },
    });
    if (!item || item.entityId !== input.entityId)
      throw new NotFoundException('找不到物件');
    if (!['REPAIR', 'RETURN'].includes(item.receipt.category))
      throw new BadRequestException('此簽收入口僅供維修／整新交接');

    // Durable replay uses the original signer and tablet clerk. The command still verifies
    // the exact request hash; an ordinary signature cannot be replayed through this endpoint.
    const previous = await this.prisma.mailroomAction.findFirst({
      where: {
        entityId: input.entityId,
        itemId: id,
        requestId: input.requestId,
        action: 'accept',
      },
      select: {
        actorId: true,
        version: true,
        fromStatus: true,
        snapshot: true,
      },
    });
    const handoff = (previous?.snapshot as any)?.tabletHandoff;
    const replay =
      previous?.version === input.expectedVersion + 1 &&
      ACCEPTABLE_STATES.includes(previous.fromStatus || '') &&
      handoff?.clerkId === clerkId &&
      handoff?.signerId === previous.actorId;

    if (!replay) {
      if (item.custodianId !== clerkId)
        throw new ForbiddenException('只有目前保管的收發室人員可發起交接');
      if (item.version !== input.expectedVersion)
        throw new ConflictException('物件進度已更新，請重新開啟交接畫面');
      if (!ACCEPTABLE_STATES.includes(item.status) || !item.nextUserId)
        throw new ConflictException('此物件目前不在待維修／整新簽收節點');
    }
    const expectedSignerId = replay ? previous!.actorId : item.nextUserId;
    const attemptKeys = [
      { key: `clerk:${clerkId}`, limit: 10 },
      {
        key: `recipient:${input.entityId}:${input.employeeNo.trim().toLowerCase()}`,
        limit: 5,
      },
    ];
    this.consumeAttempt(attemptKeys);
    const identity = await this.auth.login({
      entityId: item.entityId,
      employeeNo: input.employeeNo.trim(),
      password: input.password,
      twoFactorToken: input.twoFactorToken,
    });
    // Deliberately discard identity.access_token: shared tablets keep the clerk's session.
    if (identity.user.id !== expectedSignerId)
      throw new ForbiddenException('請由本次指定的維修人員本人確認簽收');
    const signer = await this.mailroom.actor(identity.user.id);
    requireEntity(signer, item.entityId);
    requirePermission(signer, 'repair_workbench:update');
    const employee = await this.prisma.employee.findFirst({
      where: { userId: signer.id, entityId: item.entityId, isActive: true },
      select: { id: true },
    });
    if (!employee)
      throw new ForbiddenException('簽收人必須是此公司已綁定帳號的在職員工');

    const result = await this.mailroom.command(
      signer.id,
      id,
      {
        entityId: input.entityId,
        requestId: input.requestId,
        expectedVersion: input.expectedVersion,
        action: 'accept',
        confirmedItems: true,
        location: input.location.trim(),
      },
      { tabletClerkId: clerkId },
    );
    for (const { key } of attemptKeys) this.attempts.delete(key);
    return { id: result.id, duplicate: result.duplicate };
  }
}
