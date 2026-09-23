import { Body, Controller, ForbiddenException, Get, Header, Headers, Injectable, Module, Post, Req, ServiceUnavailableException, UnauthorizedException, UseGuards } from '@nestjs/common';
import { IsIn, IsInt, IsString, IsOptional, Matches, Max, Min } from 'class-validator';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/permissions.decorator';
import { Public } from '../../../common/decorators/public.decorator';

const roles = { picker: 'wms_picking:execute', packer: 'wms_packing:execute', dispatcher: 'wms_orders:create' } as const;
type Station = keyof typeof roles;
const entries = {
  tasks: { path: '/tasks', permissions: ['wms_tasks:read'] },
  picking: { path: '/tasks?group=pick', permissions: ['wms_picking:execute'], station: 'picker' },
  packing: { path: '/tasks?group=pack', permissions: ['wms_packing:execute'], station: 'packer' },
  completed: { path: '/tasks?view=completed', permissions: ['wms_tasks:read'] },
  dispatch: { path: '/admin', permissions: ['wms_orders:create'], station: 'dispatcher' },
  marketplace: { path: '/admin/marketplace-converter', permissions: ['wms_orders:create'], station: 'dispatcher' },
  intakes: { path: '/warehouse-intakes', permissions: ['wms_orders:create','wms_picking:execute','wms_packing:execute'] },
  overview: { path: '/admin/analytics', permissions: ['wms_overview:read'] },
  logs: { path: '/admin/operation-logs', permissions: ['wms_logs:read'] },
  exceptions: { path: '/admin/exceptions', permissions: ['wms_exceptions:read'] },
  'scan-errors': { path: '/admin/scan-errors', permissions: ['wms_scan_errors:read'] },
  defects: { path: '/admin/defects', permissions: ['wms_defects:read'] },
  logistics: { path: '/settings/logistics', permissions: [], adminOnly: true },
  team: { path: '/team', permissions: ['wms_tasks:read'] },
  users: { path: '/admin/users', permissions: [], adminOnly: true },
  settings: { path: '/settings', permissions: ['wms_tasks:read'] },
} satisfies Record<string, {path:string; permissions:string[]; station?:Station; adminOnly?:boolean}>;
type Entry = keyof typeof entries;
type PortalEntry = Entry | 'native-intake';
const roleEntries = { picker:'picking', packer:'packing', dispatcher:'dispatch' } as const;
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const nativeIntakeKey = /^native-intake:([A-Za-z0-9_-]{1,128}):([1-9]\d{0,8})$/;
class TicketDto {
  @IsOptional() @IsIn(['picker', 'packer', 'dispatcher']) role?: Station;
  @IsOptional() @IsIn([...Object.keys(entries), 'native-intake']) entry?: PortalEntry;
  @IsOptional() @IsString() @Matches(/^[A-Za-z0-9_-]{1,128}$/) salesOrderId?: string;
  @IsOptional() @IsInt() @Min(1) @Max(999999999) nativeIntakeId?: number;
  @IsString() @Matches(/^[a-f0-9]{64}$/) nonce!: string;
}
class ExchangeDto {
  @IsString() @Matches(/^[a-f0-9]{64}$/) ticket!: string;
  @IsString() @Matches(/^[a-f0-9]{64}$/) nonce!: string;
}
class BindDto { @IsString() userId!: string; @IsInt() @Min(1) wmsUserId!: number; }
class SessionDto { @IsString() @Matches(/^[a-f0-9]{64}$/) session!: string; }

@Injectable()
export class WmsPortalService {
  constructor(private readonly db: PrismaService) {}
  enabled() {
    if (process.env.WMS_PORTAL_SSO_ENABLED !== 'true' || !process.env.WMS_PORTAL_ENTITY_ID || (process.env.WMS_PORTAL_SHARED_SECRET || '').length < 32) {
      throw new ServiceUnavailableException('儲運統一登入尚未啟用');
    }
  }
  authenticateService(value?: string) {
    this.enabled();
    const actual = Buffer.from(value || ''); const expected = Buffer.from(process.env.WMS_PORTAL_SHARED_SECRET!);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new UnauthorizedException();
  }
  async identity(userId: string, station?: Station) {
    const user = await this.db.user.findUnique({ where: { id: userId }, include: {
      entityMemberships: true, employee: { select: { entityId: true } },
      roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
    } });
    if (!user?.isActive || user.mustChangePassword) throw new ForbiddenException('帳號停用或需要先變更密碼');
    const admin = user.roles.some(r => ['ADMIN','SUPER_ADMIN'].includes(r.role.code));
    const permissions = new Set(user.roles.flatMap(r => r.role.permissions.map(p => `${p.permission.resource}:${p.permission.action}`)));
    const entityId = process.env.WMS_PORTAL_ENTITY_ID;
    // WMS currently holds one warehouse/company. Do not treat an arbitrary ERP company as this warehouse.
    if (!admin && !user.entityMemberships.some(m => m.entityId === entityId) && user.employee?.entityId !== entityId) throw new ForbiddenException('沒有此儲運公司的存取權限');
    const allowed = (Object.keys(roles) as Station[]).filter(role => admin || (permissions.has('wms_tasks:read') && permissions.has(roles[role])));
    if (station && !allowed.includes(station)) throw new ForbiddenException('沒有此作業權限');
    const personalPaths = [['/attendance/dashboard','attendance_self:read'],['/attendance/leaves','leave_self:read'],['/ap/expenses','expense_self:read'],['/profile','profile_self:read']].filter(([,permission])=>admin || permissions.has(permission)).map(([path])=>path);
    return { userId: user.id, name: user.name, entityId, roles: allowed, personalPaths, admin, permissions: [...permissions], passwordVersion: hash(user.passwordHash) };
  }
  async access(userId: string) {
    this.enabled(); const { passwordVersion, ...identity } = await this.identity(userId); return identity;
  }
  private destination(actor: Awaited<ReturnType<WmsPortalService['identity']>>, entry: Entry) {
    const target: {path:string; permissions:string[]; station?:Station; adminOnly?:boolean} = entries[entry];
    if (!target || (!actor.admin && (!actor.permissions.includes('wms_tasks:read') || target.adminOnly || !target.permissions.some(p => actor.permissions.includes(p))))) throw new ForbiddenException('沒有此儲運功能權限');
    // A report permission never becomes WMS admin. Portal viewers are read-only.
    const role = target.station || (actor.admin ? 'admin' : entry === 'intakes' ? actor.roles.find(r => r === 'dispatcher') || actor.roles[0] : 'viewer');
    if (!role) throw new ForbiddenException('請先指派儲運作業權限');
    return { role, destination: target.path, permissions: actor.admin ? ['wms_admin'] : actor.permissions.filter(p => p.startsWith('wms_')) };
  }
  private async resolvedDestination(actor: Awaited<ReturnType<WmsPortalService['identity']>>, entryKey: string) {
    const intake = nativeIntakeKey.exec(entryKey);
    if (!intake) return this.destination(actor, entryKey as Entry);
    // A document link is issued only for a dispatch acknowledged by WMS for
    // the warehouse company. Recheck on consume and inspect, not only at issue.
    const access = this.destination(actor, 'dispatch');
    const [, salesOrderId, nativeIntakeId] = intake;
    const rows = await this.db.$queryRaw<any[]>`SELECT 1 FROM wms_dispatch_intents
      WHERE entity_id = ${actor.entityId} AND sales_order_id = ${salesOrderId}
      AND status = 'acknowledged' AND response->>'nativeIntakeId' = ${nativeIntakeId}
      LIMIT 1`;
    if (!rows.length) throw new ForbiddenException('此 WMS 預揀工作單未連結至已拋轉的 ERP 訂單');
    return { ...access, destination: `/corely-intakes/${nativeIntakeId}` };
  }
  private async sessionIdentity(record: any) {
    const actor = await this.identity(record.user_id);
    const access = await this.resolvedDestination(actor, record.entry_key || roleEntries[record.station as Station]);
    if (actor.passwordVersion !== record.password_version || actor.entityId !== record.entity_id) throw new UnauthorizedException();
    return { userId:actor.userId, name:actor.name, entityId:actor.entityId, personalPaths:actor.personalPaths, ...access, expiresAt:record.expires_at };
  }
  async ticket(userId: string, input: TicketDto) {
    this.enabled(); const actor = await this.identity(userId);
    const entry = input.entry || (input.role && roleEntries[input.role]);
    if (!entry || (input.entry && input.role)) throw new ForbiddenException('請指定一個儲運入口');
    const native = entry === 'native-intake';
    if ((native && (input.salesOrderId === undefined || input.nativeIntakeId === undefined)) ||
        (!native && (input.salesOrderId !== undefined || input.nativeIntakeId !== undefined)))
      throw new ForbiddenException('預揀工作單需要對應的 ERP 訂單與 WMS 單號');
    if (native && (!/^[A-Za-z0-9_-]{1,128}$/.test(input.salesOrderId!) || !Number.isSafeInteger(input.nativeIntakeId) || input.nativeIntakeId! < 1 || input.nativeIntakeId! > 999999999)) throw new ForbiddenException('預揀工作單識別錯誤');
    const entryKey = native ? `native-intake:${input.salesOrderId}:${input.nativeIntakeId}` : entry;
    await this.resolvedDestination(actor, entryKey);
    const ticket = randomBytes(32).toString('hex');
    await this.db.$executeRaw`INSERT INTO wms_portal_sessions
      (id, user_id, entity_id, station, entry_key, nonce, password_version, ticket_expires_at, expires_at)
      VALUES (${hash(ticket)}, ${userId}, ${actor.entityId!}, ${input.role || 'portal'}, ${entryKey}, ${input.nonce}, ${actor.passwordVersion}, NOW() + INTERVAL '60 seconds', NOW() + INTERVAL '8 hours')`;
    return { ticket };
  }
  async consume(input: ExchangeDto) {
    const session = randomBytes(32).toString('hex');
    // Atomic consume also prevents replay across Cloud Run instances.
    const rows = await this.db.$queryRaw<any[]>`UPDATE wms_portal_sessions SET consumed_at = NOW(), session_hash = ${hash(session)}
      WHERE id = ${hash(input.ticket)} AND nonce = ${input.nonce} AND consumed_at IS NULL
      AND revoked_at IS NULL AND ticket_expires_at > NOW() RETURNING *`;
    const record = rows[0]; if (!record) throw new UnauthorizedException('工作台連線已逾時，請重新開啟');
    const actor = await this.sessionIdentity(record);
    // One active warehouse identity per ERP account; old tabs cannot keep a previous role.
    await this.db.$executeRaw`UPDATE wms_portal_sessions SET revoked_at = NOW() WHERE user_id = ${record.user_id} AND id <> ${record.id} AND consumed_at IS NOT NULL AND revoked_at IS NULL`;
    return { session, ...actor };
  }
  async inspect(session: string) {
    const rows = await this.db.$queryRaw<any[]>`SELECT * FROM wms_portal_sessions WHERE session_hash = ${hash(session)} AND consumed_at IS NOT NULL AND revoked_at IS NULL AND expires_at > NOW()`;
    const record = rows[0]; if (!record) throw new UnauthorizedException('儲運登入已失效，請回工作台重新選擇');
    const actor = await this.sessionIdentity(record);
    return actor;
  }
  async staffCommand(action:'staff'|'bind', body?:BindDto) {
    this.enabled();
    if (body) { const actor=await this.identity(body.userId); if(!actor.roles.length) throw new ForbiddenException('請先指派儲運角色與公司'); }
    const base=process.env.WMS_PORTAL_SERVICE_URL;
    if (!base || new URL(base).protocol!=='https:' || new URL(base).origin!==base) throw new ServiceUnavailableException('尚未設定儲運人員連線');
    let response:Response;
    try { response=await fetch(base+'/api/auth/erp/'+action,{method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),headers:{'Content-Type':'application/json','x-erp-service-key':process.env.WMS_PORTAL_SHARED_SECRET!},body:JSON.stringify(body ? {...body,entityId:process.env.WMS_PORTAL_ENTITY_ID}: {})}); }
    catch {throw new ServiceUnavailableException('無法連線至儲運人員管理');}
    if (!response.ok) {const data=await response.json();throw new ForbiddenException(data.message || '無法連結儲運帳號');}
    return response.json();
  }
  async revoke(userId: string) {
    await this.db.$executeRaw`UPDATE wms_portal_sessions SET revoked_at = NOW() WHERE user_id = ${userId} AND revoked_at IS NULL`;
    return { ok: true };
  }
  async revokeSession(session: string) {
    await this.db.$executeRaw`UPDATE wms_portal_sessions SET revoked_at = NOW() WHERE session_hash = ${hash(session)} AND revoked_at IS NULL`;
    return { ok: true };
  }
}
@Controller('wms/portal')
export class WmsPortalController {
  constructor(private readonly service: WmsPortalService) {}
  @Get('access') @Header('Cache-Control','no-store')
  access(@Req() req: any) { return this.service.access(req.user.id); }
  @Post('ticket') @Header('Cache-Control','no-store')
  ticket(@Req() req: any, @Body() dto: TicketDto) { return this.service.ticket(req.user.id, dto); }
  @Get('staff') @UseGuards(PermissionsGuard) @RequirePermissions({resource:'access_control',action:'update'})
  staff() {return this.service.staffCommand('staff');}
  @Post('bind') @UseGuards(PermissionsGuard) @RequirePermissions({resource:'access_control',action:'update'})
  bind(@Body() dto:BindDto) {return this.service.staffCommand('bind',dto);}
  @Post('logout')
  logout(@Req() req: any) { return this.service.revoke(req.user.id); }
  @Public() @Post('consume') @Header('Cache-Control','no-store')
  consume(@Headers('x-wms-service-key') key: string, @Body() dto: ExchangeDto) { this.service.authenticateService(key); return this.service.consume(dto); }
  @Public() @Post('inspect') @Header('Cache-Control','no-store')
  inspect(@Headers('x-wms-service-key') key: string, @Body() dto: SessionDto) { this.service.authenticateService(key); return this.service.inspect(dto.session); }
  @Public() @Post('revoke')
  revoke(@Headers('x-wms-service-key') key: string, @Body() dto: SessionDto) { this.service.authenticateService(key); return this.service.revokeSession(dto.session); }
}
@Module({ controllers: [WmsPortalController], providers: [WmsPortalService] })
export class WmsPortalModule {}
