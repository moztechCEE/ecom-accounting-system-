import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

export class MailroomLabelQuery {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/)
  entityId!: string;
}
