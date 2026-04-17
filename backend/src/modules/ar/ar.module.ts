import { Module } from '@nestjs/common';
import { ArController } from './ar.controller';
import { ArService } from './ar.service';
import { ArRepository } from './ar.repository';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { AccountingModule } from '../accounting/accounting.module';

@Module({
  imports: [PrismaModule, AccountingModule],
  controllers: [ArController],
  providers: [ArService, ArRepository],
  exports: [ArService],
})
export class ArModule {}
