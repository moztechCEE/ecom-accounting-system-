import {
  Equals,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

export class ReceiveReturnStockDto {
  @IsString() @IsNotEmpty() entityId!: string;
  @IsUUID() sourceItemId!: string;
  @IsUUID() productId!: string;
  @IsUUID() warehouseId!: string;
  @IsUUID() requestId!: string;
  @IsInt() @Min(1) expectedVersion!: number;
  @IsInt() @Equals(1) quantity!: number;
  @IsBoolean() @Equals(true) confirmedItems!: boolean;
  @IsString() @IsNotEmpty() @MaxLength(160) sourceLocation!: string;
  @IsString() @IsNotEmpty() @MaxLength(160) location!: string;
  @IsString() @IsNotEmpty() @MaxLength(100) unitLabel!: string;
  @IsOptional() @IsString() @MaxLength(100) serialNumber?: string;
  @IsString() @IsNotEmpty() @MaxLength(500) ownershipReference!: string;
  @IsString() @IsNotEmpty() @MaxLength(500) inspectionReference!: string;
}
