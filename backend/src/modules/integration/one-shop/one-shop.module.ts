import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../../common/prisma/prisma.module';
import { OneShopController } from './one-shop.controller';
import { OneShopService } from './one-shop.service';
import { OneShopHttpAdapter } from './one-shop.adapter';

@Module({
  imports: [ConfigModule, PrismaModule],
  controllers: [OneShopController],
  providers: [OneShopService, OneShopHttpAdapter],
  exports: [OneShopService],
})
export class OneShopIntegrationModule {}
