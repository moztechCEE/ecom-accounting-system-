import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

type Amount = Prisma.Decimal;

export type LandedCostItem = {
  id: string;
  productId: string;
  sku: string;
  qty: Amount | string | number;
  unitCostBase: Amount | string | number;
  chargeableWeightKg: Amount | string | number;
};

export type LandedCostPreview = {
  freightCurrency: string;
  ratePerKgOriginal: string;
  fxRateToBase: string;
  totalChargeableWeightKg: string;
  freightOriginal: string;
  freightBase: string;
  goodsBase: string;
  landedTotalBase: string;
  lines: {
    purchaseOrderItemId: string;
    productId: string;
    sku: string;
    qty: string;
    chargeableWeightKg: string;
    goodsBase: string;
    allocatedFreightBase: string;
    landedTotalBase: string;
    landedUnitCostBase: string;
  }[];
};

const decimal = (value: Amount | string | number, name: string) => {
  try {
    const result = new Prisma.Decimal(value);
    if (!result.isFinite()) throw new Error('not finite');
    return result;
  } catch {
    throw new BadRequestException(`${name} must be a finite decimal`);
  }
};

/** Preview only. No inventory value or accounting entry is posted here. */
export function calculateLandedCost(input: {
  items: LandedCostItem[];
  freightCurrency: string;
  ratePerKgOriginal: Amount | string | number;
  fxRateToBase: Amount | string | number;
}): LandedCostPreview {
  if (!input.items.length) throw new BadRequestException('Purchase order has no items');
  const rate = decimal(input.ratePerKgOriginal, 'ratePerKgOriginal');
  const fx = decimal(input.fxRateToBase, 'fxRateToBase');
  if (rate.isNegative() || !fx.isPositive()) {
    throw new BadRequestException('Freight rate must be non-negative and FX rate must be positive');
  }
  const seen = new Set<string>();
  const lines = input.items.map((item) => {
    if (seen.has(item.id)) throw new BadRequestException('Duplicate purchase-order line');
    seen.add(item.id);
    const qty = decimal(item.qty, `quantity for ${item.id}`);
    const unitCost = decimal(item.unitCostBase, `unit cost for ${item.id}`);
    const weight = decimal(item.chargeableWeightKg, `weight for ${item.id}`);
    if (!qty.gt(0) || unitCost.isNegative() || weight.isNegative()) {
      throw new BadRequestException('Quantity must be positive; unit cost and weight cannot be negative');
    }
    return { ...item, qty, unitCost, weight, goods: qty.mul(unitCost) };
  });
  const totalWeight = lines.reduce((total, item) => total.add(item.weight), new Prisma.Decimal(0));
  if (rate.gt(0) && !totalWeight.gt(0)) {
    throw new BadRequestException('Chargeable weight is required for a positive freight rate');
  }
  const goods = lines.reduce((total, item) => total.add(item.goods), new Prisma.Decimal(0));
  const freightOriginal = totalWeight.mul(rate).toDecimalPlaces(2);
  const freightBase = freightOriginal.mul(fx).toDecimalPlaces(2);
  const totalFreightCents = freightBase.mul(100).toNumber();
  if (!Number.isSafeInteger(totalFreightCents)) {
    throw new BadRequestException('Freight amount exceeds supported range');
  }

  // Allocate cents by largest remainder so line totals always match the quoted freight.
  const allocations = lines.map((line, index) => {
    const exact = totalWeight.isZero()
      ? new Prisma.Decimal(0)
      : freightBase.mul(100).mul(line.weight).div(totalWeight);
    const cents = exact.floor().toNumber();
    return { index, cents, remainder: exact.sub(cents) };
  });
  let undistributed = totalFreightCents - allocations.reduce((total, line) => total + line.cents, 0);
  allocations.sort((a, b) => b.remainder.comparedTo(a.remainder) || a.index - b.index);
  for (const allocation of allocations) {
    if (undistributed-- <= 0) break;
    allocation.cents += 1;
  }
  const centsByIndex = new Map(allocations.map((allocation) => [allocation.index, allocation.cents]));
  const resultLines = lines.map((line, index) => {
    const allocatedFreight = new Prisma.Decimal(centsByIndex.get(index) || 0).div(100);
    const landedTotal = line.goods.add(allocatedFreight);
    return {
      purchaseOrderItemId: line.id,
      productId: line.productId,
      sku: line.sku,
      qty: line.qty.toString(),
      chargeableWeightKg: line.weight.toString(),
      goodsBase: line.goods.toFixed(2),
      allocatedFreightBase: allocatedFreight.toFixed(2),
      landedTotalBase: landedTotal.toFixed(2),
      landedUnitCostBase: landedTotal.div(line.qty).toFixed(6),
    };
  });
  return {
    freightCurrency: input.freightCurrency,
    ratePerKgOriginal: rate.toString(),
    fxRateToBase: fx.toString(),
    totalChargeableWeightKg: totalWeight.toString(),
    freightOriginal: freightOriginal.toFixed(2),
    freightBase: freightBase.toFixed(2),
    goodsBase: goods.toFixed(2),
    landedTotalBase: goods.add(freightBase).toFixed(2),
    lines: resultLines,
  };
}
