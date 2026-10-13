import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
const raw = Transform(({ obj, key }) => (obj as Record<string, unknown>)[key], {
  toClassOnly: true,
});
export class RepairEvidenceCommand {
  @raw @IsString() @IsNotEmpty() @MaxLength(128) entityId!: string;
  @raw @IsString() @Matches(/^[A-Za-z0-9_-]{8,80}$/) requestId!: string;
  @raw @IsInt() @Min(1) @Max(2147483646) expectedVersion!: number;
}
export class RepairMediaUploadDto extends RepairEvidenceCommand {
  @raw @IsIn(['inspection', 'repair']) kind!: 'inspection' | 'repair';
  @raw @IsIn(['BEFORE', 'AFTER', 'DIAGNOSTIC']) phase!:
    | 'BEFORE'
    | 'AFTER'
    | 'DIAGNOSTIC';
  @raw
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  checkKey?: string;
  @raw
  @IsIn([
    'image/jpeg',
    'image/png',
    'image/webp',
    'video/mp4',
    'video/webm',
    'video/quicktime',
  ])
  contentType!: string;
}
export class RepairReportPublishDto extends RepairEvidenceCommand {
  @raw @IsIn(['inspection', 'repair']) kind!: 'inspection' | 'repair';
  @raw @IsInt() @Min(1) @Max(30) expiresInDays!: number;
}
