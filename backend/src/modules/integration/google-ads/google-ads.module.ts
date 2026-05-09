import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../../common/prisma/prisma.module';
import { GoogleAdsAdapter } from './google-ads.adapter';
import { GoogleAdsController } from './google-ads.controller';
import { GoogleAdsService } from './google-ads.service';

@Module({
  imports: [ConfigModule, PrismaModule],
  controllers: [GoogleAdsController],
  providers: [GoogleAdsAdapter, GoogleAdsService],
  exports: [GoogleAdsService],
})
export class GoogleAdsIntegrationModule {}
