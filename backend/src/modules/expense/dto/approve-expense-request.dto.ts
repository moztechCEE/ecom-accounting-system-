import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsUUID,
  IsOptional,
  IsString,
  IsObject,
  IsArray,
  ValidateNested,
  IsDate,
} from 'class-validator';
import { EvidenceFileDto } from './create-expense-request.dto';

export class ApproveExpenseRequestDto {
  @IsString()
  approvalStepId?: string;

  @ApiPropertyOptional({ description: '覆核後的最終會計科目 ID' })
  @IsOptional()
  @IsUUID()
  finalAccountId?: string;

  @ApiPropertyOptional({
    description: '若覆核人有重新指定科目，紀錄原因或備註',
  })
  @IsOptional()
  @IsString()
  remark?: string;

  @ApiPropertyOptional({ description: '補充資料 JSON' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @ApiPropertyOptional({ description: '補充附件', type: [EvidenceFileDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EvidenceFileDto)
  attachments?: EvidenceFileDto[];

  @ApiPropertyOptional({ description: '審批完成時間，預設為目前時間' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  decidedAt?: Date;
}
