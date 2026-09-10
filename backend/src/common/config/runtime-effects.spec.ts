import { Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Cron, Interval, ScheduleModule, SchedulerRegistry, Timeout } from '@nestjs/schedule';
import { runtimeScheduleOptions, seedOnStartupEnabled } from './runtime-effects';
import { SeederService } from '../database/seeder.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
class FixtureJobs {
  @Cron('0 0 * * *', { name: 'fixture-cron' }) cron() { throw new Error('Must not run'); }
  @Interval('fixture-interval', 86_400_000) interval() { throw new Error('Must not run'); }
  @Timeout('fixture-timeout', 86_400_000) timeout() { throw new Error('Must not run'); }
}

describe('Read-only canary runtime switches', () => {
  const previousSeed = process.env.SEED_ON_STARTUP;
  afterEach(() => {
    if (previousSeed === undefined) delete process.env.SEED_ON_STARTUP;
    else process.env.SEED_ON_STARTUP = previousSeed;
  });

  it('preserves existing defaults and rejects invalid switch values', () => {
    expect(seedOnStartupEnabled({})).toBe(true);
    expect(runtimeScheduleOptions({})).toEqual({ cronJobs:true, intervals:true, timeouts:true });
    expect(seedOnStartupEnabled({ SEED_ON_STARTUP:'false' })).toBe(false);
    expect(runtimeScheduleOptions({ RUNTIME_SCHEDULES_ENABLED:'false' })).toEqual({ cronJobs:false, intervals:false, timeouts:false });
    expect(() => seedOnStartupEnabled({ SEED_ON_STARTUP:'off' })).toThrow();
    expect(() => runtimeScheduleOptions({ RUNTIME_SCHEDULES_ENABLED:'off' })).toThrow();
  });

  it('does not enter seed or access Prisma when explicitly disabled', async () => {
    process.env.SEED_ON_STARTUP = 'false';
    const prisma = new Proxy({}, { get() { throw new Error('No database access allowed'); } });
    const service = new SeederService(prisma as PrismaService);
    const seed = jest.spyOn(service, 'seed');
    await service.onModuleInit();
    expect(seed).not.toHaveBeenCalled();
  });

  it('keeps the legacy seed path when switch is omitted', async () => {
    delete process.env.SEED_ON_STARTUP;
    const service = new SeederService({} as PrismaService);
    const seed = jest.spyOn(service, 'seed').mockResolvedValue(undefined);
    await service.onModuleInit();
    expect(seed).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])('actual Nest schedule registry with runtime effects %p', async (run) => {
    const module = await Test.createTestingModule({
      imports:[ScheduleModule.forRoot(runtimeScheduleOptions({ RUNTIME_SCHEDULES_ENABLED:String(run) }))],
      providers:[FixtureJobs],
    }).compile();
    try {
      await module.init();
      const registry = module.get(SchedulerRegistry);
      expect(registry.getCronJobs().size).toBe(run ? 1 : 0);
      expect(registry.getIntervals().length).toBe(run ? 1 : 0);
      expect(registry.getTimeouts().length).toBe(run ? 1 : 0);
    } finally {
      await module.close();
    }
  });
});
