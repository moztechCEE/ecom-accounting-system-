// Preparatory configuration and immutable quote drafts only. No source workflow writes.
export type BrandSettings = {
  code: string;
  name: string;
  active: boolean;
  lineOfficialId: string;
  channelId: string;
  liffId: string;
  invoiceLegalName: string;
  invoiceTaxId: string;
  invoiceMerchantLabel: string;
};
export type QuoteLine = {
  description: string;
  quantity: number;
  unitPrice: string;
};
export type QuoteInput = {
  brandCode: string;
  brandVersion: number;
  sourceCaseId: string;
  lines: QuoteLine[];
  customerNote: string;
};
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('資料格式不正確');
  return value as Record<string, unknown>;
}
function only(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).some((key) => !keys.includes(key)))
    throw new Error('包含不支援的欄位');
}
function string(value: unknown, max: number, required = false): string {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    (required && !value.trim())
  )
    throw new Error('欄位未填寫或超過長度限制');
  return value.trim();
}
export function parseBrand(value: unknown): BrandSettings {
  const data = object(value);
  only(data, [
    'code',
    'name',
    'active',
    'lineOfficialId',
    'channelId',
    'liffId',
    'invoiceLegalName',
    'invoiceTaxId',
    'invoiceMerchantLabel',
  ]);
  const code = string(data.code, 40, true).toUpperCase();
  if (!/^[A-Z][A-Z0-9_-]{1,39}$/.test(code) || typeof data.active !== 'boolean')
    throw new Error('品牌代號或啟用狀態不正確');
  const invoiceTaxId = string(data.invoiceTaxId, 8);
  if (invoiceTaxId && !/^\d{8}$/.test(invoiceTaxId))
    throw new Error('統編須為 8 碼，未核對時請留空');
  const channelId = string(data.channelId, 24);
  if (channelId && !/^\d+$/.test(channelId))
    throw new Error('Channel ID 須為數字');
  return {
    code,
    name: string(data.name, 80, true),
    active: data.active,
    lineOfficialId: string(data.lineOfficialId, 80),
    channelId,
    liffId: string(data.liffId, 80),
    invoiceLegalName: string(data.invoiceLegalName, 120),
    invoiceTaxId,
    invoiceMerchantLabel: string(data.invoiceMerchantLabel, 120),
  };
}
export function moneyCents(value: string): number {
  if (
    typeof value !== 'string' ||
    !/^(0|[1-9]\d{0,7})(\.\d{1,2})?$/.test(value)
  )
    throw new Error('金額須為非負數，最多兩位小數');
  const [whole, decimal = ''] = value.split('.');
  return Number(whole) * 100 + Number(decimal.padEnd(2, '0'));
}
export function formatMoney(cents: number): string {
  return (cents / 100).toFixed(2);
}
export function parseQuote(value: unknown): QuoteInput {
  const data = object(value);
  only(data, [
    'brandCode',
    'brandVersion',
    'sourceCaseId',
    'lines',
    'customerNote',
  ]);
  if (!Number.isInteger(data.brandVersion) || Number(data.brandVersion) < 1)
    throw new Error('請重新載入品牌設定');
  if (
    !Array.isArray(data.lines) ||
    data.lines.length < 1 ||
    data.lines.length > 50
  )
    throw new Error('請填寫 1 至 50 筆報價項目');
  const lines = data.lines.map((value) => {
    const line = object(value);
    only(line, ['description', 'quantity', 'unitPrice']);
    if (
      !Number.isInteger(line.quantity) ||
      Number(line.quantity) < 1 ||
      Number(line.quantity) > 1000
    )
      throw new Error('數量須為 1 至 1000 的整數');
    return {
      description: string(line.description, 200, true),
      quantity: Number(line.quantity),
      unitPrice: formatMoney(moneyCents(string(line.unitPrice, 12, true))),
    };
  });
  const result = {
    brandCode: string(data.brandCode, 40, true),
    brandVersion: Number(data.brandVersion),
    sourceCaseId: string(data.sourceCaseId, 128, true),
    lines,
    customerNote: string(data.customerNote, 1000),
  };
  quoteTotal(result.lines);
  return result;
}
export function quoteTotal(lines: QuoteLine[]) {
  const cents = lines.reduce(
    (total, line) => total + moneyCents(line.unitPrice) * line.quantity,
    0,
  );
  if (!Number.isSafeInteger(cents) || cents > 9999999999)
    throw new Error('報價總額超過限制');
  return formatMoney(cents);
}
export function customerQuote(
  brand: BrandSettings,
  caseNumber: string,
  input: QuoteInput,
) {
  // Explicit customer-facing projection: no entity, seller alias, account config, or credentials.
  return {
    brandName: brand.name,
    caseNumber,
    currency: 'TWD' as const,
    lines: input.lines,
    total: quoteTotal(input.lines),
    customerNote: input.customerNote,
  };
}
export function sourcePaymentBrand(source: {
  sections: {
    key: string;
    records: { fields: { key: string; value: unknown }[] }[];
  }[];
}) {
  const brands = new Set(
    source.sections
      .filter((section) => section.key === 'paymentRequests')
      .flatMap((section) =>
        section.records.flatMap((record) =>
          record.fields
            .filter(
              (field) =>
                field.key === 'brand' &&
                typeof field.value === 'string' &&
                field.value,
            )
            .map((field) => String(field.value).toUpperCase()),
        ),
      ),
  );
  if (brands.size > 1) throw new Error('原案件有多個付款品牌，須先人工核對');
  return [...brands][0] || null;
}
