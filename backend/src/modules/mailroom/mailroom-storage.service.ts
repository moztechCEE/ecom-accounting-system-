import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  MailroomStorageLocation,
  MailroomStorageRack,
  Prisma,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  Actor,
  can,
  fingerprint,
  requireEntity,
  requirePermission,
} from './mailroom.contract';
import { MailroomService } from './mailroom.service';
import { physicalCustody } from './repair-workflow.contract';
import {
  CreateStorageLocationDto,
  CreateStorageRackDto,
  MoveStorageItemDto,
  StorageQueryDto,
  StorageRequestDto,
  UpdateStorageLocationDto,
  UpdateStorageRackDto,
} from './mailroom-storage.dto';

const withReceipt = { receipt: true } as const;
type StorageItem = Prisma.MailroomItemGetPayload<{
  include: typeof withReceipt;
}>;
type CommandLog = Record<
  string,
  { hash: string; response: Record<string, unknown> }
>;
const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const commandKey = (actor: string, requestId: string) =>
  actor + ':' + requestId;
const roomStatuses = new Set([
  'RECEIVED',
  'MISMATCH',
  'WAITING_PICKUP',
  'WAITING_REPAIR_ACCEPTANCE',
  'REPAIR_RECEIVED',
  'INSPECTING',
  'WAITING_CUSTOMER',
  'REPAIRING',
  'WAITING_RETURN_ACCEPTANCE',
  'READY_FOR_DISPATCH',
  'PENDING_RESTOCK',
  'PENDING_DISPOSITION',
  'PENDING_REFURBISH',
  'REFURBISHING',
  'PENDING_WELFARE_STOCK',
]);

/** A saved historical shelf reference does not prove that goods remain there. */
export function occupiesMailroomStorage(item: StorageItem): boolean {
  if (!roomStatuses.has(item.status)) return false;
  try {
    return physicalCustody(item) === 'MAILROOM';
  } catch {
    return false;
  } // Unknown legacy custody must not become a claimed shelf occupant.
}
const rackView = (rack: MailroomStorageRack) => ({
  id: rack.id,
  code: rack.code,
  name: rack.name,
  zone: rack.zone,
  rows: rack.rows,
  columns: rack.columns,
  layoutX: rack.layoutX,
  layoutY: rack.layoutY,
  version: rack.version,
  isActive: rack.isActive,
});
const locationView = (location: MailroomStorageLocation) => ({
  id: location.id,
  code: location.code,
  name: location.name,
  rackId: location.rackId,
  level: location.level,
  slot: location.slot,
  version: location.version,
  isActive: location.isActive,
});
const itemView = (item: StorageItem, custodianName: string) => ({
  id: item.id,
  productName: item.productName,
  sku: item.sku,
  serialNumber: item.serialNumber,
  receiptId: item.receiptId,
  receiptNumber: item.receipt.number,
  sourceNumber: item.receipt.sourceNumber,
  category: item.receipt.category,
  status: item.status,
  location: item.location,
  storageLocationId: item.storageLocationId,
  custodianId: item.custodianId,
  custodianName,
  version: item.version,
});

@Injectable()
export class MailroomStorageService {
  constructor(
    private readonly db: PrismaService,
    private readonly mailroom: MailroomService,
  ) {}

  private async authorize(
    userId: string,
    entityId: string,
    write = false,
    tx?: Prisma.TransactionClient,
  ) {
    this.mailroom.enabled();
    const actor = await this.mailroom.actor(userId, tx);
    requireEntity(actor, entityId);
    requirePermission(actor, write ? 'mailroom:update' : 'mailroom:read');
    return actor;
  }
  private validateRequest(input: StorageRequestDto) {
    if (
      !input.entityId?.trim() ||
      !/^[A-Za-z0-9_-]{8,80}$/.test(input.requestId)
    )
      throw new BadRequestException('儲位操作資料格式錯誤');
  }
  private name(value: string) {
    if (typeof value !== 'string' || !value.trim() || value.length > 80)
      throw new BadRequestException('請填寫名稱');
    return value.trim();
  }
  private code(value: string, max: number) {
    if (
      typeof value !== 'string' ||
      !new RegExp('^[A-Za-z0-9][A-Za-z0-9_-]{0,' + (max - 1) + '}$').test(value)
    )
      throw new BadRequestException('儲位編碼限英數字、底線或短橫線');
    return value.toUpperCase();
  }
  private dimension(value: number) {
    if (!Number.isInteger(value) || value < 1 || value > 8)
      throw new BadRequestException('貨架層數與格數限 1～8');
    return value;
  }
  private coordinate(value: number) {
    if (!Number.isInteger(value) || Math.abs(value) > 10000)
      throw new BadRequestException('貨架位置格式錯誤');
    return value;
  }
  private zone(value: string) {
    if (!['RECEIVING', 'OUTBOUND'].includes(value))
      throw new BadRequestException('請選擇收件區或待寄區');
    return value;
  }
  private version(expected: number, actual: number) {
    if (!Number.isInteger(expected) || expected < 1 || expected !== actual)
      throw new ConflictException('資料已更新，請重新整理');
  }
  private active(value: unknown) {
    if (typeof value !== 'boolean')
      throw new BadRequestException('啟用狀態格式錯誤');
    return value;
  }
  private async lockRequest(
    tx: Prisma.TransactionClient,
    userId: string,
    input: StorageRequestDto,
  ) {
    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${input.entityId + ':mailroom-storage:' + userId + ':' + input.requestId}))`,
    );
  }
  private async replay(
    tx: Prisma.TransactionClient,
    userId: string,
    input: StorageRequestDto,
    hash: string,
  ) {
    const key = commandKey(userId, input.requestId);
    const [rack, location, action] = await Promise.all([
      tx.mailroomStorageRack.findFirst({
        where: { entityId: input.entityId, commandKeys: { has: key } },
      }),
      tx.mailroomStorageLocation.findFirst({
        where: { entityId: input.entityId, commandKeys: { has: key } },
      }),
      tx.mailroomAction.findUnique({
        where: {
          entityId_actorId_requestId: {
            entityId: input.entityId,
            actorId: userId,
            requestId: input.requestId,
          },
        },
      }),
    ]);
    if (action) throw new ConflictException('同一操作識別碼已用於其他操作');
    const row = rack || location;
    if (!row) return null;
    const entry = (row.commands as unknown as CommandLog)[key];
    if (!entry || entry.hash !== hash)
      throw new ConflictException('同一操作識別碼的內容不同');
    return { ...entry.response, duplicate: true };
  }
  private log(
    row: { commands: Prisma.JsonValue; commandKeys: string[] },
    key: string,
    hash: string,
    response: Record<string, unknown>,
  ) {
    return {
      commandKeys: [...row.commandKeys, key],
      commands: json({
        ...(row.commands as unknown as CommandLog),
        [key]: { hash, response },
      }),
    };
  }
  private async mutate<T>(
    userId: string,
    input: StorageRequestDto,
    fn: (tx: Prisma.TransactionClient, actor: Actor) => Promise<T>,
  ) {
    this.validateRequest(input);
    await this.authorize(userId, input.entityId, true);
    try {
      return await this.db.$transaction(async (tx) => {
        await this.lockRequest(tx, userId, input);
        const actor = await this.authorize(userId, input.entityId, true, tx);
        return fn(tx, actor);
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new ConflictException('儲位編碼或貨架格位已存在');
      throw error;
    }
  }
  private async rack(
    tx: Prisma.TransactionClient,
    entityId: string,
    id: string,
  ) {
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM mailroom_storage_racks WHERE id=${id} AND entity_id=${entityId} FOR UPDATE`,
    );
    const rack = await tx.mailroomStorageRack.findFirst({
      where: { id, entityId },
    });
    if (!rack) throw new NotFoundException('找不到此公司的貨架');
    return rack;
  }
  private async occupants(
    tx: Prisma.TransactionClient,
    entityId: string,
    ids: string[],
  ) {
    if (!ids.length) return [];
    const items = await tx.mailroomItem.findMany({
      where: { entityId, storageLocationId: { in: ids } },
      include: withReceipt,
    });
    return items.filter(occupiesMailroomStorage);
  }

  async list(userId: string, query: StorageQueryDto) {
    const actor = await this.authorize(userId, query.entityId);
    const [racks, locations, items] = await Promise.all([
      this.db.mailroomStorageRack.findMany({
        where: { entityId: query.entityId },
        orderBy: [{ zone: 'asc' }, { code: 'asc' }],
      }),
      this.db.mailroomStorageLocation.findMany({
        where: { entityId: query.entityId },
        orderBy: [{ level: 'asc' }, { slot: 'asc' }, { code: 'asc' }],
      }),
      this.db.mailroomItem.findMany({
        where: { entityId: query.entityId },
        include: withReceipt,
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    const current = items.filter(occupiesMailroomStorage);
    const names = new Map(
      (
        await this.db.user.findMany({
          where: {
            id: { in: [...new Set(current.map((item) => item.custodianId))] },
          },
          select: { id: true, name: true },
        })
      ).map((user) => [user.id, user.name || '員工']),
    );
    const locationById = new Map(
      locations.map((location) => [location.id, location]),
    );
    const term = query.search?.trim().toLocaleLowerCase() || '';
    const visible = current.filter(
      (item) =>
        !term ||
        [
          item.productName,
          item.sku,
          item.serialNumber,
          item.receipt.number,
          item.receipt.sourceNumber,
          item.location,
          locationById.get(item.storageLocationId || '')?.name,
          locationById.get(item.storageLocationId || '')?.code,
        ].some((text) => text?.toLocaleLowerCase().includes(term)),
    );
    const short = (item: StorageItem) => ({
      ...itemView(item, names.get(item.custodianId) || '未綁定'),
      canMove: can(actor, 'mailroom:update') && item.custodianId === actor.id,
    });
    return {
      racks: racks.map(rackView),
      locations: locations.map((location) => ({
        ...locationView(location),
        items: visible
          .filter((item) => item.storageLocationId === location.id)
          .map(short),
      })),
      unassigned: visible
        .filter(
          (item) =>
            !item.storageLocationId ||
            !locationById.has(item.storageLocationId),
        )
        .map(short),
      counts: {
        stored: current.filter(
          (item) =>
            !!item.storageLocationId &&
            locationById.has(item.storageLocationId),
        ).length,
        unassigned: current.filter(
          (item) =>
            !item.storageLocationId ||
            !locationById.has(item.storageLocationId),
        ).length,
      },
      canManage: can(actor, 'mailroom:update'),
    };
  }
  async createRack(userId: string, input: CreateStorageRackDto) {
    const code = this.code(input.code, 16),
      name = this.name(input.name);
    const rows = this.dimension(input.rows),
      columns = this.dimension(input.columns);
    const zone = this.zone(input.zone),
      layoutX = this.coordinate(input.layoutX ?? 0),
      layoutY = this.coordinate(input.layoutY ?? 0);
    const hash = fingerprint({ operation: 'create_rack', ...input });
    return this.mutate(userId, input, async (tx) => {
      const previous = await this.replay(tx, userId, input, hash);
      if (previous) return previous;
      const rack = await tx.mailroomStorageRack.create({
        data: {
          id: randomUUID(),
          entityId: input.entityId,
          code,
          name,
          zone,
          rows,
          columns,
          layoutX,
          layoutY,
        },
      });
      const locations: ReturnType<typeof locationView>[] = [];
      for (let level = 1; level <= rows; level++) {
        for (let slot = 1; slot <= columns; slot++) {
          const locationCode = code + ((level - 1) * columns + slot);
          const location = await tx.mailroomStorageLocation.create({
            data: {
              id: randomUUID(),
              entityId: input.entityId,
              rackId: rack.id,
              code: locationCode,
              name: locationCode,
              level,
              slot,
            },
          });
          locations.push(locationView(location));
        }
      }
      const response = { rack: rackView(rack), locations, duplicate: false };
      await tx.mailroomStorageRack.update({
        where: { id: rack.id },
        data: this.log(
          rack,
          commandKey(userId, input.requestId),
          hash,
          response,
        ),
      });
      return response;
    });
  }
  async updateRack(userId: string, id: string, input: UpdateStorageRackDto) {
    const hash = fingerprint({ operation: 'update_rack', id, ...input });
    return this.mutate(userId, input, async (tx) => {
      const previous = await this.replay(tx, userId, input, hash);
      if (previous) return previous;
      const rack = await this.rack(tx, input.entityId, id);
      await this.authorize(userId, input.entityId, true, tx);
      this.version(input.expectedVersion, rack.version);
      const locations = await tx.mailroomStorageLocation.findMany({
        where: { entityId: input.entityId, rackId: id },
      });
      const rows = this.dimension(input.rows ?? rack.rows),
        columns = this.dimension(input.columns ?? rack.columns);
      if (
        locations.some(
          (location) => location.level > rows || location.slot > columns,
        )
      )
        throw new ConflictException('縮小貨架會移除現有儲位');
      if (
        input.isActive === false &&
        (
          await this.occupants(
            tx,
            input.entityId,
            locations.map((location) => location.id),
          )
        ).length
      )
        throw new ConflictException('貨架仍有物品，請先移位或完成交接');
      const updated = {
        ...rack,
        name: input.name === undefined ? rack.name : this.name(input.name),
        zone: this.zone(input.zone ?? rack.zone),
        rows,
        columns,
        layoutX: this.coordinate(input.layoutX ?? rack.layoutX),
        layoutY: this.coordinate(input.layoutY ?? rack.layoutY),
        isActive:
          input.isActive === undefined
            ? rack.isActive
            : this.active(input.isActive),
        version: rack.version + 1,
      };
      const response = { rack: rackView(updated), duplicate: false };
      await tx.mailroomStorageRack.update({
        where: { id },
        data: {
          name: updated.name,
          zone: updated.zone,
          rows,
          columns,
          layoutX: updated.layoutX,
          layoutY: updated.layoutY,
          isActive: updated.isActive,
          version: updated.version,
          ...this.log(
            rack,
            commandKey(userId, input.requestId),
            hash,
            response,
          ),
        },
      });
      return response;
    });
  }
  async createLocation(userId: string, input: CreateStorageLocationDto) {
    const code = this.code(input.code, 24),
      name = this.name(input.name),
      level = this.dimension(input.level),
      slot = this.dimension(input.slot);
    const hash = fingerprint({ operation: 'create_location', ...input });
    return this.mutate(userId, input, async (tx) => {
      const previous = await this.replay(tx, userId, input, hash);
      if (previous) return previous;
      const rack = await this.rack(tx, input.entityId, input.rackId);
      await this.authorize(userId, input.entityId, true, tx);
      if (!rack.isActive) throw new ConflictException('貨架已停用');
      if (level > rack.rows || slot > rack.columns)
        throw new BadRequestException('請先擴充貨架層數或格數');
      const location = await tx.mailroomStorageLocation.create({
        data: {
          id: randomUUID(),
          entityId: input.entityId,
          rackId: rack.id,
          code,
          name,
          level,
          slot,
        },
      });
      const response = { location: locationView(location), duplicate: false };
      await tx.mailroomStorageLocation.update({
        where: { id: location.id },
        data: this.log(
          location,
          commandKey(userId, input.requestId),
          hash,
          response,
        ),
      });
      return response;
    });
  }
  async updateLocation(
    userId: string,
    id: string,
    input: UpdateStorageLocationDto,
  ) {
    const hash = fingerprint({ operation: 'update_location', id, ...input });
    return this.mutate(userId, input, async (tx) => {
      const previous = await this.replay(tx, userId, input, hash);
      if (previous) return previous;
      const existing = await tx.mailroomStorageLocation.findFirst({
        where: { id, entityId: input.entityId },
      });
      if (!existing) throw new NotFoundException('找不到此公司的儲位');
      const rack = await this.rack(tx, input.entityId, existing.rackId);
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM mailroom_storage_locations WHERE id=${id} AND entity_id=${input.entityId} FOR UPDATE`,
      );
      const location = await tx.mailroomStorageLocation.findFirstOrThrow({
        where: { id, entityId: input.entityId },
      });
      await this.authorize(userId, input.entityId, true, tx);
      this.version(input.expectedVersion, location.version);
      const isActive =
        input.isActive === undefined
          ? location.isActive
          : this.active(input.isActive);
      if (isActive && !rack.isActive)
        throw new ConflictException('請先啟用貨架');
      if (!isActive && (await this.occupants(tx, input.entityId, [id])).length)
        throw new ConflictException('儲位仍有物品，請先移位或完成交接');
      const updated = {
        ...location,
        name: input.name === undefined ? location.name : this.name(input.name),
        isActive,
        version: location.version + 1,
      };
      const response = { location: locationView(updated), duplicate: false };
      await tx.mailroomStorageLocation.update({
        where: { id },
        data: {
          name: updated.name,
          isActive,
          version: updated.version,
          ...this.log(
            location,
            commandKey(userId, input.requestId),
            hash,
            response,
          ),
        },
      });
      return response;
    });
  }
  async move(userId: string, id: string, input: MoveStorageItemDto) {
    if (input.storageLocationId === undefined)
      throw new BadRequestException('請指定儲位或選擇不指定儲位');
    const hash = fingerprint({ operation: 'move_storage', id, ...input });
    return this.mutate(userId, input, async (tx) => {
      const key = {
        entityId: input.entityId,
        actorId: userId,
        requestId: input.requestId,
      };
      // A move request cannot reuse a rack/location mutation key.
      const [rackCommand, locationCommand] = await Promise.all([
        tx.mailroomStorageRack.findFirst({
          where: {
            entityId: input.entityId,
            commandKeys: { has: commandKey(userId, input.requestId) },
          },
        }),
        tx.mailroomStorageLocation.findFirst({
          where: {
            entityId: input.entityId,
            commandKeys: { has: commandKey(userId, input.requestId) },
          },
        }),
      ]);
      if (rackCommand || locationCommand)
        throw new ConflictException('同一操作識別碼已用於其他操作');
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM mailroom_items WHERE id=${id} AND entity_id=${input.entityId} FOR UPDATE`,
      );
      const item = await tx.mailroomItem.findFirst({
        where: { id, entityId: input.entityId },
        include: withReceipt,
      });
      if (!item) throw new NotFoundException('找不到此公司的收件物品');
      const freshActor = await this.authorize(userId, input.entityId, true, tx);
      if (item.custodianId !== userId || !occupiesMailroomStorage(item))
        throw new ForbiddenException('只有目前保管此物品的收發人員可移位');
      const previous = await tx.mailroomAction.findUnique({
        where: { entityId_actorId_requestId: key },
      });
      if (previous) {
        if (
          previous.action !== 'move_storage' ||
          previous.itemId !== id ||
          previous.requestHash !== hash
        )
          throw new ConflictException('同一操作識別碼的內容不同');
        return { item: previous.snapshot, duplicate: true };
      }
      this.version(input.expectedVersion, item.version);
      let location = input.location?.trim() || '';
      if (input.storageLocationId !== null) {
        const target = await tx.mailroomStorageLocation.findFirst({
          where: { id: input.storageLocationId, entityId: input.entityId },
        });
        if (!target) throw new NotFoundException('找不到此公司的儲位');
        const rack = await this.rack(tx, input.entityId, target.rackId);
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM mailroom_storage_locations WHERE id=${target.id} AND entity_id=${input.entityId} FOR UPDATE`,
        );
        const current = await tx.mailroomStorageLocation.findFirstOrThrow({
          where: { id: target.id, entityId: input.entityId },
        });
        await this.authorize(userId, input.entityId, true, tx);
        if (!rack.isActive || !current.isActive)
          throw new ConflictException('儲位或貨架已停用');
        location = current.code;
      }
      if (!location || location.length > 160)
        throw new BadRequestException('請填寫收件存放位置');
      const updated = await tx.mailroomItem.update({
        where: { id },
        data: {
          storageLocationId: input.storageLocationId,
          location,
          version: item.version + 1,
        },
        include: withReceipt,
      });
      const snapshot = { ...itemView(updated, freshActor.name), canMove: true };
      await tx.mailroomAction.create({
        data: {
          entityId: input.entityId,
          itemId: id,
          actorId: userId,
          actorName: freshActor.name,
          requestId: input.requestId,
          requestHash: hash,
          action: 'move_storage',
          fromStatus: item.status,
          toStatus: item.status,
          version: updated.version,
          snapshot: json(snapshot),
        },
      });
      return { item: snapshot, duplicate: false };
    });
  }
}
