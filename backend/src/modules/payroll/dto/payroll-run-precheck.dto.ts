import { ApiProperty } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsString } from 'class-validator';

export class PayrollRunPrecheckDto {
  @ApiProperty({
    description: '法人 / 帳套 ID',
    required: false,
  })
  @IsOptional()
  @IsString()
  entityId?: string;

  @ApiProperty({ description: '計薪期間開始日' })
  @IsISO8601()
  periodStart!: string;

  @ApiProperty({ description: '計薪期間結束日' })
  @IsISO8601()
  periodEnd!: string;

  @ApiProperty({
    description: '預計發薪日',
    required: false,
  })
  @IsOptional()
  @IsISO8601()
  payDate?: string;
}
