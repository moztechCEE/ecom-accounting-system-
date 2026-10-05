import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const ERP_AFTER_SALES_SERVICE_AUTH = 'erpAfterSalesServiceAuth';
export const SOURCE_MODULE_RESOURCES = {
  dashboard: 'after_sales_cases',
  cases: 'after_sales_cases',
  repairs: 'after_sales_cases',
  shipping: 'after_sales_shipping',
  invoices: 'after_sales_invoices',
  accounting_workbench: 'after_sales_accounting',
  products: 'after_sales_products',
  faqs: 'after_sales_faqs',
  imports: 'after_sales_imports',
  users: 'after_sales_users',
  audit_logs: 'after_sales_audit',
  settings: 'after_sales_settings',
} as const;
export const SOURCE_SECTIONS = {
  workbench: '/dashboard',
  cases: '/cases',
  quotes: '/cases/repair-quotes',
  repairs: '/cases/repairs',
  reshipments: '/cases/reshipments',
  'exchange-returns': '/cases/exchange-returns',
  'refund-pickups': '/cases/refund-pickups',
  'private-purchases': '/cases/private-purchases',
  'customer-issues': '/cases/customer-issues',
  shipping: '/cases?queue=warehouse',
  accounting: '/accounting-workbench',
  customers: '/customers',
  invoices: '/invoices',
  products: '/products',
  faqs: '/faqs',
  imports: '/imports',
  users: '/users',
  'audit-logs': '/audit-logs',
  settings: '/settings',
} as const;
export function serviceSignature(
  secret: string,
  method: string,
  path: string,
  time: string,
  entity: string,
  actor: string,
  body = '',
) {
  return createHmac('sha256', secret)
    .update(
      [
        'erp.aftersales.v1',
        method,
        path,
        time,
        entity,
        actor,
        createHash('sha256').update(body).digest('hex'),
      ].join('\n'),
    )
    .digest('hex');
}
export function matchesSignature(actual: string, expected: string) {
  return (
    /^[a-f0-9]{64}$/.test(actual) &&
    timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'))
  );
}
export function moduleGrants(permissions: string[], privileged: boolean) {
  const read: string[] = [],
    write: string[] = [];
  for (const [module, resource] of Object.entries(SOURCE_MODULE_RESOURCES)) {
    if (privileged || permissions.includes(resource + ':read'))
      read.push(module);
    if (
      module !== 'audit_logs' &&
      (privileged || permissions.includes(resource + ':update'))
    )
      write.push(module);
  }
  return { read, write };
}
