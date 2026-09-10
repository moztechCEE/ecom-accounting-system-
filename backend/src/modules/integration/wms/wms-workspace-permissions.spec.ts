import 'reflect-metadata';
import { Reflector } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { WmsWorkbenchController, WmsCommandDto, WmsScanDto } from './wms-workbench.module';

describe('warehouse workspace permission boundary', () => {
  const context = (handler: string) => ({
    getHandler: () => WmsWorkbenchController.prototype[handler],
    getClass: () => WmsWorkbenchController,
    switchToHttp: () => ({ getRequest: () => ({ user: { id: 'employee' } }) }),
  }) as any;
  const guard = (permissions: string[]) => new PermissionsGuard(new Reflector(), {
    userRole: { findMany: jest.fn().mockResolvedValue([{ role: { code: 'EMPLOYEE', permissions: permissions.map(p => {
      const [resource, action] = p.split(':'); return { permission: { resource, action } };
    }) } }]) },
  } as any);
  it('inventory viewing does not grant task access', async () => {
    await expect(guard(['inventory:read']).canActivate(context('orders'))).rejects.toThrow('wms_tasks:read');
  });
  it('picker cannot pack and packer cannot pick', async () => {
    const picker=guard(['wms_tasks:read','wms_picking:execute']);
    await expect(picker.canActivate(context('scanPick'))).resolves.toBe(true);
    await expect(picker.canActivate(context('claimPack'))).rejects.toThrow('wms_packing:execute');
    const packer=guard(['wms_tasks:read','wms_packing:execute']);
    await expect(packer.canActivate(context('scanPack'))).resolves.toBe(true);
    await expect(packer.canActivate(context('claimPick'))).rejects.toThrow('wms_picking:execute');
    await expect(guard(['wms_picking:execute']).canActivate(context('scanPick'))).rejects.toThrow('wms_tasks:read');
  });
  it('valid permission still cannot activate unapproved source writes', () => {
    const controller=new WmsWorkbenchController({} as any);
    for(const method of ['claimPick','scanPick','claimPack','scanPack']) {
      expect(()=>controller[method]({entityId:'entity'})).toThrow('WMS 安全連線與員工對照尚未開通');
    }
  });
  it('requires bounded request key, source revision and scan value', () => {
    const good={entityId:'entity',expectedRevision:1,requestId:'request'};
    expect(validateSync(plainToInstance(WmsCommandDto,good))).toHaveLength(0);
    for(const bad of [{...good,expectedRevision:0},{...good,requestId:''},{...good,requestId:'x'.repeat(65)}]) {
      expect(validateSync(plainToInstance(WmsCommandDto,bad)).length).toBeGreaterThan(0);
    }
    expect(validateSync(plainToInstance(WmsScanDto,good)).length).toBeGreaterThan(0);
  });
});
