import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsInt, IsString, Min } from 'class-validator';

export class CreateOvertimeRequestDto {
  @ApiProperty({ description: '加班日期', example: '2026-05-05' })
  @IsDateString()
  workDate!: string;

  @ApiProperty({ description: '申請分鐘數，需為 30 分鐘倍數', example: 90 })
  @IsInt()
  @Min(30)
  requestedMinutes!: number;

  @ApiProperty({ description: '加班原因' })
  @IsString()
  reason!: string;
}
