import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type MailroomOutboundOrder } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationGateway } from '../notification/notification.gateway';
import { MailroomService } from './mailroom.service';
import { MailroomSyncService } from './mailroom-sync.service';
import { buildExchangeReadyEvent } from './mailroom-exchange-ready.contract';
import {
  MailroomOutboundStockService,
  type OutboundStockProof,
} from './mailroom-outbound-stock.service';
import {
  can,
  fingerprint,
  requireEntity,
  requirePermission,
  type Actor,
} from './mailroom.contract';
import {
  allocateOutboundUnits,
  outboundUnits,
  requireOutboundSource,
  requireSourceUnits,
  validateOutboundCommand,
  type OutboundUnit,
} from './mailroom-outbound.contract';
import {
  DISPATCH_SCHEMA,
  validateDispatchEvent,
  type MailroomOutboundOrder as SourceOrder,
} from './mailroom-workflow-event.contract';
import {
  CreateOutboundDto,
  OutboundCommandDto,
  OutboundQuery,
} from './mailroom-outbound.dto';

const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const stockWriter = (actor: Actor) =>
  can(actor, 'inventory:update') || can(actor, 'after_sales_stock:update');
const physicalText = (value: unknown, label: string, max = 160) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new BadRequestException(`請填寫${label}`);
  return value.trim();
};
@Injectable()
export class MailroomOutboundService {
  constructor(
    private readonly db: PrismaService,
    private readonly mailroom: MailroomService,
    private readonly sync: MailroomSyncService,
    private readonly stock: MailroomOutboundStockService,
    private readonly gateway: NotificationGateway,
  ) {}
  private async reader(
    userId: string,
    entityId: string,
    tx?: Prisma.TransactionClient,
  ) {
    this.mailroom.enabled();
    const actor = await this.mailroom.actor(userId, tx);
    requireEntity(actor, entityId);
    requirePermission(actor, 'mailroom:read');
    return actor;
  }
  private writer(actor: Actor, action: string) {
    if (action === 'prepare') {
      if (!stockWriter(actor)) throw new ForbiddenException('沒有備貨出庫權限');
    } else requirePermission(actor, 'mailroom:update');
  }
  private async employee(
    tx: Prisma.TransactionClient,
    id: string,
    entityId: string,
  ) {
    const employee = await tx.employee.findFirst({
      where: { userId: id, entityId, isActive: true },
      select: { id: true },
    });
    if (!employee) throw new ForbiddenException('請由本公司在職同仁處理實物');
    return employee;
  }
  async sources(userId: string, q: OutboundQuery) {
    await this.reader(userId, q.entityId);
    const result = await this.sync.outboundOrders(
      q.entityId,
      q.search || '',
      q.caseId,
      q.cursor,
    );
    const plans = result.items.length
      ? await this.db.mailroomOutboundOrder.findMany({
          where: {
            entityId: q.entityId,
            sourceCaseId: { in: result.items.map((item) => item.id) },
            status: { not: 'CANCELLED' },
          },
          select: { sourceCaseId: true, items: true },
        })
      : [];
    const items = result.items.map((source) => ({
      ...source,
      items: source.items.map((line) => {
        const acknowledged = new Set(line.dispatchedUnitIds);
        const planned = new Set(
          plans
            .filter((plan) => plan.sourceCaseId === source.id)
            .flatMap((plan) => outboundUnits(plan.items))
            .filter(
              (unit) =>
                unit.sourceCaseItemId === line.id &&
                !acknowledged.has(unit.unitId),
            )
            .map((unit) => unit.unitId),
        );
        return { ...line, plannedQuantity: planned.size };
      }),
    }));
    // Recheck actor/company after an asynchronous remote read.
    await this.reader(userId, q.entityId);
    return { ...result, items };
  }
  async warehouses(userId: string, entityId: string) {
    const actor = await this.reader(userId, entityId);
    this.writer(actor, 'prepare');
    const items = await this.db.warehouse.findMany({
      where: { entityId, isActive: true },
      select: { id: true, entityId: true, code: true, name: true },
      orderBy: { code: 'asc' },
      take: 200,
    });
    await this.reader(userId, entityId);
    return { items };
  }
  private actions(actor: Actor, row: MailroomOutboundOrder) {
    const actions: string[] = [];
    if (row.status === 'PENDING_PICK') {
      if (stockWriter(actor)) actions.push('prepare');
      if (can(actor, 'mailroom:update')) actions.push('cancel');
    }
    if (can(actor, 'mailroom:update')) {
      if (!['DISPATCHED', 'CANCELLED'].includes(row.status))
        actions.push('refresh_source');
      if (
        row.status === 'WAITING_MAILROOM_ACCEPTANCE' &&
        row.nextUserId === actor.id
      )
        actions.push('accept');
      if (row.status === 'READY_FOR_DISPATCH' && row.custodianId === actor.id)
        actions.push('dispatch');
      if (row.status === 'DISPATCHED') actions.push('retry_sync');
    }
    return actions;
  }
  private async view(actor: Actor, row: MailroomOutboundOrder) {
    const units = outboundUnits(row.items);
    const deliveries =
      row.status === 'DISPATCHED'
        ? await this.db.mailroomDelivery.findMany({
            where: {
              entityId: row.entityId,
              itemId: { in: units.map((unit) => unit.unitId) },
              target: 'AFTER_SALES',
            },
            select: {
              status: true,
              attempts: true,
              lastError: true,
              payload: true,
            },
          })
        : [];
    const matches = deliveries.filter((delivery) => {
      const value = delivery.payload as { schema?: string; receiptId?: string };
      return value.schema === DISPATCH_SCHEMA && value.receiptId === row.id;
    });
    const allDelivered =
      matches.length === units.length &&
      matches.every((delivery) => delivery.status === 'DELIVERED');
    const failed = matches.some((delivery) => !!delivery.lastError);
    const people = await this.db.user.findMany({
      where: {
        id: {
          in: [row.custodianId, row.nextUserId].filter(
            (id): id is string => !!id,
          ),
        },
      },
      select: { id: true, name: true },
    });
    const name = (id: string | null) =>
      people.find((person) => person.id === id)?.name || null;
    return {
      id: row.id,
      entityId: row.entityId,
      sourceCaseId: row.sourceCaseId,
      sourceNumber: row.sourceNumber,
      caseType: row.caseType,
      sourceVersion: row.sourceVersion,
      status: row.status,
      version: row.version,
      location: row.location,
      custodianId: row.custodianId,
      custodianName: name(row.custodianId),
      nextUserId: row.nextUserId,
      nextUserName: name(row.nextUserId),
      createdAt: row.createdAt.toISOString(),
      items: units.map((unit) => ({
        unitId: unit.unitId,
        sourceCaseItemId: unit.sourceCaseItemId,
        productName: unit.productName,
        sku: unit.sku,
        quantity: 1,
        productId: unit.productId,
        warehouseId: unit.warehouseId,
        serialNumber: unit.serialNumber || null,
        postingId: unit.postingId,
      })),
      outboundShipment: row.outboundShipment,
      sourceSync: {
        status:
          row.status !== 'DISPATCHED'
            ? 'NOT_DISPATCHED'
            : allDelivered
              ? 'DELIVERED'
              : failed
                ? 'FAILED'
                : 'PENDING',
        attempts: Math.max(0, ...matches.map((delivery) => delivery.attempts)),
        lastError: failed ? '寄出結果尚未同步，請重試或聯絡承辦客服' : null,
      },
      availableActions: this.actions(actor, row),
    };
  }
  async list(userId: string, q: OutboundQuery) {
    const actor = await this.reader(userId, q.entityId);
    const page = q.page || 1;
    const where: Prisma.MailroomOutboundOrderWhereInput = {
      entityId: q.entityId,
      ...(q.status ? { status: q.status } : {}),
      ...(q.search?.trim()
        ? {
            OR: [
              {
                sourceNumber: {
                  contains: q.search.trim(),
                  mode: 'insensitive',
                },
              },
              { location: { contains: q.search.trim(), mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.mailroomOutboundOrder.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * 20,
        take: 20,
      }),
      this.db.mailroomOutboundOrder.count({ where }),
    ]);
    const items = await Promise.all(rows.map((row) => this.view(actor, row)));
    await this.reader(userId, q.entityId);
    return { items, total };
  }
  async detail(userId: string, entityId: string, id: string) {
    const actor = await this.reader(userId, entityId);
    const row = await this.db.mailroomOutboundOrder.findFirst({
      where: { id, entityId },
    });
    if (!row) throw new NotFoundException('找不到寄件單');
    const result = await this.view(actor, row);
    await this.reader(userId, entityId);
    return result;
  }
  private async source(entityId: string, caseId: string) {
    return (await this.sync.outboundOrders(entityId, '', caseId)).items.find(
      (item) => item.id === caseId,
    );
  }
  async create(userId: string, input: CreateOutboundDto) {
    const actor = await this.reader(userId, input.entityId);
    requirePermission(actor, 'mailroom:update');
    const hash = fingerprint(input);
    const existing = await this.db.mailroomOutboundOrder.findUnique({
      where: {
        entityId_createdById_requestId: {
          entityId: input.entityId,
          createdById: userId,
          requestId: input.requestId,
        },
      },
    });
    if (existing) {
      if (existing.requestHash !== hash)
        throw new ConflictException('同一操作識別碼的寄件內容不同');
      return { id: existing.id, duplicate: true };
    }
    const source = requireOutboundSource(
      await this.source(input.entityId, input.sourceCaseId),
      input.sourceCaseId,
      input.sourceVersion,
    );
    return this.db.$transaction(
      async (tx) => {
        await tx.$executeRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${input.entityId + ':outbound-case:' + input.sourceCaseId}))`,
        );
        const fresh = await this.reader(userId, input.entityId, tx);
        requirePermission(fresh, 'mailroom:update');
        const previous = await tx.mailroomOutboundOrder.findUnique({
          where: {
            entityId_createdById_requestId: {
              entityId: input.entityId,
              createdById: userId,
              requestId: input.requestId,
            },
          },
        });
        if (previous) {
          if (previous.requestHash !== hash)
            throw new ConflictException('同一操作識別碼的寄件內容不同');
          return { id: previous.id, duplicate: true };
        }
        const reused = await tx.mailroomOutboundAction.findUnique({
          where: {
            entityId_actorId_requestId: {
              entityId: input.entityId,
              actorId: userId,
              requestId: input.requestId,
            },
          },
        });
        if (reused)
          throw new ConflictException('同一操作識別碼已用於另一個寄件動作');
        // Waiting for the allocation mutex cannot retain an earlier Source release.
        const lockedSource = requireOutboundSource(
          await this.source(input.entityId, input.sourceCaseId),
          input.sourceCaseId,
          input.sourceVersion,
        );
        const afterRead = await this.reader(userId, input.entityId, tx);
        requirePermission(afterRead, 'mailroom:update');
        const plans = await tx.mailroomOutboundOrder.findMany({
          where: {
            entityId: input.entityId,
            sourceCaseId: source.id,
            status: { not: 'CANCELLED' },
          },
          select: { items: true },
        });
        const units = allocateOutboundUnits(
          lockedSource,
          input,
          plans.flatMap((plan) => outboundUnits(plan.items)),
        );
        const row = await tx.mailroomOutboundOrder.create({
          data: {
            id: randomUUID(),
            entityId: input.entityId,
            sourceCaseId: lockedSource.id,
            sourceNumber: lockedSource.number,
            caseType: lockedSource.type,
            sourceVersion: lockedSource.version,
            sourceSnapshot: json(lockedSource),
            items: json(units),
            createdById: userId,
            requestId: input.requestId,
            requestHash: hash,
          },
        });
        await tx.mailroomOutboundAction.create({
          data: {
            entityId: input.entityId,
            orderId: row.id,
            actorId: userId,
            requestId: input.requestId,
            requestHash: hash,
            action: 'create',
            toStatus: 'PENDING_PICK',
            version: 1,
            snapshot: json({ items: units, sourceVersion: source.version }),
          },
        });
        return { id: row.id, duplicate: false };
      },
      { timeout: 20000 },
    );
  }
  private proofInput(row: MailroomOutboundOrder, units: OutboundUnit[]) {
    if (
      !row.stockRequestId ||
      units.some(
        (unit) => !unit.productId || !unit.warehouseId || !unit.postingId,
      )
    )
      throw new ConflictException('尚未完成正式備貨出庫');
    return {
      entityId: row.entityId,
      orderId: row.id,
      requestId: row.stockRequestId,
      caseType: row.caseType as SourceOrder['type'],
      sourceCaseId: row.sourceCaseId,
      items: units.map((unit) => ({
        unitId: unit.unitId,
        sourceCaseItemId: unit.sourceCaseItemId,
        productId: unit.productId!,
        warehouseId: unit.warehouseId!,
        sku: unit.sku,
        serialNumber: unit.serialNumber || undefined,
        quantity: 1 as const,
        postingId: unit.postingId!,
      })),
    };
  }
  async command(userId: string, id: string, input: OutboundCommandDto) {
    validateOutboundCommand(input);
    const actor = await this.reader(userId, input.entityId);
    this.writer(actor, input.action);
    const hash = fingerprint({ id, ...input });
    const current = await this.db.mailroomOutboundOrder.findFirst({
      where: { id, entityId: input.entityId },
    });
    if (!current) throw new NotFoundException('找不到寄件單');
    const key = {
      entityId: input.entityId,
      actorId: userId,
      requestId: input.requestId,
    };
    const previous = await this.db.mailroomOutboundAction.findUnique({
      where: { entityId_actorId_requestId: key },
    });
    if (previous) {
      if (previous.orderId !== id || previous.requestHash !== hash)
        throw new ConflictException('同一操作識別碼的內容不同');
      return { id, duplicate: true };
    }
    let source: SourceOrder | undefined;
    if (
      ['prepare', 'accept', 'dispatch', 'refresh_source'].includes(input.action)
    ) {
      const latest = await this.source(input.entityId, current.sourceCaseId);
      source = requireOutboundSource(
        latest,
        current.sourceCaseId,
        input.action === 'refresh_source'
          ? latest?.version || ''
          : current.sourceVersion,
      );
      requireSourceUnits(source, outboundUnits(current.items));
    }
    const result = await this.db.$transaction(
      async (tx) => {
        await tx.$executeRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${input.entityId + ':outbound-action:' + userId + ':' + input.requestId}))`,
        );
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM mailroom_outbound_orders WHERE id=${id} AND entity_id=${input.entityId} FOR UPDATE`,
        );
        let freshActor = await this.reader(userId, input.entityId, tx);
        this.writer(freshActor, input.action);
        const row = await tx.mailroomOutboundOrder.findFirst({
          where: { id, entityId: input.entityId },
        });
        if (!row) throw new NotFoundException('找不到寄件單');
        const done = await tx.mailroomOutboundAction.findUnique({
          where: { entityId_actorId_requestId: key },
        });
        if (done) {
          if (done.orderId !== id || done.requestHash !== hash)
            throw new ConflictException('同一操作識別碼的內容不同');
          return { id, duplicate: true, notification: null };
        }
        if (
          !Number.isSafeInteger(input.expectedVersion) ||
          input.expectedVersion !== row.version
        )
          throw new ConflictException('寄件單已更新，請重新整理');
        if (!this.actions(freshActor, row).includes(input.action))
          throw new ForbiddenException('此寄件節點或接手人不符');
        if (
          ['prepare', 'accept', 'dispatch', 'refresh_source'].includes(
            input.action,
          )
        ) {
          const latest = await this.source(row.entityId, row.sourceCaseId);
          source = requireOutboundSource(
            latest,
            row.sourceCaseId,
            input.action === 'refresh_source'
              ? latest?.version || ''
              : row.sourceVersion,
          );
          if (source.type !== row.caseType)
            throw new ConflictException(
              '售後案件類型已變動，請由客服重新確認物件',
            );
          requireSourceUnits(source, outboundUnits(row.items));
          freshActor = await this.reader(userId, input.entityId, tx);
          this.writer(freshActor, input.action);
        }
        if (['prepare', 'accept', 'dispatch'].includes(input.action)) {
          requireOutboundSource(source, row.sourceCaseId, row.sourceVersion);
          if (input.confirmedItems !== true)
            throw new BadRequestException('請確認實際物件');
          await this.employee(tx, userId, row.entityId);
        }
        const units = outboundUnits(row.items);
        const changes: Prisma.MailroomOutboundOrderUpdateInput = {
          version: { increment: 1 },
        };
        let savedUnits = units;
        let notification: Prisma.NotificationGetPayload<
          Record<string, never>
        > | null = null;
        if (input.action === 'prepare') {
          if (
            !input.nextUserId ||
            !Array.isArray(input.items) ||
            input.items.length !== units.length
          )
            throw new BadRequestException('請選擇完整備貨品項及收發接手人');
          const recipient = await this.reader(
            input.nextUserId,
            row.entityId,
            tx,
          );
          requirePermission(recipient, 'mailroom:update');
          await this.employee(tx, recipient.id, row.entityId);
          const inputIds = new Set(input.items.map((unit) => unit.unitId));
          if (
            inputIds.size !== units.length ||
            units.some((unit) => !inputIds.has(unit.unitId))
          )
            throw new BadRequestException('備貨品項不符');
          const prepared = units.map((unit) => {
            const actual = input.items!.find(
              (item) => item.unitId === unit.unitId,
            )!;
            if (actual.sku !== unit.sku)
              throw new BadRequestException('備貨 SKU 與售後品項不符');
            return {
              ...unit,
              productId: actual.productId,
              warehouseId: actual.warehouseId,
              serialNumber: actual.serialNumber?.trim() || undefined,
            };
          });
          const stock = await this.stock.issue(tx, {
            actorId: userId,
            entityId: row.entityId,
            orderId: row.id,
            requestId: input.requestId,
            caseType: row.caseType as SourceOrder['type'],
            sourceCaseId: row.sourceCaseId,
            items: prepared.map((unit) => ({
              unitId: unit.unitId,
              sourceCaseItemId: unit.sourceCaseItemId,
              productId: unit.productId,
              warehouseId: unit.warehouseId,
              sku: unit.sku,
              serialNumber: unit.serialNumber,
              quantity: 1,
            })),
          });
          savedUnits = prepared.map((unit) => ({
            ...unit,
            ...stock.items.find((proof) => proof.unitId === unit.unitId),
          }));
          Object.assign(changes, {
            status: 'WAITING_MAILROOM_ACCEPTANCE',
            items: json(savedUnits),
            preparedById: userId,
            custodianId: userId,
            nextUserId: recipient.id,
            stockRequestId: input.requestId,
            location: physicalText(input.location, '備貨存放位置'),
          });
          notification = await tx.notification.create({
            data: {
              userId: recipient.id,
              title: '有寄件待點收',
              message: row.sourceNumber,
              type: 'info',
              category: 'mailroom',
              data: {
                entityId: row.entityId,
                outboundOrderId: row.id,
                link: `/operations/mailroom?tab=outbound&outboundOrderId=${encodeURIComponent(row.id)}&entityId=${encodeURIComponent(row.entityId)}`,
              },
            },
          });
        } else if (input.action === 'accept') {
          const verified = await this.stock.verify(
            tx,
            this.proofInput(row, units),
          );
          Object.assign(changes, {
            status: 'READY_FOR_DISPATCH',
            custodianId: userId,
            nextUserId: null,
            location: physicalText(input.location, '寄件存放位置'),
          });
          if (row.caseType === 'EXCHANGE_RETURN') {
            const currentSource = requireOutboundSource(
              source,
              row.sourceCaseId,
              row.sourceVersion,
            );
            if (
              verified.length !== units.length ||
              new Set(verified.map((proof) => proof.unitId)).size !==
                units.length
            )
              throw new ConflictException('換貨準備完成缺少完整逐件出庫證明');
            const now = new Date().toISOString();
            const events = [];
            for (const unit of units) {
              const proof = verified.find(
                (proof) => proof.unitId === unit.unitId,
              );
              if (!proof)
                throw new ConflictException('換貨物件缺少正式出庫證明');
              const product = await tx.product.findFirst({
                where: {
                  id: proof.productId,
                  entityId: row.entityId,
                  isActive: true,
                },
                select: {
                  id: true,
                  entityId: true,
                  name: true,
                  sku: true,
                  isActive: true,
                },
              });
              events.push(
                buildExchangeReadyEvent({
                  eventId: randomUUID(),
                  occurredAt: now,
                  actor: freshActor,
                  source: currentSource,
                  order: {
                    ...row,
                    status: 'READY_FOR_DISPATCH',
                    version: row.version + 1,
                    custodianId: freshActor.id,
                  },
                  unit,
                  proof,
                  product,
                }),
              );
            }
            // All pieces are verified before writing any ready event. They remain separate from incoming custody.
            await tx.mailroomDelivery.createMany({
              data: events.map((event) => ({
                eventId: event.eventId,
                entityId: row.entityId,
                itemId: event.itemId,
                target: 'AFTER_SALES',
                payload: json(event),
              })),
            });
          }
        } else if (input.action === 'dispatch') {
          const proof = await this.stock.verify(
            tx,
            this.proofInput(row, units),
          );
          const now = new Date().toISOString();
          const carrier = physicalText(input.carrier, '物流公司', 100),
            trackingNumber = physicalText(
              input.trackingNumber,
              '物流單號',
              100,
            );
          const events = units.map((unit) => {
            const posted = proof.find(
              (item) => item.unitId === unit.unitId,
            ) as OutboundStockProof;
            return validateDispatchEvent({
              schema: DISPATCH_SCHEMA,
              eventId: randomUUID(),
              entityId: row.entityId,
              sourceCaseId: row.sourceCaseId,
              sourceNumber: row.sourceNumber,
              sourceVersion: row.sourceVersion,
              itemId: unit.unitId,
              receiptId: row.id,
              version: row.version + 1,
              action: 'dispatch',
              occurredAt: now,
              actor: { id: freshActor.id, name: freshActor.name },
              shipment: {
                purpose: row.caseType,
                carrier,
                trackingNumber,
                shippedAt: now,
                declaredItemId: unit.sourceCaseItemId,
                quantity: 1,
                productName: unit.productName,
                sku: unit.sku,
                serialNumber: unit.serialNumber || null,
                originalSerialNumber: null,
                stock: {
                  postingId: posted.postingId,
                  referenceType: 'AFTER_SALES_OUTBOUND',
                  referenceId: row.id,
                  productId: posted.productId,
                  warehouseId: posted.warehouseId,
                  externalInventoryPosted: false,
                },
              },
            });
          });
          await tx.mailroomDelivery.createMany({
            data: events.map((event) => ({
              eventId: event.eventId,
              entityId: row.entityId,
              itemId: event.itemId,
              target: 'AFTER_SALES',
              payload: json(event),
            })),
          });
          Object.assign(changes, {
            status: 'DISPATCHED',
            nextUserId: null,
            outboundShipment: json({
              carrier,
              trackingNumber,
              dispatchedAt: now,
              dispatchedById: userId,
              eventIds: events.map((event) => event.eventId),
            }),
          });
        } else if (input.action === 'cancel') {
          // Only an unprepared plan can be cancelled; a posted OUT needs a distinct return-to-stock transaction.
          Object.assign(changes, { status: 'CANCELLED', nextUserId: null });
        } else if (input.action === 'refresh_source') {
          const latest = requireOutboundSource(
            source,
            row.sourceCaseId,
            source?.version || '',
          );
          requireSourceUnits(latest, units);
          await tx.$executeRaw(
            Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${row.entityId + ':outbound-case:' + row.sourceCaseId}))`,
          );
          const plans = await tx.mailroomOutboundOrder.findMany({
            where: {
              entityId: row.entityId,
              sourceCaseId: row.sourceCaseId,
              status: { not: 'CANCELLED' },
            },
            select: { items: true },
          });
          const all = plans.flatMap((plan) => outboundUnits(plan.items));
          for (const line of latest.items) {
            const allocated = new Set([
              ...line.dispatchedUnitIds,
              ...all
                .filter((unit) => unit.sourceCaseItemId === line.id)
                .map((unit) => unit.unitId),
            ]);
            if (
              allocated.size +
                line.dispatchedQuantity -
                line.dispatchedUnitIds.length >
              line.quantity
            )
              throw new ConflictException(
                '售後數量已變動，請由承辦客服核對已備貨物件',
              );
          }
          Object.assign(changes, {
            sourceVersion: latest.version,
            sourceSnapshot: json(latest),
          });
        } else if (input.action === 'retry_sync') {
          // The original delivery IDs/payloads remain immutable. Never issue another stock transaction or dispatch.
          const eventIds = (
            row.outboundShipment as { eventIds?: unknown } | null
          )?.eventIds;
          if (
            !Array.isArray(eventIds) ||
            eventIds.length !== units.length ||
            new Set(eventIds).size !== units.length ||
            eventIds.some(
              (value) =>
                typeof value !== 'string' || !/^[0-9a-f-]{36}$/i.test(value),
            )
          )
            throw new ConflictException('寄出事件識別不完整，請由承辦人核對');
          await tx.mailroomDelivery.updateMany({
            where: {
              eventId: { in: eventIds as string[] },
              entityId: row.entityId,
              itemId: { in: units.map((unit) => unit.unitId) },
              target: 'AFTER_SALES',
              status: 'PENDING',
              OR: [{ leaseUntil: null }, { leaseUntil: { lte: new Date() } }],
            },
            data: { nextAttemptAt: new Date() },
          });
        }
        const updated = await tx.mailroomOutboundOrder.update({
          where: { id },
          data: changes,
        });
        await tx.mailroomOutboundAction.create({
          data: {
            entityId: row.entityId,
            orderId: row.id,
            actorId: userId,
            requestId: input.requestId,
            requestHash: hash,
            action: input.action,
            fromStatus: row.status,
            toStatus: updated.status,
            version: updated.version,
            snapshot: json({
              items: savedUnits,
              location: updated.location,
              custodianId: updated.custodianId,
              nextUserId: updated.nextUserId,
              outboundShipment: updated.outboundShipment,
            }),
          },
        });
        return { id, duplicate: false, notification };
      },
      { timeout: 20000 },
    );
    if (result.notification) {
      // Persisted handoff must survive a temporary websocket outage.
      try {
        this.gateway.sendToUser(
          result.notification.userId,
          result.notification,
        );
      } catch {
        /* the saved notification remains in the inbox */
      }
    }
    return { id: result.id, duplicate: result.duplicate };
  }
}
