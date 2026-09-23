import { roleDeletionReason } from './role-deletion-policy';
import { RolesService } from './roles.service';
describe('safe role removal', () => {
  it('requires reassignment before deleting any used role, protects highest admin, and permits unused admin only to highest admin', () => {
    expect(roleDeletionReason('SUPER_ADMIN', 0, true)).toContain('不可刪除');
    expect(roleDeletionReason('ADMIN', 5, true)).toContain('5 個帳號');
    expect(roleDeletionReason('ADMIN', 0, false)).toContain('最高管理員');
    expect(roleDeletionReason('ADMIN', 0, true)).toBeNull();
    expect(roleDeletionReason('CUSTOM', 0, false)).toBeNull();
  });
  it('locks role before checking assignments, never cascades away existing users', async () => {
    const order: string[] = [];
    const tx: any = { department: { count: jest.fn(async () => 0) }, $queryRaw: jest.fn(async () => { order.push('lock') }), role: { findUnique: jest.fn(async () => ({ code: 'ADMIN' })), delete: jest.fn() }, userRole: { count: jest.fn(async () => { order.push('count'); return 1 }) } };
    const service = new RolesService({ $transaction: (fn: any) => fn(tx) } as any);
    await expect(service.remove('admin', 'self')).rejects.toThrow('帳號');
    expect(order[0]).toBe('lock');expect(tx.role.delete).not.toHaveBeenCalled();
  });
});
