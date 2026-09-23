import { departmentAccess, effectivePermissionKeys } from './department-access';
import { EntityAccessService } from '../entity-access/entity-access.service';
import { PermissionsGuard } from '../guards/permissions.guard';
import { PayrollService } from '../../modules/payroll/payroll.service';
import { LeaveService } from '../../modules/attendance/services/leave.service';
import { LeaveStatus } from '@prisma/client';

const role = (name: string, permissions: string[]) => ({ name, code: name, permissions: permissions.map(key => { const [resource,action] = key.split(':'); return { permission: { resource, action } }; }) });
const employee = (supervisor = false): any => ({ id:'employee', userId:'user', name:'Test', entityId:'company', departmentId:'dept', isActive:true, isDepartmentSupervisor:supervisor,
  department:{id:'dept',entityId:'company',isActive:true,memberRole:role('WAREHOUSE_OPERATOR',['wms_tasks:read','wms_picking:execute','wms_packing:execute']),supervisorRole:role('MANAGER',['wms_scan_errors:read','banking:read','access_control:update','payroll_admin:read','wms_logs:read'])},
});

describe('department membership and additive supervisor permissions', () => {
  it('keeps the same shared work rights and personal services for member and supervisor', () => {
    const member = departmentAccess(employee()).permissions;
    const manager = departmentAccess(employee(true)).permissions;
    expect(manager).toEqual(expect.arrayContaining(member));
    expect(manager).toEqual(expect.arrayContaining(['wms_picking:execute','wms_packing:execute','wms_scan_errors:read','attendance_team:read','attendance_team:review']));
    expect(member).not.toContain('wms_scan_errors:read');
  });
  it('never derives finance, payroll, identity or full operation logs from a department role', () => {
    expect(departmentAccess(employee(true)).permissions).not.toEqual(expect.arrayContaining(['banking:read']));
    for (const permission of ['banking:read','payroll_admin:read','access_control:update','wms_logs:read','attendance_admin:update']) expect(departmentAccess(employee(true)).permissions).not.toContain(permission);
  });
  it.each(['ADMIN','SUPER_ADMIN'])('ignores a privileged department role even if imported directly: %s', code => {
    const e = employee(); e.department.memberRole = role(code,['wms_tasks:read']);
    expect(departmentAccess(e).permissions).not.toContain('wms_tasks:read');
  });
  it('retains explicit personal grants without copying them into department grants', () => {
    expect(effectivePermissionKeys({employee:employee(true),roles:[{role:role('PAYROLL',['payroll_admin:read'])}]})).toContain('payroll_admin:read');
    expect(departmentAccess(employee(true)).permissions).not.toContain('payroll_admin:read');
  });
  it('revokes supervisor-only grants on demotion, retaining shared work', () => {
    const e = employee(true); e.isDepartmentSupervisor=false;
    expect(departmentAccess(e).permissions).toContain('wms_packing:execute');
    expect(departmentAccess(e).permissions).not.toContain('attendance_team:review');
  });
  it.each(['inactive-employee','inactive-department','other-company','missing-department','stale-department'])('fails closed for %s', condition => {
    const e=employee(true);
    if(condition==='inactive-employee') e.isActive=false;
    if(condition==='inactive-department') e.department.isActive=false;
    if(condition==='other-company') e.department.entityId='other';
    if(condition==='missing-department') e.department=null;
    if(condition==='stale-department') e.departmentId='new';
    expect(departmentAccess(e)).toMatchObject({isSupervisor:false,permissions:[]});
  });
  it('grants department attendance scope only, leaves salary and accounting scope unchanged', async () => {
    const user:any={employee:employee(true),roles:[],entityMemberships:[],attendanceDataScope:'SELF',payrollDataScope:'SELF',accountingDataScope:'SELF',employeeDataScope:'SELF'};
    const db:any={user:{findUnique:jest.fn(async()=>user)}};
    const service=new EntityAccessService(db);
    expect(await service.getContext('user','attendance','company')).toMatchObject({scope:'DEPARTMENT',departmentId:'dept',noAccess:false});
    for (const module of ['payroll','accounting','employees'] as const) expect((await service.getContext('user',module,'company')).scope).toBe('SELF');
    expect((await service.getContext('user','attendance','other')).noAccess).toBe(true);
    user.employee.isDepartmentSupervisor=false;
    expect((await service.getContext('user','attendance','company')).scope).toBe('SELF');
  });
  it('server guard accepts fresh department grants but not global attendance changes', async () => {
    let required=['attendance_team:review'];
    const user={id:'user',effectivePermissions:effectivePermissionKeys({employee:employee(true)})};
    const context:any={getHandler:()=>({}),getClass:()=>({}),switchToHttp:()=>({getRequest:()=>({user})})};
    const guard=new PermissionsGuard({getAllAndOverride:()=>required} as any,{userRole:{findMany:async()=>[]}} as any);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    required=['attendance_admin:update']; await expect(guard.canActivate(context)).rejects.toThrow('attendance_admin:update');
    required=['attendance_team:review']; user.effectivePermissions=effectivePermissionKeys({employee:employee(false)});
    await expect(guard.canActivate(context)).rejects.toThrow('attendance_team:review');
  });
});

describe('department configuration boundaries',()=>{
  const proto=PayrollService.prototype as any;
  it.each([true,'true',null,1])('rejects supervisor without an active department or invalid type: %s', async value=>{
    await expect(proto.validateDepartmentSupervisor.call({ensureDepartmentInEntity:async()=>null},value,null,'company')).rejects.toThrow();
  });
  it('only access managers can bind department permissions',async()=>{
    await expect(proto.assertDepartmentBindingAllowed.call({prisma:{userRole:{count:async()=>0}},usersService:{hasPermission:async()=>false}},'hr')).rejects.toThrow('帳號權限管理');
  });
  it('rejects privileged role binding before a write',async()=>{
    await expect(proto.validateDepartmentRoles.call({assertDepartmentBindingAllowed:async()=>{},prisma:{role:{findUnique:async()=>({code:'ADMIN',name:'Admin'})}}},'admin',{memberRoleId:'admin-role'})).rejects.toThrow('不能綁定管理員');
  });
  it('allows active department supervisors and explicit clears',async()=>{
    const context={ensureDepartmentInEntity:async()=>({isActive:true})};
    await expect(proto.validateDepartmentSupervisor.call(context,true,'dept','company')).resolves.toBeUndefined();
    await expect(proto.validateDepartmentSupervisor.call(context,false,null,'company')).resolves.toBeUndefined();
  });
});

describe('department leave review boundaries',()=>{
  const review=(request:any,access:any)=>{
    const context={prisma:{leaveRequest:{findUnique:async()=>request}},getAdminAccessContext:async()=>access};
    return LeaveService.prototype.updateLeaveStatus.call(context as any,'request',LeaveStatus.APPROVED,'reviewer');
  };
  it('denies self approval before balances or status can be written',async()=>{
    await expect(review({employee:{userId:'reviewer'}},{})).rejects.toThrow('不能審核自己');
  });
  it.each([{scope:'DEPARTMENT',departmentId:'other',noAccess:false},{scope:'DEPARTMENT',departmentId:'dept',noAccess:true}])('denies another department or company',async access=>{
    await expect(review({entityId:'company',employee:{userId:'staff',departmentId:'dept'}},access)).rejects.toThrow('not found');
  });
});
