import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Ga4Adapter } from './ga4.adapter';
import { Ga4Controller } from './ga4.controller';
import { Ga4Service } from './ga4.service';

@Module({
  imports: [ConfigModule],
  controllers: [Ga4Controller],
  providers: [Ga4Adapter, Ga4Service],
  exports: [Ga4Service],
})
export class Ga4IntegrationModule {}
