import 'reflect-metadata';
import { Global, Module } from '@nestjs/common';
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
import { MailroomLabelService } from '../mailroom-label.service';
import { MailroomLabelExport } from '../mailroom-label.export';
import { MailroomSourceSyncService } from '../mailroom-source-sync.service';
import { MailroomSyncService } from '../mailroom-sync.service';
import { RepairMediaStorageService } from '../repair-media-storage.service';
import { MailroomPrintDeviceGuard } from './mailroom-print.auth';
import { MailroomPrintController } from './mailroom-print.controller';
import { MailroomPrintService } from './mailroom-print.service';

describe('actual MailroomModule print provider/export graph, compile only', () => {
  it('injects the one exported device verifier and its one real module print service into the global guard', async () => {
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
