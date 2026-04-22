import {
  IsArray,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class LeaveRequestDocumentDto {
  @IsNotEmpty()
  @IsString()
  fileName: string;

  @IsOptional()
  @IsString()
  fileUrl?: string;

  @IsOptional()
  @IsString()
  mimeType?: string;

  @IsOptional()
  @IsString()
  docType?: string;

  @IsOptional()
  @IsString()
  checksum?: string;
}

export class CreateLeaveRequestDto {
  @IsNotEmpty()
  @IsString()
  leaveTypeId: string;

  @IsNotEmpty()
  @IsDateString()
  startAt: string;

  @IsNotEmpty()
  @IsDateString()
  endAt: string;

  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  hours: number;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsIn([
    'PARENT_OR_SPOUSE',
    'GRANDPARENT_CHILD_OR_SPOUSE_PARENT',
    'GREAT_GRANDPARENT_SIBLING_OR_SPOUSE_GRANDPARENT',
  ])
  funeralRelationship?: string;

  @IsOptional()
  @IsString()
  deceasedName?: string;

  @IsOptional()
  @IsDateString()
  deceasedDate?: string;

  @IsOptional()
  @IsString()
  funeralEventKey?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LeaveRequestDocumentDto)
  documents?: LeaveRequestDocumentDto[];
}
