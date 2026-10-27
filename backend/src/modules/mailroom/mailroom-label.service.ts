import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MailroomService } from './mailroom.service';
import { MailroomSyncService } from './mailroom-sync.service';
import {
  fingerprint,
  requireEntity,
  requirePermission,
} from './mailroom.contract';
import {
  labelCustomer,
  labelOrigin,
  labelQrLink,
  requireLabelItemId,
  type LabelItem,
  type MailroomLabel,
} from './mailroom-label.contract';

const labelSelect = {
  id: true,
  entityId: true,
  label: true,
  productName: true,
  version: true,
  receiptId: true,
  receipt: {
    select: {
      entityId: true,
      category: true,
      sourceCaseId: true,
      sourceNumber: true,
    },
  },
} as const;

@Injectable()
export class MailroomLabelService {
  constructor(
    private readonly db: PrismaService,
    private readonly mailroom: MailroomService,
    private readonly sync: MailroomSyncService,
  ) {}

  private async scope(userId: string, entityId: string) {
    this.mailroom.enabled();
    const actor = await this.mailroom.actor(userId);
    requireEntity(actor, entityId);
    requirePermission(actor, 'mailroom:read');
  }

  private async item(entityId: string, id: string): Promise<LabelItem> {
    const item = await this.db.mailroomItem.findFirst({
      where: { id, entityId, receipt: { entityId } },
      select: labelSelect,
    });
    if (
      !item ||
      item.id !== id ||
      item.entityId !== entityId ||
      item.receipt.entityId !== entityId
    )
      throw new NotFoundException('找不到此公司的收件物件');
    return item;
  }

  async read(
    userId: string,
    entityId: string,
    id: string,
  ): Promise<MailroomLabel> {
    requireLabelItemId(id);
    await this.scope(userId, entityId);
    const origin = labelOrigin();
    const item = await this.item(entityId, id);
    let customer = {
      caseNumber: item.receipt.sourceNumber,
      customerName: null as string | null,
      customerPhone: null as string | null,
      customerIssue: null as string | null,
    };
    if (
      ['REPAIR', 'RETURN'].includes(item.receipt.category) &&
      item.receipt.sourceCaseId
    ) {
      let page: Awaited<ReturnType<MailroomSyncService['cases']>>;
      try {
        page = await this.sync.cases(entityId, '', item.receipt.sourceCaseId);
      } catch {
        throw new ServiceUnavailableException(
          '售後標籤資料暫時無法讀取，請稍後重試',
        );
      }
      // An external wait cannot resurrect a revoked reader or a relinked item.
      await this.scope(userId, entityId);
      const current = await this.item(entityId, id);
      if (fingerprint(current) !== fingerprint(item))
        throw new ConflictException('收件資料已更新，請重新列印標籤');
      if (page.items.length !== 1)
        throw new NotFoundException('找不到此收件的售後案件');
      customer = labelCustomer(page.items[0], item);
    }
    return {
      id: item.id,
      unit: item.label,
      ...customer,
      productName: item.productName,
      qrLink: labelQrLink(origin, item),
      version: item.version,
    };
  }
}
