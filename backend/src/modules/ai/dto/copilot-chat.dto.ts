import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class CopilotHistoryDto {
  @IsIn(['user'])
  role: 'user';

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  content: string;
}

export class CopilotChatDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  @Matches(/\S/)
  message: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  entityId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  modelId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  @Matches(/^\/[a-zA-Z0-9/_-]*$/)
  currentPath?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @ValidateNested({ each: true })
  @Type(() => CopilotHistoryDto)
  history?: CopilotHistoryDto[];
}

export class CopilotGuideDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  query?: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  @Matches(/^\/[a-zA-Z0-9/_-]*$/)
  currentPath?: string;
}

export class DailyBriefingDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Matches(/\S/)
  entityId: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  modelId?: string;
}
