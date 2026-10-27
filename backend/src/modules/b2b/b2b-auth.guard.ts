import {
  MAILROOM_SERVICE_AUTH,
  authenticateMailroomReader,
} from '../mailroom/mailroom.auth';
import { ERP_AFTER_SALES_SERVICE_AUTH } from '../integration/after-sales/erp-module.contract';
import {
  WMS_HANDOVER_AUTH,
  authenticateWmsHandover,
} from '../integration/wms/wms-handover.auth';
import {
  ExecutionContext,
  Injectable,
  Optional,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { B2bService } from './b2b.service';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import {
  MAILROOM_PRINT_DEVICE_AUTH,
  MailroomPrintDeviceGuard,
} from '../mailroom/printing/mailroom-print.auth';

const B2B_AUTH_MODE = 'b2bAuthMode';
export const B2bSession = () => SetMetadata(B2B_AUTH_MODE, 'session');
export const B2bLogin = () => SetMetadata(B2B_AUTH_MODE, 'login');

// Existing employee/public policy stays intact. Only explicitly decorated portal
// handlers use customer sessions, including in the otherwise closed DEV sandbox.
@Injectable()
export class B2bAwareJwtAuthGuard extends JwtAuthGuard {
  constructor(
    private readonly b2bReflector: Reflector,
    private readonly b2b: B2bService,
    @Optional() private readonly printDevice?: MailroomPrintDeviceGuard,
  ) {
    super(b2bReflector);
  }
  canActivate(context: ExecutionContext) {
    const handler = context.getHandler(),
      controller = context.getClass();
    if (
      Reflect.hasMetadata(MAILROOM_PRINT_DEVICE_AUTH, handler) ||
      Reflect.hasMetadata(MAILROOM_PRINT_DEVICE_AUTH, controller)
    ) {
      const mode: unknown = Reflect.getOwnMetadata(
        MAILROOM_PRINT_DEVICE_AUTH,
        handler,
      );
      const mixed = [
        IS_PUBLIC_KEY,
        ERP_AFTER_SALES_SERVICE_AUTH,
        WMS_HANDOVER_AUTH,
        MAILROOM_SERVICE_AUTH,
        B2B_AUTH_MODE,
      ].some(
        (key) =>
          Reflect.hasMetadata(key, handler) ||
          Reflect.hasMetadata(key, controller),
      );
      if (
        !Reflect.hasOwnMetadata(MAILROOM_PRINT_DEVICE_AUTH, handler) ||
        Reflect.hasMetadata(MAILROOM_PRINT_DEVICE_AUTH, controller) ||
        (mode !== 'device' && mode !== 'redeem') ||
        mixed ||
        !this.printDevice
      )
        throw new UnauthorizedException(
          'PRINT_DEVICE_AUTH_CONFIGURATION_INVALID',
        );
      // Fully await the single shared device verifier before any handler or business read.
      return (async () => {
        if (!(await this.printDevice!.canActivate(context)))
          throw new UnauthorizedException('PRINT_DEVICE_CAPABILITY_INVALID');
        return true;
      })();
    }
    // This one handler authenticates its exact GET path and signature in the controller service.
    if (this.b2bReflector.getAllAndOverride<boolean>(ERP_AFTER_SALES_SERVICE_AUTH, [context.getHandler(), context.getClass()])) return true;
    if (this.b2bReflector.getAllAndOverride<boolean>(WMS_HANDOVER_AUTH, [context.getHandler(), context.getClass()])) {
      return authenticateWmsHandover(context.switchToHttp().getRequest());
    }
    if (this.b2bReflector.getAllAndOverride<boolean>(MAILROOM_SERVICE_AUTH, [context.getHandler(), context.getClass()])) {
      return authenticateMailroomReader(context.switchToHttp().getRequest());
    }
    const mode = this.b2bReflector.getAllAndOverride<string>(B2B_AUTH_MODE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (mode === 'login') {
      this.b2b.ensureEnabled();
      return true;
    }
    if (mode === 'session') {
      const req = context.switchToHttp().getRequest();
      return this.b2b
        .authenticate(req.headers.authorization)
        .then((identity) => {
          req.b2b = identity;
          return true;
        });
    }
    return super.canActivate(context);
  }
}
