import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
} from 'class-validator';

export class RunComputerUseTaskDto {
  @ApiProperty({
    description: '要交給 GPT 執行的任務描述',
    example: '打開首頁，檢查 console error，並說明目前登入流程卡在哪裡。',
  })
  @IsString()
  task!: string;

  @ApiPropertyOptional({
    description: '任務開始前先導向的網址',
    example: 'http://localhost:5173',
  })
  @IsOptional()
  @IsUrl({
    require_tld: false,
    require_protocol: true,
  })
  startUrl?: string;

  @ApiPropertyOptional({
    description: '使用的 OpenAI model，預設 gpt-5.5',
    example: 'gpt-5.5',
  })
  @IsOptional()
  @IsString()
  model?: string;

  @ApiPropertyOptional({
    description: '最多讓模型執行幾輪操作',
    example: 12,
    default: 12,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  maxSteps?: number;

  @ApiPropertyOptional({
    description: '本次任務額外允許的網域白名單',
    example: ['localhost', '127.0.0.1'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedDomains?: string[];
}
