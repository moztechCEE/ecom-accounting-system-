import { IsDateString, IsString, Matches } from 'class-validator';

export class AssignLegacyApprovalDto {
  @IsDateString()
  expectedUpdatedAt!: string;

  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  routeToken!: string;
}
