import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MailroomService } from './mailroom.service';
import { MailroomSyncService } from './mailroom-sync.service';
import { can, requireEntity, requirePermission } from './mailroom.contract';

@Injectable()
export class MailroomSourceMediaService {
  constructor(
    private readonly mailroom: MailroomService,
    private readonly sync: MailroomSyncService,
  ) {}
  private async scope(userId: string, entityId: string) {
    this.mailroom.enabled();
    const actor = await this.mailroom.actor(userId);
    requireEntity(actor, entityId);
    if (can(actor, 'mailroom:read')) return 'ALL' as const;
    if (
      can(actor, 'mailroom:review') &&
      can(actor, 'after_sales_cases:read') &&
      can(actor, 'after_sales_cases:update')
    ) {
      try {
        await this.mailroom.intakeCustomerService(userId, entityId);
        return 'ALL' as const;
      } catch (error) {
        if (
          !(error instanceof ForbiddenException) ||
          !can(actor, 'repair_workbench:read')
        )
          throw error;
        const fresh = await this.mailroom.actor(userId);
        requireEntity(fresh, entityId);
        requirePermission(fresh, 'repair_workbench:read');
        return 'REPAIR' as const;
      }
    }
    requirePermission(actor, 'repair_workbench:read');
    return 'REPAIR' as const;
  }
  private async selectedCase(userId: string, entityId: string, caseId: string) {
    const scope = await this.scope(userId, entityId);
    const page = await this.sync.cases(entityId, '', caseId);
    const selected = page.items.find((item) => item.id === caseId);
    if (!selected || (scope === 'REPAIR' && selected.type !== 'REPAIR'))
      throw new NotFoundException('無此售後案件存取權限');
    await this.recheckCase(userId, entityId, selected.type);
    return selected;
  }
  private async recheckCase(userId: string, entityId: string, type: string) {
    if ((await this.scope(userId, entityId)) === 'REPAIR' && type !== 'REPAIR')
      throw new NotFoundException('無此售後案件存取權限');
  }
  async attachments(userId: string, entityId: string, caseId: string) {
    const selected = await this.selectedCase(userId, entityId, caseId);
    const result = await this.sync.caseAttachments(entityId, caseId);
    await this.recheckCase(userId, entityId, selected.type);
    return result;
  }
  async media(
    userId: string,
    entityId: string,
    caseId: string,
    attachmentId: string,
  ) {
    const selected = await this.selectedCase(userId, entityId, caseId);
    const result = await this.sync.caseAttachmentMedia(
      entityId,
      caseId,
      attachmentId,
    );
    await this.recheckCase(userId, entityId, selected.type);
    return result;
  }
  async summary(userId: string, entityId: string) {
    if ((await this.scope(userId, entityId)) !== 'ALL')
      throw new ForbiddenException('沒有全部收件數量的讀取權限');
    const result = await this.sync.sourceSummary(entityId);
    if ((await this.scope(userId, entityId)) !== 'ALL')
      throw new ForbiddenException('沒有全部收件數量的讀取權限');
    return result;
  }
}
