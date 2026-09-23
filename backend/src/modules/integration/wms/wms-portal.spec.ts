import { WmsPortalService } from './wms-portal.module';
import { ExpenseController } from '../../expense/expense.controller';

function actor(permissions = ['wms_tasks:read','wms_picking:execute']) {
  return {id:'staff',name:'Staff',passwordHash:'hash',isActive:true,mustChangePassword:false,entityMemberships:[{entityId:'warehouse'}],employee:null,
    roles:[{role:{code:'WAREHOUSE_PICKER',permissions:permissions.map(p=>({permission:{resource:p.split(':')[0],action:p.split(':')[1]}}))}}]};
}
describe('warehouse identity and personal access', () => {
  let db:any, service:WmsPortalService;
  beforeEach(() => {
    process.env.WMS_PORTAL_ENTITY_ID='warehouse'; process.env.WMS_PORTAL_SHARED_SECRET='s'.repeat(40); process.env.WMS_PORTAL_SSO_ENABLED='true';
    db={user:{findUnique:jest.fn().mockResolvedValue(actor())},expenseRequest:{findUnique:jest.fn().mockResolvedValue({createdBy:'other'})},$executeRaw:jest.fn(),$queryRaw:jest.fn()};
    service=new WmsPortalService(db);
  });
  it('only offers permitted work; choosing pack never elevates a picker',async()=>{
    expect((await service.access('staff')).roles).toEqual(['picker']);
    await expect(service.ticket('staff',{role:'packer',nonce:'a'.repeat(64)})).rejects.toThrow('沒有此作業權限');
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });
  it('blocks removed company access, disabled accounts and password-change accounts',async()=>{
    for(const change of [{entityMemberships:[]},{isActive:false},{mustChangePassword:true}]) {
      db.user.findUnique.mockResolvedValue({...actor(),...change});
      await expect(service.access('staff')).rejects.toThrow();
    }
  });
  it('requires a dedicated backchannel credential and an enabled integration',()=>{
    expect(()=>service.authenticateService('wrong')).toThrow();
    expect(()=>service.authenticateService('s'.repeat(40))).not.toThrow();
    process.env.WMS_PORTAL_SSO_ENABLED='false'; expect(()=>service.authenticateService('s'.repeat(40))).toThrow();
  });
  it('refuses an expired or already consumed ticket',async()=>{
    db.$queryRaw.mockResolvedValue([]);
    await expect(service.consume({ticket:'a'.repeat(64),nonce:'b'.repeat(64)})).rejects.toThrow();
  });
  it('rechecks permissions and password version on an existing session',async()=>{
    db.$queryRaw.mockResolvedValue([{user_id:'staff',station:'packer',entity_id:'warehouse',password_version:'old'}]);
    await expect(service.inspect('s')).rejects.toThrow('沒有此作業權限');
    db.$queryRaw.mockResolvedValue([{user_id:'staff',station:'picker',entity_id:'warehouse',password_version:'old'}]);
    await expect(service.inspect('s')).rejects.toThrow();
  });
  it('employee expense list is self scoped even when mine=false',async()=>{
    const expenses={getExpenseRequests:jest.fn().mockResolvedValue([])};
    const controller=new ExpenseController(expenses as any,db);
    await controller.getExpenseRequests('warehouse',undefined,{user:{id:'staff'},query:{mine:'false'}} as any);
    expect(expenses.getExpenseRequests).toHaveBeenCalledWith('warehouse',undefined,'staff');
  });
  it('employee cannot read another expense or its history by guessing its ID',async()=>{
    const controller=new ExpenseController({} as any,db);
    const req={user:{id:'staff'}} as any;
    await expect(controller.getExpenseRequest('other-request',req)).rejects.toThrow();
    await expect(controller.getExpenseHistory('other-request',req)).rejects.toThrow();
  });
});
