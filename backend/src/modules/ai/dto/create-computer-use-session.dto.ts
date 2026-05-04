import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
} from 'class-validator';

export class CreateComputerUseSessionDto {
  @ApiPropertyOptional({
    description: '建立 session 後先開啟的網址',
    example: 'https://example.com',
  })
  @IsOptional()
  @IsUrl({
    require_tld: false,
    require_protocol: true,
  })
  startUrl?: string;

  @ApiPropertyOptional({
    description: '瀏覽器寬度',
    example: 1440,
    default: 1440,
  })
  @IsOptional()
  @IsInt()
  @Min(800)
  @Max(2560)
  viewportWidth?: number;

  @ApiPropertyOptional({
    description: '瀏覽器高度',
    example: 900,
    default: 900,
  })
  @IsOptional()
  @IsInt()
  @Min(600)
  @Max(1600)
  viewportHeight?: number;

  @ApiPropertyOptional({
    description: '允許操作的網域白名單；留空代表不限制',
    example: ['localhost', 'example.com'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedDomains?: string[];

  @ApiPropertyOptional({
    description: '是否以 headless 模式啟動瀏覽器',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  headless?: boolean;
}
