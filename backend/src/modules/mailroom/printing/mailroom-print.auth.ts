import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CAPABILITY, printEnabled, UUID } from './mailroom-print.contract';
import { MailroomPrintService } from './mailroom-print.service';

export const MAILROOM_PRINT_DEVICE_AUTH = 'mailroomPrintDeviceAuth';
export type PrintDeviceAuthMode = 'device' | 'redeem';
type PrintAuthRequest = {
  method: string;
  originalUrl?: string;
  url?: string;
  headers: Record<string, unknown>;
  body?: Record<string, unknown>;
  socket?: { remoteAddress?: string };
  printDevice?: unknown;
  printRedeem?: unknown;
};

/** Exact route precheck inside the single device verifier fully awaited by the global guard. */
export function assertPrintDeviceRoute(
  req: PrintAuthRequest,
  mode: unknown,
): true {
  printEnabled();
  const path = req.originalUrl || req.url || '';
  if (mode === 'redeem') {
    if (
      req.method !== 'POST' ||
      path !== '/api/v1/mailroom/print-device/redeem' ||
      typeof req.body?.deviceId !== 'string' ||
      !UUID.test(req.body.deviceId) ||
      typeof req.body?.code !== 'string' ||
      !CAPABILITY.test(req.body.code)
    )
      throw new UnauthorizedException('PRINT_DEVICE_CAPABILITY_INVALID');
    return true;
  }
  const jobPath =
    '/api/v1/mailroom/print-device/jobs/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/';
  if (
    mode !== 'device' ||
    !(
      (req.method === 'POST' &&
        path === '/api/v1/mailroom/print-device/claim') ||
      (req.method === 'GET' &&
        new RegExp('^' + jobPath + 'document$', 'i').test(path)) ||
      (req.method === 'POST' &&
        new RegExp('^' + jobPath + 'receipt$', 'i').test(path))
    )
  )
    throw new UnauthorizedException('PRINT_DEVICE_ROUTE_INVALID');
  const id = req.headers['x-corely-print-device'],
    auth = req.headers.authorization;
  if (
    typeof id !== 'string' ||
    !UUID.test(id) ||
    typeof auth !== 'string' ||
    !/^Bearer [A-Za-z0-9_-]{43}$/.test(auth)
  )
    throw new UnauthorizedException('PRINT_DEVICE_CAPABILITY_INVALID');
  return true;
}

@Injectable()
export class MailroomPrintDeviceGuard implements CanActivate {
  private readonly attempts = new Map<
    string,
    { expires: number; count: number }
  >();
  constructor(
    private readonly reflector: Reflector,
    private readonly service: MailroomPrintService,
  ) {}
  private limitRedeem(req: PrintAuthRequest) {
    const now = Date.now();
    for (const [key, value] of this.attempts)
      if (value.expires <= now) this.attempts.delete(key);
    const ip = req.socket?.remoteAddress || 'unknown';
    const deviceId = req.body?.deviceId;
    if (typeof deviceId !== 'string')
      throw new UnauthorizedException('PRINT_DEVICE_CAPABILITY_INVALID');
    for (const [key, maximum] of [
      ['ip:' + ip, 50],
      ['device:' + deviceId, 8],
    ] as const) {
      let value = this.attempts.get(key);
      if (!value) {
        if (this.attempts.size >= 2048) {
          const oldest = [...this.attempts.keys()][0];
          if (oldest !== undefined) this.attempts.delete(oldest);
        }
        value = { expires: now + 5 * 60_000, count: 0 };
        this.attempts.set(key, value);
      }
      if (++value.count > maximum)
        throw new HttpException('PRINT_PAIR_RATE_LIMITED', 429);
    }
  }
  async canActivate(context: ExecutionContext) {
    const mode = Reflect.getOwnMetadata(
      MAILROOM_PRINT_DEVICE_AUTH,
      context.getHandler(),
    ) as PrintDeviceAuthMode | undefined;
    const req = context.switchToHttp().getRequest<PrintAuthRequest>();
    assertPrintDeviceRoute(req, mode);
    if (mode === 'redeem') {
      this.limitRedeem(req);
      req.printRedeem = await this.service.authorizeRedeem(
        req.body!.deviceId as string,
        req.body!.code as string,
      );
    } else
      req.printDevice = await this.service.authenticateDevice(
        req.headers['x-corely-print-device'] as string,
        (req.headers.authorization as string).slice(7),
      );
    return true;
  }
}
export const MailroomPrintDeviceAuth = (mode: PrintDeviceAuthMode = 'device') =>
  SetMetadata(MAILROOM_PRINT_DEVICE_AUTH, mode);
