import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
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
export class CreatePrintJobDto extends PrintEntityDto {
  @IsUUID() deviceId!: string;
  @IsUUID() requestId!: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  itemIds!: string[];
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
