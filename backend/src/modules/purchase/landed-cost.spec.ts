import { calculateLandedCost } from './landed-cost';

describe('calculateLandedCost', () => {
  it('allocates converted freight to purchase lines and preserves every cent', () => {
    const result = calculateLandedCost({
      freightCurrency: 'CNY',
      ratePerKgOriginal: '10',
      fxRateToBase: '4.123',
      items: [
        { id: 'line-1', productId: 'p1', sku: 'P1', qty: '2', unitCostBase: '100', chargeableWeightKg: '0.5' },
        { id: 'line-2', productId: 'p2', sku: 'P2', qty: '1', unitCostBase: '50', chargeableWeightKg: '1' },
      ],
    });
    expect(result).toMatchObject({
      freightOriginal: '15.00', freightBase: '61.85', goodsBase: '250.00', landedTotalBase: '311.85',
      lines: [
        { allocatedFreightBase: '20.62', landedTotalBase: '220.62', landedUnitCostBase: '110.310000' },
        { allocatedFreightBase: '41.23', landedTotalBase: '91.23', landedUnitCostBase: '91.230000' },
      ],
    });
  });

  it('distributes a one-cent remainder to the heaviest line', () => {
    const result = calculateLandedCost({
      freightCurrency: 'TWD', ratePerKgOriginal: '0.01', fxRateToBase: '1',
      items: [
        { id: 'a', productId: 'a', sku: 'A', qty: 1, unitCostBase: 0, chargeableWeightKg: '0.333' },
        { id: 'b', productId: 'b', sku: 'B', qty: 1, unitCostBase: 0, chargeableWeightKg: '0.333' },
        { id: 'c', productId: 'c', sku: 'C', qty: 1, unitCostBase: 0, chargeableWeightKg: '0.334' },
      ],
    });
    expect(result.lines.map((line) => line.allocatedFreightBase)).toEqual(['0.00', '0.00', '0.01']);
    expect(result.freightBase).toBe('0.01');
  });

  it('rejects a positive rate without weight and duplicate lines', () => {
    expect(() => calculateLandedCost({
      freightCurrency: 'TWD', ratePerKgOriginal: 1, fxRateToBase: 1,
      items: [{ id: 'a', productId: 'a', sku: 'A', qty: 1, unitCostBase: 1, chargeableWeightKg: 0 }],
    })).toThrow('Chargeable weight');
    expect(() => calculateLandedCost({
      freightCurrency: 'TWD', ratePerKgOriginal: 0, fxRateToBase: 1,
      items: [
        { id: 'a', productId: 'a', sku: 'A', qty: 1, unitCostBase: 1, chargeableWeightKg: 0 },
        { id: 'a', productId: 'a', sku: 'A', qty: 1, unitCostBase: 1, chargeableWeightKg: 0 },
      ],
    })).toThrow('Duplicate');
  });
});
