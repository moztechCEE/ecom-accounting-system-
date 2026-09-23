import { Type } from 'class-transformer';
import { IsString, IsEnum, IsOptional, IsNumber, Min, IsDate } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpdatePaymentInfoDto {
  @IsOptional()
  @IsString()
  bankAccountId?: string;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  amount?: number;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  paymentDate?: Date;

  @ApiPropertyOptional({ description: '付款方式 (現金, 銀行轉帳, 支票, 其他)' })
  @IsString()
  @IsOptional()
  paymentMethod?: string;

  @ApiProperty({ description: '付款狀態 (pending, processing, paid)', enum: ['pending', 'processing', 'paid'] })
  @IsString()
  @IsEnum(['pending', 'processing', 'paid'])
  paymentStatus: string;

  @ApiPropertyOptional({ description: '付款銀行名稱' })
  @IsString()
  @IsOptional()
  paymentBankName?: string;

  @ApiPropertyOptional({ description: '付款帳號末五碼' })
  @IsString()
  @IsOptional()
  paymentAccountLast5?: string;
}
