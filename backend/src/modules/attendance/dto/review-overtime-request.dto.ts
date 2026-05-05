import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';

export const overtimeReviewActions = [
  'approve_manager',
  'approve_final',
  'reject',
] as const;

export class ReviewOvertimeRequestDto {
  @ApiProperty({
    description: '審核動作',
    enum: overtimeReviewActions,
  })
  @IsIn(overtimeReviewActions)
  action!: (typeof overtimeReviewActions)[number];

  @ApiProperty({
    description: '審核備註',
    required: false,
  })
  @IsOptional()
  @IsString()
  note?: string;
}
