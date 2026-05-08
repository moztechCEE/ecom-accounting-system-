import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../../common/prisma/prisma.module';
import { MetaAdsAdapter } from './meta-ads.adapter';
import { MetaAdsController } from './meta-ads.controller';
import { MetaAdsService } from './meta-ads.service';

@Module({
  imports: [ConfigModule, PrismaModule],
  controllers: [MetaAdsController],
  providers: [MetaAdsAdapter, MetaAdsService],
  exports: [MetaAdsService],
})
export class MetaAdsIntegrationModule {}
