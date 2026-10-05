import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type InventorySerialNumber } from '@prisma/client';
import { AuthService } from '../../auth/auth.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { EntityAccessService } from '../../../common/entity-access/entity-access.service';
import { ConfigService } from '@nestjs/config';
import { fingerprint } from '../../mailroom/mailroom.contract';
import { repairWorkflow } from '../../mailroom/repair-workflow.contract';
import type { ReceiveReturnStockDto } from './after-sales-stock.dto';
import {
  jsonObject,
  validateRefurbishedReturn,
  returnStockUnitId,
} from './after-sales-stock.contract';
import {
  DEPARTMENT_ACCESS_SELECT,
  effectivePermissionKeys,
} from '../../../common/department-access/department-access';

type Inspection = {
  status?: string;
  revision?: number;
  data?: {
    replacementSku?: string;
    replacementCondition?: string;
    plan?: string;
  };
};
@Injectable()
export class AfterSalesStockService {
  constructor(
    private readonly db: PrismaService,
    private readonly auth: AuthService,
    private readonly access: EntityAccessService,
    private readonly config: ConfigService,
  ) {}
  private async authorize(
    userId: string,
    entityId: string,
    write: boolean,
    itemId?: string,
  ) {
    const user = await this.auth.validateUser(userId);
    const admin = user.roles.some((x) =>
      ['SUPER_ADMIN', 'ADMIN'].includes(x.role.code),
    );
    const grants = user.effectivePermissions;
    const inventoryOwner =
      admin ||
      grants.includes('inventory:' + (write ? 'update' : 'read')) ||
      grants.includes('after_sales_stock:' + (write ? 'update' : 'read'));
    const context = await this.access.assertAccess(
      userId,
      inventoryOwner ? 'inventory' : 'sales',
      entityId,
    );
    if (inventoryOwner && (context.isSuperAdmin || context.scope === 'ENTITY'))
      return;
    if (
      !itemId ||
      !grants.includes('repair_workbench:' + (write ? 'update' : 'read'))
    )
      throw new ForbiddenException('需要售後庫存權限');
    const item = await this.db.mailroomItem.findFirst({
      where: {
        id: itemId,
        entityId,
        repairOwnerId: userId,
        custodianId: userId,
      },
    });
    if (!item) throw new ForbiddenException('只可處理本人持有的維修案件');
  }
  private async authorizeTransaction(
    tx: Prisma.TransactionClient,
    userId: string,
    entityId: string,
    itemId?: string,
  ) {
    const user = await tx.user.findUnique({
      where: { id: userId },
      include: {
        roles: {
          include: {
            role: {
              include: { permissions: { include: { permission: true } } },
            },
          },
        },
        employee: { select: DEPARTMENT_ACCESS_SELECT },
        entityMemberships: true,
      },
    });
    if (
      !user?.isActive ||
      user.mustChangePassword ||
      (user.employee && !user.employee.isActive)
    )
      throw new ForbiddenException('人員帳號已停用或需更新密碼');
    const superAdmin = user.roles.some((x) => x.role.code === 'SUPER_ADMIN');
    const admin = superAdmin || user.roles.some((x) => x.role.code === 'ADMIN');
    const company =
      superAdmin ||
      user.employee?.entityId === entityId ||
      user.entityMemberships.some((x) => x.entityId === entityId);
    const grants = effectivePermissionKeys(user);
    if (!company) throw new ForbiddenException('公司權限已變動');
    if (
      (admin ||
        grants.includes('inventory:update') ||
        grants.includes('after_sales_stock:update')) &&
      (superAdmin || user.inventoryDataScope === 'ENTITY')
    )
      return;
    if (
      !itemId ||
      !grants.includes('repair_workbench:update') ||
      !user.employee?.isActive ||
      user.employee.entityId !== entityId
    )
      throw new ForbiddenException('庫存操作權限已變動');
    const item = await tx.mailroomItem.findFirst({
      where: {
        id: itemId,
        entityId,
        repairOwnerId: userId,
        custodianId: userId,
      },
    });
    if (!item)
      throw new ForbiddenException('維修實物已轉交，不能操作其庫存預留');
  }
  async list(userId: string, entityId: string, itemId?: string) {
    await this.authorize(userId, entityId, false, itemId);
    const item = itemId
      ? await this.db.mailroomItem.findFirst({
          where: { id: itemId, entityId },
        })
      : null;
    return this.db.afterSalesStockUnit.findMany({
      where: {
        entityId,
        status: { in: ['QUALIFIED', 'RESERVED'] },
        ...((item?.repairInspection as Inspection | null)?.data
          ?.replacementSku || item?.sku
          ? {
              productId: {
                in: (
                  await this.db.product.findMany({
                    where: {
                      entityId,
                      sku:
                        (item?.repairInspection as Inspection | null)?.data
                          ?.replacementSku || item?.sku,
                    },
                    select: { id: true },
                  })
                ).map((x) => x.id),
              },
            }
          : {}),
      },
      include: {
        reservations: {
          where: { activeKey: { not: null } },
          select: { id: true, itemId: true, expiresAt: true, status: true },
        },
      },
      orderBy: { qualifiedAt: 'asc' },
      take: 200,
    });
  }
  async catalog(userId: string, entityId: string) {
    await this.authorize(userId, entityId, true);
    const [products, warehouses, serials, returnItems] = await Promise.all([
      this.db.product.findMany({
        where: { entityId },
        select: { id: true, sku: true, name: true, hasSerialNumbers: true },
        take: 2000,
        orderBy: { sku: 'asc' },
      }),
      this.db.warehouse.findMany({
        where: { entityId, isActive: true },
        select: { id: true, code: true, name: true },
      }),
      this.db.inventorySerialNumber.findMany({
        where: { entityId, status: 'AVAILABLE' },
        select: {
          id: true,
          productId: true,
          warehouseId: true,
          serialNumber: true,
        },
        take: 2000,
      }),
      this.db.mailroomItem.findMany({
        where: {
          entityId,
          receipt: { category: 'RETURN' },
          status: { in: ['PENDING_RESTOCK', 'PENDING_WELFARE_STOCK'] },
        },
        select: {
          id: true,
          label: true,
          sku: true,
          serialNumber: true,
          grade: true,
          matchResult: true,
          version: true,
          status: true,
          location: true,
          custodianId: true,
          declared: true,
          repairInspection: true,
          repairReport: true,
          repairWorkflow: true,
          receipt: {
            select: { sourceNumber: true, category: true, receivedById: true },
          },
        },
        take: 200,
      }),
    ]);
    return {
      products,
      warehouses,
      serials,
      returnItems: returnItems.map((item) => {
        let refurbishmentEligible = false;
        try {
          validateRefurbishedReturn(item, item.sku || '', item.serialNumber);
          refurbishmentEligible =
            ['MATCH', 'CONFIRMED_ACTUAL'].includes(item.matchResult) &&
            jsonObject(item.declared).quantity === 1;
        } catch {
          /* Display actual eligibility without returning technical or customer documents. */
        }
        return {
          id: item.id,
          label: item.label,
          sku: item.sku,
          serialNumber: item.serialNumber,
          grade: item.grade,
          version: item.version,
          status: item.status,
          location: item.location,
          custodianId: item.custodianId,
          receivedById: item.receipt.receivedById,
          receipt: { sourceNumber: item.receipt.sourceNumber },
          inspectionRevision:
            jsonObject(item.repairInspection).revision ?? null,
          reportRevision: jsonObject(item.repairReport).revision ?? null,
          reportInspectionRevision:
            jsonObject(item.repairReport).inspectionRevision ?? null,
          qcResult:
            jsonObject(jsonObject(item.repairReport).data).qcResult ?? null,
          declaredQuantity: jsonObject(item.declared).quantity ?? null,
          refurbishmentEligible,
        };
      }),
    };
  }
  /** A stock owner personally receives one completed RETURN unit, never a held customer REPAIR unit. */
  async receiveReturn(userId: string, input: ReceiveReturnStockDto) {
    await this.authorize(userId, input.entityId, true);
    if (
      input.quantity !== 1 ||
      input.confirmedItems !== true ||
      ![
        input.unitLabel,
        input.sourceLocation,
        input.location,
        input.ownershipReference,
        input.inspectionReference,
      ].every((x) => typeof x === 'string' && !!x.trim())
    )
      throw new BadRequestException(
        '須逐件點收數量一、確認實物、原位置、目的庫存位置及所有權與檢驗依據',
      );
    const hash = fingerprint(input);
    try {
      return await this.db.$transaction(
        async (tx) => {
          await this.authorizeTransaction(tx, userId, input.entityId);
          await tx.$queryRaw`SELECT id FROM mailroom_items WHERE id=${input.sourceItemId} AND entity_id=${input.entityId} FOR UPDATE`;
          const returned = await tx.mailroomItem.findFirst({
            where: { id: input.sourceItemId, entityId: input.entityId },
            include: { receipt: true },
          });
          if (!returned) throw new NotFoundException('公司來源退貨實物不存在');
          const existing = await tx.afterSalesStockUnit.findUnique({
            where: { sourceItemId: returned.id },
          });
          if (existing) {
            const inbound = jsonObject(
              jsonObject(existing.qualification).inbound,
            );
            if (
              existing.entityId !== input.entityId ||
              inbound.requestId !== input.requestId ||
              inbound.requestHash !== hash ||
              inbound.actorId !== userId
            )
              throw new ConflictException(
                '來源實物已入庫或登錄；同一入庫重試不可變更內容',
              );
            return { unit: existing, inbound, duplicate: true };
          }
          if (
            returned.version !== input.expectedVersion ||
            returned.location !== input.sourceLocation.trim() ||
            !['PENDING_RESTOCK', 'PENDING_WELFARE_STOCK'].includes(
              returned.status,
            )
          )
            throw new ConflictException(
              '退貨實物版本、目前位置或入庫節點已變動',
            );
          if (!['MATCH', 'CONFIRMED_ACTUAL'].includes(returned.matchResult))
            throw new ConflictException('來源退貨尚未完成品項核對');
          const declared = jsonObject(returned.declared);
          if (
            declared.quantity !== 1 ||
            typeof declared.id !== 'string' ||
            !declared.id ||
            !returned.receipt.sourceCaseId
          )
            throw new ConflictException(
              '僅支援來源申報數量一的可辨識實物；多件須先建立逐件身分，不能增加庫存',
            );
          const sourceCaseId = returned.receipt.sourceCaseId;
          const sourceCaseItemId = declared.id;
          // The external one-piece declaration cannot be received again through a second mailroom receipt.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.entityId + ':return-stock:' + sourceCaseId + ':' + sourceCaseItemId}))`;
          const repeated = await tx.$queryRaw<
            { id: string }[]
          >`SELECT u.id FROM after_sales_stock_units u JOIN mailroom_items mi ON mi.id=u.source_item_id JOIN mailroom_receipts mr ON mr.id=mi.receipt_id WHERE u.entity_id=${input.entityId} AND mr.source_case_id=${sourceCaseId} AND mi.declared->>'id'=${sourceCaseItemId} LIMIT 1`;
          if (repeated.length)
            throw new ConflictException('此來源申報實物已由其他收件登錄庫存');
          const clerk = await tx.user.findUnique({
            where: { id: returned.custodianId },
            include: {
              roles: {
                include: {
                  role: {
                    include: { permissions: { include: { permission: true } } },
                  },
                },
              },
              employee: { select: DEPARTMENT_ACCESS_SELECT },
              entityMemberships: true,
            },
          });
          if (
            !clerk?.isActive ||
            clerk.mustChangePassword ||
            (clerk.employee && !clerk.employee.isActive) ||
            !(
              clerk.employee?.entityId === input.entityId ||
              clerk.entityMemberships.some(
                (x) => x.entityId === input.entityId,
              ) ||
              clerk.roles.some((x) => x.role.code === 'SUPER_ADMIN')
            ) ||
            !(
              effectivePermissionKeys(clerk).includes('mailroom:update') ||
              clerk.roles.some((x) =>
                ['ADMIN', 'SUPER_ADMIN'].includes(x.role.code),
              )
            )
          )
            throw new ConflictException(
              '須由同公司目前有效的收發人員先簽收退貨實物',
            );
          await tx.$queryRaw`SELECT id FROM products WHERE id=${input.productId} AND entity_id=${input.entityId} FOR UPDATE`;
          await tx.$queryRaw`SELECT id FROM warehouses WHERE id=${input.warehouseId} AND entity_id=${input.entityId} FOR UPDATE`;
          const product = await tx.product.findFirst({
            where: {
              id: input.productId,
              entityId: input.entityId,
              isActive: true,
            },
          });
          const warehouse = await tx.warehouse.findFirst({
            where: {
              id: input.warehouseId,
              entityId: input.entityId,
              isActive: true,
            },
          });
          if (
            !product ||
            !warehouse ||
            !['SIMPLE', 'MANUFACTURED'].includes(product.type)
          )
            throw new NotFoundException('公司可入庫的實體商品或倉位不存在');
          const sn = input.serialNumber?.trim() || null;
          const revisions = validateRefurbishedReturn(
            returned,
            product.sku,
            sn,
          );
          if (product.hasSerialNumbers && !sn)
            throw new ConflictException('有序號商品須使用來源實物的實際 SN');
          if (
            typeof declared.sku === 'string' &&
            declared.sku &&
            declared.sku !== product.sku
          )
            throw new ConflictException('來源申報 SKU 與已核對實物不一致');
          const previousIn = await tx.inventoryTransaction.findFirst({
            where: {
              entityId: input.entityId,
              direction: 'IN',
              referenceType: 'AFTER_SALES_RETURN',
              referenceId: returned.id,
            },
          });
          if (previousIn)
            throw new ConflictException(
              '來源實物已有正式入庫流水，請核對原紀錄',
            );
          let previousSerial: InventorySerialNumber | null = null;
          if (sn) {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.entityId + ':return-stock-sn:' + sn}))`;
            await tx.$queryRaw`SELECT id FROM inventory_serial_numbers WHERE entity_id=${input.entityId} AND serial_number=${sn} FOR UPDATE`;
            previousSerial = await tx.inventorySerialNumber.findFirst({
              where: { entityId: input.entityId, serialNumber: sn },
            });
            if (previousSerial) {
              if (
                previousSerial.productId !== product.id ||
                !['SOLD', 'RETURNED', 'DEFECTIVE'].includes(
                  previousSerial.status,
                )
              )
                throw new ConflictException(
                  '此 SN 已有可用／預留庫存或屬於其他品項，不可重複入庫',
                );
              if (
                await tx.afterSalesStockUnit.findFirst({
                  where: {
                    inventorySerialId: previousSerial.id,
                    status: { in: ['QUALIFIED', 'RESERVED'] },
                  },
                })
              )
                throw new ConflictException(
                  '此 SN 已有有效合格標籤或預留，不能再入庫',
                );
              if (
                previousSerial.status !== 'SOLD' &&
                previousSerial.warehouseId
              ) {
                const oldBalance = await tx.inventorySnapshot.findUnique({
                  where: {
                    entityId_warehouseId_productId: {
                      entityId: input.entityId,
                      warehouseId: previousSerial.warehouseId,
                      productId: product.id,
                    },
                  },
                });
                if (oldBalance?.qtyOnHand.gt(0))
                  throw new ConflictException(
                    '退回或瑕疵 SN 的原倉位仍有正式存貨，須先核對不可重複增加',
                  );
              }
            }
          }
          const snapshotKey = {
            entityId: input.entityId,
            warehouseId: input.warehouseId,
            productId: input.productId,
          };
          await tx.$queryRaw`SELECT id FROM inventory_snapshots WHERE entity_id=${input.entityId} AND warehouse_id=${input.warehouseId} AND product_id=${input.productId} FOR UPDATE`;
          const current = await tx.inventorySnapshot.findUnique({
            where: { entityId_warehouseId_productId: snapshotKey },
          });
          if (
            current &&
            (current.qtyOnHand.lt(0) ||
              current.qtyAllocated.lt(0) ||
              current.qtyAvailable.lt(0) ||
              !current.qtyAvailable
                .plus(current.qtyAllocated)
                .eq(current.qtyOnHand))
          )
            throw new ConflictException(
              '正式庫存餘額不一致，請先由庫存人員核對',
            );
          const movement = await tx.inventoryTransaction.create({
            data: {
              ...snapshotKey,
              quantity: 1,
              direction: 'IN',
              referenceType: 'AFTER_SALES_RETURN',
              referenceId: returned.id,
              occurredAt: new Date(),
              reason: `合格退貨正式入庫；來源 ${sourceCaseId}/${sourceCaseItemId}；操作 ${userId}；請求 ${input.requestId}`,
            },
          });
          await tx.inventorySnapshot.upsert({
            where: { entityId_warehouseId_productId: snapshotKey },
            create: {
              ...snapshotKey,
              qtyOnHand: 1,
              qtyAvailable: 1,
              qtyAllocated: 0,
            },
            update: {
              qtyOnHand: { increment: 1 },
              qtyAvailable: { increment: 1 },
            },
          });
          const serialData = {
            warehouseId: input.warehouseId,
            status: 'AVAILABLE',
            inboundRefType: 'AFTER_SALES_RETURN',
            inboundRefId: movement.id,
            outboundRefType: null,
            outboundRefId: null,
          };
          if (previousSerial) {
            const revived = await tx.inventorySerialNumber.updateMany({
              where: {
                id: previousSerial.id,
                entityId: input.entityId,
                productId: product.id,
                status: previousSerial.status,
              },
              data: serialData,
            });
            if (revived.count !== 1)
              throw new ConflictException(
                '退貨 SN 狀態已改變，本次入庫交易須整筆回復',
              );
          }
          const serial =
            previousSerial ||
            (sn
              ? await tx.inventorySerialNumber.create({
                  data: {
                    ...snapshotKey,
                    serialNumber: sn,
                    ...serialData,
                  },
                })
              : null);
          const unitId = returnStockUnitId(
            input.entityId,
            sourceCaseId,
            sourceCaseItemId,
          );
          const inbound = {
            unitId,
            inTransactionId: movement.id,
            sourceItemId: returned.id,
            sourceCaseId,
            sourceCaseItemId,
            requestId: input.requestId,
            requestHash: hash,
            actorId: userId,
            quantity: 1,
            sourceItemVersion: returned.version,
            inventoryItemVersion: returned.version + 1,
            fromCustodianId: returned.custodianId,
            toCustodianId: userId,
            fromLocation: returned.location,
            toLocation: input.location.trim(),
            warehouseId: warehouse.id,
            ...revisions,
            receivedAt: new Date().toISOString(),
            externalInventoryPosted: false,
            ...(previousSerial
              ? {
                  previousSerial: {
                    id: previousSerial.id,
                    entityId: previousSerial.entityId,
                    productId: previousSerial.productId,
                    warehouseId: previousSerial.warehouseId,
                    serialNumber: previousSerial.serialNumber,
                    status: previousSerial.status,
                    inboundRefType: previousSerial.inboundRefType,
                    inboundRefId: previousSerial.inboundRefId,
                    outboundRefType: previousSerial.outboundRefType,
                    outboundRefId: previousSerial.outboundRefId,
                  },
                }
              : {}),
            ...(serial
              ? {
                  receivedSerial: {
                    id: serial.id,
                    serialNumber: sn,
                    ...serialData,
                  },
                }
              : {}),
          };
          const unit = await tx.afterSalesStockUnit.create({
            data: {
              id: unitId,
              ...snapshotKey,
              unitLabel: input.unitLabel.trim(),
              serialNumber: sn,
              inventorySerialId: serial?.id,
              kind: 'REFURBISHED',
              sourceItemId: returned.id,
              qualifiedById: userId,
              qualification: {
                sourceReference: movement.id,
                ownershipReference: input.ownershipReference.trim(),
                inspectionReference: input.inspectionReference.trim(),
                sku: product.sku,
                name: product.name,
                hasSerialNumbers: product.hasSerialNumbers,
                externalInventoryPosted: false,
                inbound,
              },
            },
          });
          const updated = await tx.mailroomItem.update({
            where: { id: returned.id },
            data: {
              status: 'STOCKED',
              custodianId: userId,
              location: input.location.trim(),
              nextUserId: null,
              version: { increment: 1 },
              repairWorkflow: {
                ...repairWorkflow(returned.repairWorkflow),
                inventoryReceipt: inbound,
              } as Prisma.InputJsonValue,
            },
            include: { receipt: true },
          });
          const actor = await tx.user.findUniqueOrThrow({
            where: { id: userId },
            select: { name: true },
          });
          await tx.mailroomAction.create({
            data: {
              entityId: input.entityId,
              itemId: returned.id,
              actorId: userId,
              actorName: actor.name,
              requestId: input.requestId,
              requestHash: hash,
              action: 'after_sales_stock_received',
              fromStatus: returned.status,
              toStatus: updated.status,
              version: updated.version,
              note: `退貨單件正式入庫 ${movement.id}`,
              snapshot: JSON.parse(
                JSON.stringify(updated),
              ) as Prisma.InputJsonValue,
            },
          });
          await tx.mailroomTask.updateMany({
            where: {
              itemId: returned.id,
              entityId: input.entityId,
              status: 'OPEN',
            },
            // Physical stock receipt does not resolve customer review or refund work.
            data: { version: updated.version },
          });
          return { unit, inbound, duplicate: false };
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2002', 'P2034'].includes(error.code)
      )
        throw new ConflictException(
          '入庫實物或庫存版本已變動，請以同一入庫內容重試並核對原紀錄',
        );
      throw error;
    }
  }
  async qualify(
    userId: string,
    input: {
      entityId: string;
      productId: string;
      warehouseId: string;
      unitLabel: string;
      serialNumber?: string;
      kind: string;
      sourceItemId?: string;
      sourceReference: string;
      ownershipReference: string;
      inspectionReference: string;
    },
  ) {
    await this.authorize(userId, input.entityId, true);
    if (
      !['NEW', 'REFURBISHED'].includes(input.kind) ||
      !input.unitLabel.trim() ||
      !input.sourceReference.trim() ||
      !input.ownershipReference.trim() ||
      !input.inspectionReference.trim()
    )
      throw new BadRequestException('請填寫入庫、所有權及合格檢驗依據');
    return this.db.$transaction(
      async (tx) => {
        await this.authorizeTransaction(tx, userId, input.entityId);
        const product = await tx.product.findFirst({
          where: { id: input.productId, entityId: input.entityId },
        });
        const warehouse = await tx.warehouse.findFirst({
          where: {
            id: input.warehouseId,
            entityId: input.entityId,
            isActive: true,
          },
        });
        if (!product || !warehouse)
          throw new NotFoundException('公司品項或倉位不存在');
        const stock = await tx.inventorySnapshot.findUnique({
          where: {
            entityId_warehouseId_productId: {
              entityId: input.entityId,
              warehouseId: input.warehouseId,
              productId: input.productId,
            },
          },
        });
        if (!stock || stock.qtyOnHand.lt(1))
          throw new ConflictException(
            '商品尚未正式入庫，不能只用售後紀錄增加可用库存',
          );
        const units = await tx.afterSalesStockUnit.count({
          where: {
            entityId: input.entityId,
            productId: product.id,
            warehouseId: warehouse.id,
            status: { in: ['QUALIFIED', 'RESERVED'] },
          },
        });
        if (stock.qtyOnHand.lte(units))
          throw new ConflictException(
            '本倉位售後標籤數已達正式庫存數量，請先核對實物',
          );
        const serial = input.serialNumber
          ? await tx.inventorySerialNumber.findFirst({
              where: {
                entityId: input.entityId,
                warehouseId: input.warehouseId,
                productId: input.productId,
                serialNumber: input.serialNumber.trim(),
                status: 'AVAILABLE',
              },
            })
          : null;
        if ((product.hasSerialNumbers || input.serialNumber) && !serial)
          throw new ConflictException('替換商品 SN 未在可用庫存中');
        if (
          serial &&
          (await tx.afterSalesStockUnit.findFirst({
            where: {
              inventorySerialId: serial.id,
              status: { in: ['QUALIFIED', 'RESERVED'] },
            },
          }))
        )
          throw new ConflictException('同一 SN 已在售後可用庫存中');
        if (input.kind === 'REFURBISHED') {
          if (!input.sourceItemId)
            throw new BadRequestException('整新品必須追溯來源退貨實物');
          const returned = await tx.mailroomItem.findFirst({
            where: { id: input.sourceItemId, entityId: input.entityId },
            include: { receipt: true },
          });
          validateRefurbishedReturn(
            returned,
            product.sku,
            serial?.serialNumber,
          );
        }
        return tx.afterSalesStockUnit.create({
          data: {
            entityId: input.entityId,
            productId: product.id,
            warehouseId: warehouse.id,
            unitLabel: input.unitLabel.trim(),
            serialNumber: serial?.serialNumber || null,
            inventorySerialId: serial?.id || null,
            kind: input.kind,
            sourceItemId: input.sourceItemId || null,
            qualifiedById: userId,
            qualification: {
              sourceReference: input.sourceReference,
              ownershipReference: input.ownershipReference,
              inspectionReference: input.inspectionReference,
              sku: product.sku,
              name: product.name,
              hasSerialNumbers: product.hasSerialNumbers,
              externalInventoryPosted: false,
            },
          },
        });
      },
      { isolationLevel: 'Serializable' },
    );
  }
  async reserve(
    userId: string,
    input: {
      entityId: string;
      itemId: string;
      unitId: string;
      requestId: string;
      expectedVersion: number;
    },
  ) {
    await this.authorize(userId, input.entityId, true, input.itemId);
    return this.db.$transaction(async (tx) => {
      await this.authorizeTransaction(tx, userId, input.entityId, input.itemId);
      const existing = await tx.afterSalesStockReservation.findUnique({
        where: {
          entityId_requestId: {
            entityId: input.entityId,
            requestId: input.requestId,
          },
        },
      });
      if (existing) {
        if (
          existing.itemId !== input.itemId ||
          existing.unitId !== input.unitId
        )
          throw new ConflictException('重試識別碼不可用於不同預留');
        return existing;
      }
      await tx.$queryRaw`SELECT id FROM mailroom_items WHERE id=${input.itemId} AND entity_id=${input.entityId} FOR UPDATE`;
      const item = await tx.mailroomItem.findFirst({
        where: { id: input.itemId, entityId: input.entityId },
        include: { receipt: true },
      });
      if (
        !item ||
        item.version !== input.expectedVersion ||
        item.receipt.category !== 'REPAIR' ||
        ![
          'REPAIR_RECEIVED',
          'INSPECTING',
          'WAITING_CUSTOMER',
          'REPAIRING',
        ].includes(item.status)
      )
        throw new ConflictException('案件版本或預留節點已變動');
      await tx.$queryRaw`SELECT id FROM after_sales_stock_units WHERE id=${input.unitId} AND entity_id=${input.entityId} FOR UPDATE`;
      const unit = await tx.afterSalesStockUnit.findFirst({
        where: {
          id: input.unitId,
          entityId: input.entityId,
          status: 'QUALIFIED',
        },
      });
      if (!unit) throw new ConflictException('合格商品已被其他案件預留或使用');
      const product = await tx.product.findFirst({
        where: { id: unit.productId, entityId: input.entityId },
      });
      const inspection = item.repairInspection as Inspection | null;
      if (
        inspection?.status !== 'SUBMITTED' ||
        inspection?.data?.plan !== 'REPLACE'
      )
        throw new ConflictException('先提交換機檢修方案再預留替換商品');
      if (
        product?.sku !== inspection.data?.replacementSku ||
        unit.kind !== inspection.data?.replacementCondition
      )
        throw new ConflictException(
          '合格商品與檢修方案的 SKU 或換機級別不一致',
        );
      const snapshot = await tx.inventorySnapshot.updateMany({
        where: {
          entityId: input.entityId,
          productId: unit.productId,
          warehouseId: unit.warehouseId,
          qtyAvailable: { gte: 1 },
        },
        data: {
          qtyAllocated: { increment: 1 },
          qtyAvailable: { decrement: 1 },
        },
      });
      if (snapshot.count !== 1) throw new ConflictException('可用庫存不足');
      if (unit.inventorySerialId) {
        const sn = await tx.inventorySerialNumber.updateMany({
          where: {
            id: unit.inventorySerialId,
            entityId: input.entityId,
            status: 'AVAILABLE',
          },
          data: { status: 'RESERVED' },
        });
        if (sn.count !== 1)
          throw new ConflictException('替換 SN 已被預留或使用');
      }
      const movement = await tx.inventoryTransaction.create({
        data: {
          entityId: input.entityId,
          productId: unit.productId,
          warehouseId: unit.warehouseId,
          quantity: 1,
          direction: 'RESERVE',
          referenceType: 'AFTER_SALES_REPLACEMENT',
          referenceId: input.requestId,
          occurredAt: new Date(),
          reason: '維修換機預留；未正式出庫',
        },
      });
      await tx.afterSalesStockUnit.update({
        where: { id: unit.id },
        data: { status: 'RESERVED' },
      });
      return tx.afterSalesStockReservation.create({
        data: {
          entityId: input.entityId,
          itemId: input.itemId,
          unitId: input.unitId,
          requestId: input.requestId,
          activeKey: input.entityId + ':' + input.itemId,
          actorId: userId,
          reserveTransactionId: movement.id,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });
    });
  }
  async release(userId: string, entityId: string, reservationId: string) {
    const row = await this.db.afterSalesStockReservation.findFirst({
      where: { id: reservationId, entityId },
    });
    if (!row) throw new NotFoundException('預留不存在');
    await this.authorize(userId, entityId, true, row.itemId);
    return this.db.$transaction(async (tx) => {
      await this.authorizeTransaction(tx, userId, entityId, row.itemId);
      await tx.$queryRaw`SELECT id FROM after_sales_stock_reservations WHERE id=${row.id} FOR UPDATE`;
      const current = await tx.afterSalesStockReservation.findUniqueOrThrow({
        where: { id: row.id },
        include: { unit: true },
      });
      if (current.status === 'RELEASED') return current;
      if (current.status !== 'RESERVED')
        throw new ConflictException('已出庫商品不可用取消預留回補庫存');
      const unit = current.unit;
      const change = await tx.inventorySnapshot.updateMany({
        where: {
          entityId,
          productId: unit.productId,
          warehouseId: unit.warehouseId,
          qtyAllocated: { gte: 1 },
        },
        data: {
          qtyAllocated: { decrement: 1 },
          qtyAvailable: { increment: 1 },
        },
      });
      if (change.count !== 1)
        throw new ConflictException('預留餘額不一致，請庫存人員核對');
      const movement = await tx.inventoryTransaction.create({
        data: {
          entityId,
          productId: unit.productId,
          warehouseId: unit.warehouseId,
          quantity: 1,
          direction: 'RELEASE',
          referenceType: 'AFTER_SALES_REPLACEMENT',
          referenceId: current.id,
          occurredAt: new Date(),
          reason: '取消售後換機預留',
        },
      });
      if (unit.inventorySerialId) {
        const released = await tx.inventorySerialNumber.updateMany({
          where: { id: unit.inventorySerialId, entityId, status: 'RESERVED' },
          data: { status: 'AVAILABLE' },
        });
        if (released.count !== 1)
          throw new ConflictException('替換 SN 預留狀態不符，請核對');
      }
      await tx.afterSalesStockUnit.update({
        where: { id: unit.id },
        data: { status: 'QUALIFIED' },
      });
      return tx.afterSalesStockReservation.update({
        where: { id: current.id },
        data: {
          status: 'RELEASED',
          activeKey: null,
          releaseTransactionId: movement.id,
        },
      });
    });
  }
  async proof(
    entityId: string,
    itemId: string,
    replacementSN?: string,
    tx: Prisma.TransactionClient = this.db,
  ) {
    const row = await tx.afterSalesStockReservation.findFirst({
      where: { entityId, itemId, status: { in: ['RESERVED', 'POSTED'] } },
      include: { unit: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!row || (row.unit.serialNumber || '') !== (replacementSN || '').trim())
      throw new ConflictException('尚未預留本案件的替換商品，或 SN 不符');
    return {
      reservationId: row.id,
      status: row.status,
      postingId: row.outTransactionId,
      externalStatus: row.externalStatus,
      replacementSN: row.unit.serialNumber,
      unitLabel: row.unit.unitLabel,
      quantity: 1,
      entityId,
      itemId,
    };
  }
  async consumeForRepair(
    tx: Prisma.TransactionClient,
    entityId: string,
    item: { id: string; sku?: string | null },
    actorId: string,
    requestId: string,
    replacementSN?: string,
    expectedSku?: string,
    expectedCondition?: string,
  ) {
    const proof = await this.proof(entityId, item.id, replacementSN, tx);
    await tx.$queryRaw`SELECT id FROM after_sales_stock_reservations WHERE id=${proof.reservationId} FOR UPDATE`;
    const row = await tx.afterSalesStockReservation.findUniqueOrThrow({
      where: { id: proof.reservationId },
      include: { unit: true },
    });
    const unit = row.unit;
    const product = await tx.product.findFirst({
      where: { id: unit.productId, entityId },
    });
    if (
      !expectedSku ||
      !expectedCondition ||
      product?.sku !== expectedSku ||
      unit.kind !== expectedCondition
    )
      throw new ConflictException(
        '維修單的替換 SKU 或新品／整新品級別與預留不一致',
      );
    if (row.status === 'POSTED') {
      if (
        this.config.get('AFTER_SALES_REQUIRE_EXTERNAL_STOCK') === 'true' &&
        row.externalStatus !== 'CONFIRMED'
      )
        throw new ConflictException('外部正式庫存尚未確認');
      return this.proof(entityId, item.id, replacementSN, tx);
    }
    if (unit.kind === 'REFURBISHED') {
      if (!unit.sourceItemId) throw new ConflictException('整新品來源實物缺失');
      await tx.$queryRaw`SELECT id FROM mailroom_items WHERE id=${unit.sourceItemId} AND entity_id=${entityId} FOR UPDATE`;
      const returned = await tx.mailroomItem.findFirst({
        where: { id: unit.sourceItemId, entityId },
        include: { receipt: true },
      });
      if (returned?.status === 'STOCKED') {
        const inbound = jsonObject(jsonObject(unit.qualification).inbound);
        const physical = jsonObject(
          jsonObject(returned.repairWorkflow).inventoryReceipt,
        );
        if (
          typeof inbound.inTransactionId !== 'string' ||
          inbound.unitId !== unit.id ||
          inbound.sourceItemId !== returned.id ||
          physical.inTransactionId !== inbound.inTransactionId ||
          physical.unitId !== unit.id ||
          inbound.quantity !== 1 ||
          inbound.warehouseId !== unit.warehouseId ||
          physical.toCustodianId !== returned.custodianId ||
          physical.toLocation !== returned.location ||
          inbound.inspectionRevision !==
            jsonObject(returned.repairInspection).revision ||
          inbound.reportRevision !== jsonObject(returned.repairReport).revision
        )
          throw new ConflictException('整新品來源正式入庫與實物交接證明不符');
        const incoming = await tx.inventoryTransaction.findFirst({
          where: {
            id: inbound.inTransactionId,
            entityId,
            productId: unit.productId,
            warehouseId: unit.warehouseId,
            direction: 'IN',
            referenceType: 'AFTER_SALES_RETURN',
            referenceId: returned.id,
          },
        });
        if (!incoming || !incoming.quantity.eq(1))
          throw new ConflictException('整新品正式入庫流水缺失');
      }
      validateRefurbishedReturn(
        returned,
        product?.sku || '',
        unit.serialNumber,
        returned?.status === 'STOCKED',
      );
    }
    if (row.status !== 'RESERVED' || row.expiresAt <= new Date())
      throw new ConflictException('預留已失效，請重新預留');
    const stock = await tx.inventorySnapshot.updateMany({
      where: {
        entityId,
        productId: unit.productId,
        warehouseId: unit.warehouseId,
        qtyOnHand: { gte: 1 },
        qtyAllocated: { gte: 1 },
      },
      data: { qtyOnHand: { decrement: 1 }, qtyAllocated: { decrement: 1 } },
    });
    if (stock.count !== 1)
      throw new ConflictException('正式出庫餘額不足，不能完成換機');
    const data = {
      entityId,
      productId: unit.productId,
      warehouseId: unit.warehouseId,
      quantity: 1,
      referenceType: 'AFTER_SALES_REPLACEMENT',
      referenceId: row.id,
      occurredAt: new Date(),
    };
    const release = await tx.inventoryTransaction.create({
      data: {
        ...data,
        direction: 'RELEASE',
        reason: '換機使用預留；不回補可用量',
      },
    });
    const out = await tx.inventoryTransaction.create({
      data: {
        ...data,
        direction: 'OUT',
        reason: `售後換機 ${item.id}；操作 ${actorId}；請求 ${requestId}`,
      },
    });
    if (unit.inventorySerialId) {
      const sn = await tx.inventorySerialNumber.updateMany({
        where: { id: unit.inventorySerialId, entityId, status: 'RESERVED' },
        data: {
          status: 'SOLD',
          outboundRefType: 'AFTER_SALES_REPLACEMENT',
          outboundRefId: row.id,
        },
      });
      if (sn.count !== 1) throw new ConflictException('替換 SN 庫存狀態不一致');
    }
    await tx.afterSalesStockUnit.update({
      where: { id: unit.id },
      data: { status: 'CONSUMED' },
    });
    await tx.afterSalesStockReservation.update({
      where: { id: row.id },
      data: {
        status: 'POSTED',
        activeKey: null,
        releaseTransactionId: release.id,
        outTransactionId: out.id,
      },
    });
    if (
      this.config.get('AFTER_SALES_REQUIRE_EXTERNAL_STOCK') === 'true' &&
      row.externalStatus !== 'CONFIRMED'
    )
      throw new ConflictException(
        '外部正式庫存尚未確認；本次出庫交易已整筆回復',
      );
    return this.proof(entityId, item.id, replacementSN, tx);
  }
}
