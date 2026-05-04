import { plainToInstance } from 'class-transformer';
import {
  IsString,
  IsNumber,
  IsEnum,
  IsBoolean,
  IsOptional,
  validateSync,
} from 'class-validator';

enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

/**
 * EnvironmentVariables
 * 定義並驗證所有必要的環境變數
 * 使用 class-validator 確保環境變數的型別與格式正確
 */
class EnvironmentVariables {
  @IsString()
  DATABASE_URL!: string;

  @IsString()
  JWT_SECRET!: string;

  @IsString()
  JWT_EXPIRES_IN!: string;

  @IsNumber()
  PORT: number = 3000;

  @IsEnum(Environment)
  NODE_ENV: Environment = Environment.Development;

  @IsString()
  CORS_ORIGIN: string = '*';

  @IsString()
  API_PREFIX: string = '/api/v1';

  @IsBoolean()
  SWAGGER_ENABLED: boolean = true;

  @IsString()
  TZ: string = 'Asia/Taipei';

  @IsOptional()
  @IsString()
  SUPER_ADMIN_EMAIL?: string;

  @IsOptional()
  @IsString()
  SUPER_ADMIN_PASSWORD?: string;

  @IsOptional()
  @IsString()
  SUPER_ADMIN_NAME?: string;

  @IsOptional()
  @IsString()
  OPENAI_API_KEY?: string;

  @IsOptional()
  @IsString()
  OPENAI_COMPUTER_USE_MODEL?: string;

  @IsOptional()
  @IsString()
  OPENAI_COMPUTER_USE_ALLOWED_DOMAINS?: string;

  @IsOptional()
  @IsString()
  OPENAI_COMPUTER_USE_MAX_STEPS?: string;

  @IsOptional()
  @IsString()
  OPENAI_COMPUTER_USE_HEADLESS?: string;
}

/**
 * 驗證環境變數
 * @param config - 原始環境變數物件
 * @returns 驗證後的環境變數物件
 * @throws 如果驗證失敗，拋出錯誤
 */
export function validate(config: Record<string, unknown>) {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(errors.toString());
  }

  return validatedConfig;
}
