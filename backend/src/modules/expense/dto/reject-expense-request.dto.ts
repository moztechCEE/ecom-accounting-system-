import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsString,
  IsOptional,
  IsObject,
  IsArray,
  ValidateNested,
  IsDate,
} from 'class-validator';
import { EvidenceFileDto } from './create-expense-request.dto';

export class RejectExpenseRequestDto {
  @IsString()
  approvalStepId?: string;

  @ApiProperty({ description: '駁回原因' })
  @IsString()
  reason!: string;

  @ApiProperty({ description: '補充說明', required: false })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiProperty({ description: '額外元資料 JSON', required: false })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @ApiProperty({
    description: '相關附件',
    required: false,
    type: [EvidenceFileDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EvidenceFileDto)
  attachments?: EvidenceFileDto[];

  @ApiProperty({ description: '審批時間，預設為目前時間', required: false })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  decidedAt?: Date;
}
