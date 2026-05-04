import { ApiProperty } from '@nestjs/swagger';
import { IsUrl } from 'class-validator';

export class NavigateComputerUseSessionDto {
  @ApiProperty({
    description: '要導向的網址',
    example: 'http://localhost:5173',
  })
  @IsUrl({
    require_tld: false,
    require_protocol: true,
  })
  url!: string;
}
