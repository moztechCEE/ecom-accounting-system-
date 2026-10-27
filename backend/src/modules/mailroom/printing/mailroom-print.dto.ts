import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { MailroomLabelQuery } from '../mailroom-label.dto';
import {
  CAPABILITY,
  ERROR_CODES,
  RECEIPT_STATES,
  type ReceiptState,
} from './mailroom-print.contract';

export class PrintEntityDto extends MailroomLabelQuery {}
export class PairPrintDeviceDto extends PrintEntityDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  name!: string;
}
class LabelDisplayFieldsDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(1)
  expectedVersion?: number;
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(64)
  caseNumber?: string;
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(80)
  customerName?: string;
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(40)
  customerPhone?: string;
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(120)
  productName?: string;
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(300)
  customerIssue?: string;
}
export class PreviewLabelEditDto extends LabelDisplayFieldsDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsUUID()
  itemId?: string;
}
export class PrintLabelEditDto extends LabelDisplayFieldsDto {
  @IsUUID()
  itemId!: string;
}
export class PreviewPrintLabelDto extends PrintEntityDto {
  @IsUUID() itemId!: string;
  @ValidateIf((_object, value) => value !== undefined)
  @ValidateNested()
  @Type(() => PreviewLabelEditDto)
  labelEdit?: PreviewLabelEditDto;
}
export class CreatePrintJobDto extends PrintEntityDto {
  @IsUUID() deviceId!: string;
  @IsUUID() requestId!: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  itemIds!: string[];
  @ValidateIf((_object, value) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => PrintLabelEditDto)
  labelEdits?: PrintLabelEditDto[];
  @IsOptional() @IsUUID() reprintOf?: string;
}
export class RedeemPrintDeviceDto {
  @IsUUID() deviceId!: string;
  @IsString() @Matches(CAPABILITY) code!: string;
}
export class PrintDevicePollDto {}
export class PrintReceiptDto {
  @IsIn(RECEIPT_STATES) state!: ReceiptState;
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Matches(/^Xprinter_XP-235B-[1-9][0-9]*$/)
  cupsJobId?: string;
  @IsOptional() @IsIn(ERROR_CODES) errorCode?: (typeof ERROR_CODES)[number];
}
