import { CallHandler, ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';
import {
  containsCostInput,
  redactSensitiveResponse,
  sensitiveReadPermissions,
  SensitiveResponseInterceptor,
} from './sensitive-response.interceptor';
import { ProductController } from './product.controller';
import { ReportsController } from '../reports/reports.controller';
import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';

describe('sensitive response boundary', () => {
  const sample = {
    id: 'order-1',
    totalGrossOriginal: 100,
    items: [{
      product: {
        id: 'sku-1',
        name: 'Product',
        salesPrice: 100,
        purchaseCost: 40,
        movingAverageCost: 45,
        latestPurchasePrice: 42,
        attributes: { supplierPrice: 38 },
      },
    }],
    summary: {
      revenue: 100,
      estimatedCogs: 45,
      grossProfit: 55,
      grossMarginPct: 55,
      operatingExpenses: 15,
      netProfit: 40,
      netMarginPct: 40,
    },
    employee: {
      id: 'employee-1',
      name: 'Employee',
      salaryBaseOriginal: 50000,
      bankInfo: { accountNo: 'secret' },
      compensationSettings: { bonus: 10000 },
    },
  };

  it('removes nested cost, profit, salary and bank data without mutating the source', () => {
    const result = redactSensitiveResponse(sample, sensitiveReadPermissions()) as any;
    expect(result.items[0].product).toEqual({
      id: 'sku-1', name: 'Product', salesPrice: 100, attributes: {},
    });
    expect(result.summary).toEqual({ revenue: 100 });
    expect(result.employee).toEqual({ id: 'employee-1', name: 'Employee' });
    expect(sample.items[0].product.purchaseCost).toBe(40);
  });

  it('keeps only the specifically authorized categories', () => {
    const result = redactSensitiveResponse(sample, sensitiveReadPermissions([
      'product_cost:read', 'financial_margin:read',
    ])) as any;
    expect(result.items[0].product.purchaseCost).toBe(40);
    expect(result.summary.grossProfit).toBe(55);
    expect(result.summary.netProfit).toBeUndefined();
    expect(result.employee.salaryBaseOriginal).toBeUndefined();
  });

  it('does not expose derived cost or net profit through incomplete permission combinations', () => {
    const marginOnly = redactSensitiveResponse(sample, sensitiveReadPermissions(['financial_margin:read'])) as any;
    expect(marginOnly.summary.grossProfit).toBeUndefined();
    const netWithoutCost = redactSensitiveResponse(sample, sensitiveReadPermissions([
      'financial_margin:read', 'financial_net_profit:read',
    ])) as any;
    expect(netWithoutCost.summary.grossProfit).toBeUndefined();
    expect(netWithoutCost.summary.netProfit).toBeUndefined();
    const fullyGranted = redactSensitiveResponse(sample, sensitiveReadPermissions([
      'product_cost:read', 'financial_margin:read', 'financial_net_profit:read',
    ])) as any;
    expect(fullyGranted.summary.netProfit).toBe(40);
  });

  it('keeps revenue and order volume while redacting management and ad expense components', () => {
    const reports = {
      managementSummary: {
        summary: {
          revenue: 1000, orderCount: 10, adSpendAmount: 150,
          gatewayFee: 18, platformFee: 12, feeTotal: 30,
          payoutGross: 1000, payoutNet: 970, netProfit: 420,
        },
        periods: [{ revenue: 1000, orderCount: 10, adSpendAmount: 150, gatewayFee: 18, platformFee: 12, payoutNet: 970 }],
      },
      adPerformanceSummary: {
        summary: { revenue: 1000, orderCount: 10, adSpend: 150, roas: 6.6667 },
        brands: [{ name: 'A', revenue: 1000, orderCount: 10, adSpend: 150, adSpendShare: 100, roas: 6.6667 }],
        sources: [{ name: 'Meta Ads', adSpend: 100 }],
      },
    };
    for (const keys of [[], ['product_cost:read', 'financial_margin:read']]) {
      const result = redactSensitiveResponse(reports, sensitiveReadPermissions(keys)) as any;
      expect(result.managementSummary.summary).toEqual({ revenue: 1000, orderCount: 10, payoutGross: 1000 });
      expect(result.managementSummary.periods[0]).toEqual({ revenue: 1000, orderCount: 10 });
      expect(result.adPerformanceSummary.summary).toEqual({ revenue: 1000, orderCount: 10 });
      expect(result.adPerformanceSummary.brands[0]).toEqual({ name: 'A', revenue: 1000, orderCount: 10 });
      expect(result.adPerformanceSummary.sources[0]).toEqual({ name: 'Meta Ads' });
    }
    const full = redactSensitiveResponse(reports, sensitiveReadPermissions([
      'product_cost:read', 'financial_margin:read', 'financial_net_profit:read',
    ])) as any;
    expect(full.managementSummary.summary.payoutNet).toBe(970);
    expect(full.adPerformanceSummary.summary.adSpend).toBe(150);
    expect(full.adPerformanceSummary.summary.roas).toBe(6.6667);
  });

  it('uses the authenticated effective permissions, never request query flags', async () => {
    const interceptor = new SensitiveResponseInterceptor();
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          user: { id: 'manager', effectivePermissions: ['sales_orders:read'] },
          url: '/api/v1/sales/orders?product_cost=read',
        }),
      }),
    } as ExecutionContext;
    const next = { handle: () => of(sample) } as CallHandler;
    const result = await firstValueFrom(interceptor.intercept(context, next)) as any;
    expect(result.items[0].product.purchaseCost).toBeUndefined();
    expect(result.summary.netProfit).toBeUndefined();
  });

  it('redacts purchase amounts and WMS posting costs and disables report caching', async () => {
    const setHeader = jest.fn();
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ user: { id: 'manager', effectivePermissions: ['purchase_orders:read'] }, url: '/reports/management-summary' }),
        getResponse: () => ({ setHeader }),
      }),
    } as ExecutionContext;
    const next = { handle: () => of({
      purchase: { totalAmountBase: '200', subtotal: '200', items: [{ unitCostBase: '50', quantity: 4 }] },
      posting: { totalCostBase: '200' },
      revenue: 500,
    }) } as CallHandler;
    const result = await firstValueFrom(new SensitiveResponseInterceptor(true, true).intercept(context, next)) as any;
    expect(result).toEqual({ purchase: { items: [{ quantity: 4 }] }, posting: {}, revenue: 500 });
    expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
  });

  it('treats zero and nested cost input as protected writes', () => {
    expect(containsCostInput({ purchaseCost: 0 })).toBe(true);
    expect(containsCostInput({ attributes: { supplierPrice: 0 } })).toBe(true);
    expect(containsCostInput({ attributes: { 採購成本: '40' } })).toBe(true);
    expect(containsCostInput({ salesPrice: 100, attributes: { color: 'blue' } })).toBe(false);
  });

  it('redacts localized custom attribute labels that contain sensitive values', () => {
    const attributes = { 採購成本: '40', 毛利率: '60%', 淨利: '20', 薪資: '50000', 顏色: '藍色' };
    const result = redactSensitiveResponse({ attributes }, sensitiveReadPermissions()) as any;
    expect(result.attributes).toEqual({ 顏色: '藍色' });
  });

  it('blocks product cost writes before the service call without the update grant', async () => {
    const service = { create: jest.fn(), update: jest.fn() };
    const access = { getContext: jest.fn().mockResolvedValue({ entityId: 'entity-a', noAccess: false }) };
    const controller = new ProductController(service as any, access as any);
    const user = { user: { id: 'manager', effectivePermissions: ['inventory:update'] } };
    await expect(controller.create(user, { sku: 'A', name: 'A', barcode: '12345678', purchaseCost: 0 }))
      .rejects.toThrow('product_cost:update');
    await expect(controller.update(user, 'product-a', { attributes: { supplierPrice: 50 } }))
      .rejects.toThrow('product_cost:update');
    expect(service.create).not.toHaveBeenCalled();
    expect(service.update).not.toHaveBeenCalled();

    user.user.effectivePermissions.push('product_cost:update');
    await controller.create(user, { sku: 'A', name: 'A', barcode: '12345678', purchaseCost: 0 });
    expect(service.create).toHaveBeenCalledWith('entity-a', expect.objectContaining({ purchaseCost: 0 }));
  });

  it('requires all dependent read grants on formal finance endpoints', () => {
    for (const method of [
      ReportsController.prototype.getAIAnalysis,
      ReportsController.prototype.getIncomeStatement,
      ReportsController.prototype.getBalanceSheet,
      ReportsController.prototype.getCashFlow,
      ReportsController.prototype.getDashboardExecutiveOverview,
      ReportsController.prototype.getMonthlyChannelReconciliation,
      ReportsController.prototype.getOrderReconciliationAudit,
    ]) {
      expect(Reflect.getMetadata(PERMISSIONS_KEY, method)).toEqual([
        'reports:read', 'product_cost:read', 'financial_margin:read', 'financial_net_profit:read',
      ]);
    }
  });
});
