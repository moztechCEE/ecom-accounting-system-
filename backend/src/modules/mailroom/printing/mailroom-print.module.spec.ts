import 'reflect-metadata';
import { Global, Module, type ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModulesContainer } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { AuthModule } from '../../auth/auth.module';
import { AuthService } from '../../auth/auth.service';
import { B2bAwareJwtAuthGuard } from '../../b2b/b2b-auth.guard';
import { B2bService } from '../../b2b/b2b.service';
import { NotificationModule } from '../../notification/notification.module';
import { NotificationService } from '../../notification/notification.service';
import { NotificationGateway } from '../../notification/notification.gateway';
import { AfterSalesStockModule } from '../../integration/after-sales/after-sales-stock.module';
import { AfterSalesStockService } from '../../integration/after-sales/after-sales-stock.service';
import { AfterSalesIntegrationModule } from '../../integration/after-sales/after-sales.module';
import { ErpAfterSalesModuleService } from '../../integration/after-sales/erp-module.service';
import { MailroomModule } from '../mailroom.module';
import { MailroomService } from '../mailroom.service';
import { MailroomPrecheckController } from '../mailroom-precheck.controller';
import { MailroomPrecheckService } from '../mailroom-precheck.service';
import { RepairAssessmentReaderController } from '../repair-assessment-reader.controller';
import { RepairAssessmentReaderService } from '../repair-assessment-reader.service';
import {
  MAILROOM_SERVICE_AUTH,
  type MailroomReaderRequest,
} from '../mailroom.auth';
import { signRequest } from '../mailroom.contract';
import { MailroomLabelController } from '../mailroom-label.controller';
import { MailroomLabelService } from '../mailroom-label.service';
import { MailroomLabelExport } from '../mailroom-label.export';
import { MailroomSourceSyncService } from '../mailroom-source-sync.service';
import { MailroomSyncService } from '../mailroom-sync.service';
import { RepairMediaStorageService } from '../repair-media-storage.service';
import {
  MAILROOM_PRINT_DEVICE_AUTH,
  MailroomPrintDeviceGuard,
} from './mailroom-print.auth';
import { MailroomPrintController } from './mailroom-print.controller';
import { MailroomPrintService } from './mailroom-print.service';

describe('actual MailroomModule reader/precheck/print union, compile only', () => {
  it('shares its real reader, precheck, label and exported device providers and routes the reader through HMAC', async () => {
    const forbidden = jest.fn(() => {
      throw new Error(
        'compile-only DI test attempted I/O or an imported business operation',
      );
    });
    const db = {
      $connect: forbidden,
      $disconnect: forbidden,
      $transaction: forbidden,
    };
    const syncInit = jest.spyOn(MailroomSyncService.prototype, 'onModuleInit');
    const sourceInit = jest.spyOn(
      MailroomSourceSyncService.prototype,
      'onModuleInit',
    );
    const fetch = jest.spyOn(globalThis, 'fetch').mockImplementation(forbidden);

    @Global()
    @Module({
      providers: [
        { provide: PrismaService, useValue: db },
        { provide: ConfigService, useValue: { get: () => undefined } },
      ],
      exports: [PrismaService, ConfigService],
    })
    class CompileOnlyGlobals {}

    @Module({
      providers: [{ provide: AuthService, useValue: {} }],
      exports: [AuthService],
    })
    class CompileOnlyAuth {}
    @Module({
      providers: [
        { provide: NotificationService, useValue: { send: forbidden } },
        { provide: NotificationGateway, useValue: { sendToUser: forbidden } },
      ],
      exports: [NotificationService, NotificationGateway],
    })
    class CompileOnlyNotifications {}
    @Module({
      providers: [{ provide: AfterSalesStockService, useValue: {} }],
      exports: [AfterSalesStockService],
    })
    class CompileOnlyStock {}
    @Module({
      providers: [{ provide: ErpAfterSalesModuleService, useValue: {} }],
      exports: [ErpAfterSalesModuleService],
    })
    class CompileOnlySource {}

    // MailroomModule itself is not replaced or reconstructed. Its actual providers,
    // controllers, circular dependencies and exported guard are compiled by Nest.
    const builder = Test.createTestingModule({
      imports: [CompileOnlyGlobals, MailroomModule],
      providers: [B2bAwareJwtAuthGuard, { provide: B2bService, useValue: {} }],
    })
      .overrideModule(AuthModule)
      .useModule(CompileOnlyAuth)
      .overrideModule(NotificationModule)
      .useModule(CompileOnlyNotifications)
      .overrideModule(AfterSalesStockModule)
      .useModule(CompileOnlyStock)
      .overrideModule(AfterSalesIntegrationModule)
      .useModule(CompileOnlySource)
      .overrideProvider(RepairMediaStorageService)
      .useValue({});
    let compiled: Awaited<ReturnType<typeof builder.compile>> | undefined;
    try {
      compiled = await builder.compile();
      const mailroom = compiled.select(MailroomModule);
      const deviceGuard = mailroom.get(MailroomPrintDeviceGuard, {
        strict: true,
      });
      const printService = mailroom.get(MailroomPrintService, { strict: true });
      const reader = mailroom.get(RepairAssessmentReaderService, {
        strict: true,
      });
      const readerController = mailroom.get(RepairAssessmentReaderController, {
        strict: true,
      });
      const prechecks = mailroom.get(MailroomPrecheckService, { strict: true });
      const precheckController = mailroom.get(MailroomPrecheckController, {
        strict: true,
      });
      const labels = mailroom.get(MailroomLabelService, { strict: true });
      const exporter = mailroom.get(MailroomLabelExport, { strict: true });
      const labelController = mailroom.get(MailroomLabelController, {
        strict: true,
      });
      const controller = mailroom.get(MailroomPrintController, {
        strict: true,
      });
      const globalGuard = compiled.get(B2bAwareJwtAuthGuard);
      expect(deviceGuard).toBeInstanceOf(MailroomPrintDeviceGuard);
      expect(printService).toBeInstanceOf(MailroomPrintService);
      expect(
        (globalGuard as unknown as { printDevice: unknown }).printDevice,
      ).toBe(deviceGuard);
      expect((deviceGuard as unknown as { service: unknown }).service).toBe(
        printService,
      );
      expect((controller as unknown as { service: unknown }).service).toBe(
        printService,
      );
      expect((printService as unknown as { labels: unknown }).labels).toBe(
        mailroom.get(MailroomLabelService, { strict: true }),
      );
      expect((printService as unknown as { exporter: unknown }).exporter).toBe(
        mailroom.get(MailroomLabelExport, { strict: true }),
      );
      expect(reader).toBeInstanceOf(RepairAssessmentReaderService);
      expect((readerController as unknown as { reader: unknown }).reader).toBe(
        reader,
      );
      expect((reader as unknown as { prisma: unknown }).prisma).toBe(db);
      expect(
        (precheckController as unknown as { prechecks: unknown }).prechecks,
      ).toBe(prechecks);
      expect((prechecks as unknown as { mailroom: unknown }).mailroom).toBe(
        mailroom.get(MailroomService, { strict: true }),
      );
      expect((labelController as unknown as { labels: unknown }).labels).toBe(
        labels,
      );
      expect(
        (labelController as unknown as { exporter: unknown }).exporter,
      ).toBe(exporter);
      const modules = [...compiled.get(ModulesContainer).values()];
      expect(
        modules.filter((module) => module.providers.has(B2bAwareJwtAuthGuard)),
      ).toHaveLength(1);
      expect(
        modules.filter((module) =>
          module.providers.has(MailroomPrintDeviceGuard),
        ),
      ).toHaveLength(1);
      expect(
        modules.filter((module) => module.providers.has(MailroomPrintService)),
      ).toHaveLength(1);
      expect(
        modules.filter((module) =>
          module.controllers.has(MailroomPrintController),
        ),
      ).toHaveLength(1);
      const actualMailroomModules = modules.filter(
        (module) => module.metatype === MailroomModule,
      );
      expect(actualMailroomModules).toHaveLength(1);
      expect(
        actualMailroomModules[0].exports.has(MailroomPrintDeviceGuard),
      ).toBe(true);
      for (const provider of [
        RepairAssessmentReaderService,
        MailroomPrecheckService,
        MailroomLabelService,
        MailroomLabelExport,
        MailroomService,
      ]) {
        expect(
          modules.filter((module) => module.providers.has(provider)),
        ).toHaveLength(1);
      }
      for (const registeredController of [
        RepairAssessmentReaderController,
        MailroomPrecheckController,
        MailroomLabelController,
      ]) {
        expect(
          modules.filter((module) =>
            module.controllers.has(registeredController),
          ),
        ).toHaveLength(1);
      }

      // Nest reflects on this exact unbound handler; this test never invokes it.
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const handler = RepairAssessmentReaderController.prototype.read;
      expect(Reflect.getOwnMetadata(MAILROOM_SERVICE_AUTH, handler)).toBe(true);
      expect(Reflect.hasMetadata(MAILROOM_PRINT_DEVICE_AUTH, handler)).toBe(
        false,
      );
      const deviceCheck = jest
        .spyOn(deviceGuard, 'canActivate')
        .mockImplementation(forbidden);
      const oldEnabled = process.env.MAILROOM_ENABLED;
      const oldReaders = process.env.MAILROOM_READERS;
      const entityId = 'synthetic-reader-company';
      const secret = 'SYNTHETIC-READER-ONLY-NO-LIVE-SECRET-32-CHARS';
      const path =
        '/api/v1/mailroom/integration/cases/synthetic-case/repair-assessments';
      const timestamp = String(Math.floor(Date.now() / 1000));
      const request = (): MailroomReaderRequest => ({
        method: 'GET',
        originalUrl: path,
        headers: {
          'x-mailroom-key': 'synthetic-reader',
          'x-mailroom-entity': entityId,
          'x-mailroom-time': timestamp,
          'x-mailroom-signature': signRequest(
            secret,
            'GET',
            path,
            timestamp,
            '',
            entityId,
          ),
        },
      });
      const context = (req: MailroomReaderRequest) =>
        ({
          getHandler: () => handler,
          getClass: () => RepairAssessmentReaderController,
          switchToHttp: () => ({ getRequest: () => req }),
        }) as unknown as ExecutionContext;
      try {
        process.env.MAILROOM_ENABLED = 'true';
        process.env.MAILROOM_READERS = JSON.stringify([
          { keyId: 'synthetic-reader', entityId, secret },
        ]);
        const signed = request();
        expect(globalGuard.canActivate(context(signed))).toBe(true);
        expect(signed.mailroomEntityId).toBe(entityId);
        const invalid = request();
        invalid.headers['x-mailroom-signature'] = `sha256=${'0'.repeat(64)}`;
        expect(() => globalGuard.canActivate(context(invalid))).toThrow(
          'MAILROOM_SIGNATURE_INVALID',
        );
        expect(invalid.mailroomEntityId).toBeUndefined();
        // This is the actual reader handler, not a recreated print-controller matrix.
        Reflect.defineMetadata(MAILROOM_PRINT_DEVICE_AUTH, 'device', handler);
        expect(() => globalGuard.canActivate(context(request()))).toThrow(
          'PRINT_DEVICE_AUTH_CONFIGURATION_INVALID',
        );
        expect(deviceCheck).not.toHaveBeenCalled();
      } finally {
        Reflect.deleteMetadata(MAILROOM_PRINT_DEVICE_AUTH, handler);
        if (oldEnabled === undefined) delete process.env.MAILROOM_ENABLED;
        else process.env.MAILROOM_ENABLED = oldEnabled;
        if (oldReaders === undefined) delete process.env.MAILROOM_READERS;
        else process.env.MAILROOM_READERS = oldReaders;
        deviceCheck.mockRestore();
      }
      expect(syncInit).not.toHaveBeenCalled();
      expect(sourceInit).not.toHaveBeenCalled();
      expect(forbidden).not.toHaveBeenCalled();
    } finally {
      // No application or TestingModule init: no database, timer, sync consumer or network lifecycle starts.
      await compiled?.close();
      syncInit.mockRestore();
      sourceInit.mockRestore();
      fetch.mockRestore();
    }
  });
});
