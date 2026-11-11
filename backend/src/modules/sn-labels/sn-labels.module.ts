import { Module } from '@nestjs/common';
import { SnLabelsService } from './sn-labels.service';
import { SnLabelsController } from './sn-labels.controller';
import { SnLabelsExport } from './sn-labels.export';
import { SnLabelBatchReviewService } from './sn-label-batch-review';
@Module({
  controllers: [SnLabelsController],
  providers: [SnLabelsService, SnLabelsExport, SnLabelBatchReviewService],
})
export class SnLabelsModule {}
