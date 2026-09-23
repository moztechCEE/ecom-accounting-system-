export function roleDeletionReason(code: string, assignedUsers: number, isSuperAdmin: boolean): string | null {
  if (code === 'SUPER_ADMIN') return '最高管理員為系統必要角色，不可刪除';
  if (assignedUsers > 0) return `仍有 ${assignedUsers} 個帳號使用，請先將這些帳號改派其他角色`;
  if (code === 'ADMIN' && !isSuperAdmin) return '管理員角色僅能由最高管理員刪除';
  return null;
}
