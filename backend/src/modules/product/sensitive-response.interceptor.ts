import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';

export interface SensitiveReadPermissions {
  productCost: boolean;
  financialMargin: boolean;
  financialNetProfit: boolean;
  employeeCompensation: boolean;
}

const COST_FIELDS = new Set([
  'purchasecost',
  'movingaveragecost',
  'latestpurchaseprice',
  'landedcost',
  'unitcost',
  'estimatedunitcost',
  'estimatedcost',
  'estimatedcogs',
  'cogs',
  'costofgoodssold',
  'costofsales',
  'costamount',
  'totalcost',
  'costbasis',
  'purchaseprice',
  'supplierprice',
]);

const MARGIN_FIELDS = new Set([
  'grossprofit',
  'grossmargin',
  'grossmarginpct',
  'grossprofitrate',
  'contributionmargin',
]);

const NET_PROFIT_FIELDS = new Set([
  'netprofit',
  'netmargin',
  'netmarginpct',
  'netprofitrate',
  'operatingprofit',
  'profitaftertax',
  'ebitda',
  'actualexpenseamount',
  'fallbackexpenseamount',
  'operatingexpenses',
  'expensetotal',
  'feetotal',
  'gatewayfee',
  'platformfee',
  'payoutnet',
  'paymentnet',
  'roas',
  'journalapproval',
]);

const COMPENSATION_FIELDS = new Set([
  'bankinfo',
  'compensationsettings',
  'bonus',
  'salaryadvance',
  'payrollitems',
  'payrollruns',
]);

function isSensitiveField(key: string, permissions: SensitiveReadPermissions): boolean {
  const normalized = key.replace(/[_-]/g, '').toLowerCase();
  if (!permissions.productCost && (COST_FIELDS.has(normalized) || (normalized.includes('cost') && !normalized.startsWith('costcenter')) || /(?:purchase|supplier)price/.test(normalized) || /成本|採購價|采购价|進價|进价|進貨價|进货价|供應商價|供应商价/.test(key))) {
    return true;
  }
  if (!permissions.financialMargin && (MARGIN_FIELDS.has(normalized) || normalized.includes('margin') || /grossprofit/.test(normalized) || /毛利/.test(key))) {
    return true;
  }
  if (!permissions.financialNetProfit && (
    NET_PROFIT_FIELDS.has(normalized) ||
    /(?:net|operating)profit/.test(normalized) ||
    normalized.includes('adspend') ||
    /(?:payout|payment).*net|net.*(?:payout|payment)/.test(normalized) ||
    (normalized.includes('fee') && !/^(?:feestatus|feesource|feeissuecount)$/.test(normalized)) ||
    /淨利|净利|廣告花費|广告花费|手續費|手续费|淨入帳|净入账/.test(key)
  )) {
    return true;
  }
  if (!permissions.employeeCompensation && (
    COMPENSATION_FIELDS.has(normalized) ||
    /^(?:salary|payroll|wage|remuneration)/.test(normalized) ||
    /(?:allowance|deduction|selfcontribution|bonus)(?:[a-z]+)?$/.test(normalized) ||
    /薪資|薪酬|工資|工资|獎金|奖金|津貼|津贴|扣款|銀行帳|银行账/.test(key)
  )) {
    return true;
  }
  return false;
}

export function containsCostInput(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsCostInput);
  if (value === null || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, field]) =>
    isSensitiveField(key, {
      productCost: false,
      financialMargin: true,
      financialNetProfit: true,
      employeeCompensation: true,
    }) || containsCostInput(field),
  );
}

/** Make a fresh response tree so shared service objects cannot be changed by redaction. */
export function redactSensitiveResponse<T>(value: T, permissions: SensitiveReadPermissions, purchaseDocument = false): T {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveResponse(item, permissions, purchaseDocument)) as T;
  }
  if (value === null || typeof value !== 'object' || value instanceof Date || Buffer.isBuffer(value)) {
    return value;
  }
  // Prisma Decimal and StreamableFile are not response records.
  if (typeof (value as any).toFixed === 'function' || typeof (value as any).getStream === 'function') {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).filter(([key]) =>
      !isSensitiveField(key, permissions) &&
      !(purchaseDocument && !permissions.productCost && /(?:cost|amount|price|freight|fxrate|tax|currency|subtotal|total)/i.test(key)),
    ).map(([key, field]) => [key, redactSensitiveResponse(field, permissions, purchaseDocument)]),
  ) as T;
}

export function sensitiveReadPermissions(keys: readonly string[] = []): SensitiveReadPermissions {
  const permissions = new Set(keys);
  const productCost = permissions.has('product_cost:read');
  // Revenue together with gross profit reveals COGS, while net profit and its
  // expense components can reconstruct gross profit. Enforce both dependencies.
  const financialMargin = productCost && permissions.has('financial_margin:read');
  return {
    productCost,
    financialMargin,
    financialNetProfit: financialMargin && permissions.has('financial_net_profit:read'),
    employeeCompensation: permissions.has('employee_compensation:read'),
  };
}

/** JWT validation loads current effective permissions from the database on every request. */
@Injectable()
export class SensitiveResponseInterceptor implements NestInterceptor {
  constructor(
    private readonly purchaseDocument = false,
    private readonly noStore = false,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    if (this.noStore) {
      context.switchToHttp().getResponse()?.setHeader('Cache-Control', 'private, no-store');
    }
    const user = request?.user;
    const keys: string[] = user?.effectivePermissions || [];
    const visibility = sensitiveReadPermissions(keys);
    // Self-service routes use the authenticated employee relation in PayrollService.
    // The personal pay-slip permission grants access only to that employee's data.
    if (/\/payroll\/my(?:\/|$)/.test(request?.url || '') && keys.includes('payroll_self:read')) {
      visibility.employeeCompensation = true;
    }
    return next.handle().pipe(map((response) => redactSensitiveResponse(response, visibility, this.purchaseDocument)));
  }
}
