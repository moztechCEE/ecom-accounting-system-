import { Controller, Get, Header, Param, Req } from '@nestjs/common';
import { MailroomServiceAuth } from './mailroom.auth';
import { RepairAssessmentReaderService } from './repair-assessment-reader.service';

@Controller('mailroom/integration/cases')
export class RepairAssessmentReaderController {
  constructor(private readonly reader: RepairAssessmentReaderService) {}
  @MailroomServiceAuth()
  @Get(':sourceCaseId/repair-assessments')
  @Header('Cache-Control', 'no-store')
  @Header('Content-Type', 'application/json')
  read(
    @Req() req: { mailroomEntityId: string },
    @Param('sourceCaseId') sourceCaseId: string,
  ) {
    return this.reader.read(req.mailroomEntityId, sourceCaseId);
  }
}
