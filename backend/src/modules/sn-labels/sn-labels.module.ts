import { Module } from '@nestjs/common';
import { SnLabelsService } from './sn-labels.service';
import { SnLabelsController } from './sn-labels.controller';
import { SnLabelsExport } from './sn-labels.export';
@Module({
  controllers: [SnLabelsController],
  providers: [SnLabelsService, SnLabelsExport],
})
export class SnLabelsModule {}
