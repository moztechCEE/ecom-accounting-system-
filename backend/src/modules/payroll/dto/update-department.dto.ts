import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class UpdateDepartmentDto {
  @IsOptional() @IsString()
  memberRoleId?: string | null;

  @IsOptional() @IsString()
  supervisorRoleId?: string | null;

  @ApiPropertyOptional({ description: '部門名稱' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: '成本中心代碼' })
  @IsOptional()
  @IsString()
  costCenterId?: string;

  @ApiPropertyOptional({ description: '是否啟用' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
