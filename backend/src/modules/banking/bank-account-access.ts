/** The same explicit account ACL applies to bank screens and expense payment records. */
export function canViewBankAccountForUser(account: { metaJson?: unknown }, user: any): boolean {
  if (user?.roles?.some((entry: any) => (entry.role?.code || entry.role?.name) === 'SUPER_ADMIN')) return true;
  const meta = account.metaJson && typeof account.metaJson === 'object' && !Array.isArray(account.metaJson)
    ? account.metaJson as Record<string, unknown> : {};
  const allowed = Array.isArray(meta.bankVisibleUserIds) ? meta.bankVisibleUserIds
    : Array.isArray(meta.allowedUserIds) ? meta.allowedUserIds : [];
  return Boolean(user?.id && allowed.map(String).includes(user.id));
}
