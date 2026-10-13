import { Test } from '@nestjs/testing';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationGateway } from '../notification/notification.gateway';
import { MailroomService } from './mailroom.service';
import { MailroomSyncService } from './mailroom-sync.service';
import { RepairPrerequisitesService } from './repair-prerequisites.service';
import { RepairTestRegistryService } from './repair-test-registry.service';
import { RepairMaterialsService } from './repair-materials.service';

describe('central repair provider wiring', () => {
  it('resolves the real work prerequisites cycle without a ready fixture provider', async () => {
    const module = await Test.createTestingModule({ providers: [
      MailroomService, RepairPrerequisitesService, RepairTestRegistryService,
      RepairMaterialsService,
      { provide: PrismaService, useValue: {} },
      { provide: NotificationGateway, useValue: {} },
      { provide: MailroomSyncService, useValue: {} },
    ] }).compile();
    expect(module.get(MailroomService)).toBeInstanceOf(MailroomService);
    expect(module.get(RepairPrerequisitesService)).toBeInstanceOf(RepairPrerequisitesService);
    expect(module.get(RepairMaterialsService)).toBeInstanceOf(RepairMaterialsService);
    await module.close();
  });
});
