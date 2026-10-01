import type { NestExpressApplication } from '@nestjs/platform-express';
/** A synthetic localhost preview: never imported by AppModule or production builds. */
import 'reflect-metadata';
import {
  Controller,
  Get,
  Module,
  Req,
  ValidationPipe,
  UnauthorizedException,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from '../src/modules/auth/auth.service';
import { MailroomTabletController } from '../src/modules/mailroom/mailroom-tablet.controller';
import { MailroomTabletService } from '../src/modules/mailroom/mailroom-tablet.service';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { MailroomController } from '../src/modules/mailroom/mailroom.controller';
import { MailroomService } from '../src/modules/mailroom/mailroom.service';
import { MailroomSyncService } from '../src/modules/mailroom/mailroom-sync.service';
import { NotificationGateway } from '../src/modules/notification/notification.gateway';
import { requireLocalFixture, seedMailroom } from './mailroom-local-fixture';
requireLocalFixture();
const db = new PrismaService();
const sync = new MailroomSyncService(db);
const service = new MailroomService(
  db,
  { sendToUser: () => {} } as unknown as NotificationGateway,
  sync,
);
const fixtureAuth = new AuthService(
  {} as any,
  new JwtService({ secret: 'local-mailroom-fixture-only-signing-key' }),
  new ConfigService(),
  {} as any,
  db,
);
const tablet = new MailroomTabletService(db, service, fixtureAuth);
@Controller()
class FixtureController {
  @Get('users/me') async me(@Req() req: any) {
    const actor = await service.actor(req.user.id);
    const user = await db.user.findUniqueOrThrow({
      where: { id: actor.id },
      include: { roles: { include: { role: true } } },
    });
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      roles: user.roles,
      effectivePermissions: [...actor.permissions],
      isActive: true,
      mustChangePassword: false,
    };
  }
  @Get('notifications') notifications(@Req() req: any) {
    return db.notification.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
    });
  }
  @Get('ai/models') status() {
    return [];
  }
}
@Module({
  controllers: [
    MailroomController,
    MailroomTabletController,
    FixtureController,
  ],
  providers: [
    { provide: MailroomService, useValue: service },
    { provide: MailroomTabletService, useValue: tablet },
  ],
})
class FixtureModule {}
async function main() {
  await db.$connect();
  await seedMailroom(db);
  const app = await NestFactory.create<NestExpressApplication>(FixtureModule, {
    logger: ['error', 'warn'],
  });
  app.setGlobalPrefix('api/v1');
  app.useBodyParser('json', { limit: '6mb' });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalGuards({
    canActivate(context) {
      const req = context.switchToHttp().getRequest();
      const id = String(req.headers.authorization || '').replace(
        /^Bearer /,
        '',
      );
      if (
        ![
          'fixture-mail',
          'fixture-repair',
          'fixture-review',
          'fixture-person',
          'fixture-outsider',
        ].includes(id)
      )
        throw new UnauthorizedException();
      req.user = { id };
      return true;
    },
  });
  await app.listen(57644, '127.0.0.1');
  console.log('Synthetic workbench API on 127.0.0.1:57644');
  // Use the real delivery worker against the guarded localhost fixture endpoints.
  let deliveryBusy = false;
  const deliveryTimer = setInterval(() => {
    if (deliveryBusy) return;
    deliveryBusy = true;
    void sync
      .deliverPending()
      .catch((error) =>
        console.error('Local fixture delivery failed', error.message),
      )
      .finally(() => {
        deliveryBusy = false;
      });
  }, 3000);

  process.on('SIGINT', () => {
    clearInterval(deliveryTimer);
    void app
      .close()
      .then(() => db.$disconnect())
      .then(() => process.exit(0));
  });
}
void main();
