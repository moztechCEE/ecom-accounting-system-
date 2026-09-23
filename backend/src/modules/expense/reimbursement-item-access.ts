type ReimbursementRestrictions = {
  allowedRoles?: string | null;
  allowedDepartments?: string | null;
};

const entries = (value?: string | null): string[] =>
  (value || '').split(',').map((entry) => entry.trim()).filter(Boolean);

/** Apply the same exact role/department allowlists to discovery and submission. */
export function canUseReimbursementItem(
  item: ReimbursementRestrictions,
  context: { roles?: string[]; departmentId?: string } = {},
): boolean {
  const roles = entries(item.allowedRoles);
  const departments = entries(item.allowedDepartments);
  return (
    (!roles.length || roles.some((role) => context.roles?.includes(role))) &&
    (!departments.length || Boolean(context.departmentId && departments.includes(context.departmentId)))
  );
}
