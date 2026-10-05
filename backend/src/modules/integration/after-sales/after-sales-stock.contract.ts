import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { fingerprint } from '../../mailroom/mailroom.contract';
import {
  validateFactoryCompletion,
  validateRepairCompletion,
} from '../../mailroom/repair-document.contract';

export type ReturnedStockItem = Prisma.MailroomItemGetPayload<{
  include: { receipt: true };
}>;
export const jsonObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** Preserve the single-piece key; a multi-piece external line needs each native physical identity. */
export function returnStockUnitId(
  entityId: string,
  sourceCaseId: string,
  sourceCaseItemId: string,
  nativeItemId?: string,
) {
  const hash = fingerprint({
    protocol: nativeItemId
      ? 'corely.aftersales.return-stock.v2'
      : 'corely.aftersales.return-stock.v1',
    entityId,
    sourceCaseId,
    sourceCaseItemId,
    ...(nativeItemId ? { nativeItemId } : {}),
  });
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

/** Shared quality gate: appearance grade is never a refurbishment certificate. */
export function validateRefurbishedReturn(
  returned:
    | (Pick<
        ReturnedStockItem,
        | 'status'
        | 'sku'
        | 'serialNumber'
        | 'repairInspection'
        | 'repairReport'
        | 'repairWorkflow'
      > & { receipt: { category: string } })
    | null,
  sku: string,
  serialNumber?: string | null,
  allowStocked = false,
) {
  const stages = [
    'PENDING_RESTOCK',
    'PENDING_WELFARE_STOCK',
    'READY_FOR_DISPATCH',
  ];
  if (allowStocked) stages.push('STOCKED');
  if (
    !returned ||
    returned.receipt.category !== 'RETURN' ||
    !stages.includes(returned.status)
  )
    throw new ConflictException('退貨品尚未完成合格檢查或整新複驗');
  if (
    returned.sku !== sku ||
    (returned.serialNumber || null) !== (serialNumber || null)
  )
    throw new ConflictException('來源品項或 SN 與入庫商品不一致');
  const inspection = jsonObject(returned.repairInspection);
  const report = jsonObject(returned.repairReport);
  if (
    !Number.isInteger(inspection.revision) ||
    Number(inspection.revision) < 1 ||
    !Number.isInteger(report.revision) ||
    Number(report.revision) < 1
  )
    throw new ConflictException('退貨品檢修及複驗版本缺失');
  try {
    if (jsonObject(report.data).outcome === 'FACTORY_REPAIRED') {
      const factory = jsonObject(jsonObject(returned.repairWorkflow).factory);
      if (
        factory.stage !== 'RETURNED' ||
        factory.physicalCustody !== 'TECHNICIAN' ||
        typeof factory.reference !== 'string'
      )
        throw new ConflictException('原廠實物尚未返還並完成複驗');
      validateFactoryCompletion(inspection, report, factory.reference);
    } else {
      const checked = validateRepairCompletion(inspection, report);
      if (checked.data.outcome !== 'REPAIRED')
        throw new ConflictException('退貨整新不能以換機出庫代替');
    }
  } catch {
    throw new ConflictException('退貨品須有同版已提交檢修、維修紀錄及通過複驗');
  }
  return {
    inspectionRevision: Number(inspection.revision),
    reportRevision: Number(report.revision),
  };
}
