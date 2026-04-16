import { ApiProperty } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsUUID } from 'class-validator';

export class PayPayrollRunDto {
  @ApiProperty({ description: '出款銀行帳戶 ID' })
  @IsUUID()
  bankAccountId!: string;

  @ApiProperty({
    description: '實際發薪時間（可選，預設為現在）',
    required: false,
  })
  @IsOptional()
  @IsISO8601()
  paidAt?: string;
}
