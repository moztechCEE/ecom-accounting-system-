import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RecognizeReceiptDto } from './dto/recognize-receipt.dto';
import { ExpenseReceiptService } from './expense-receipt.service';

@Controller('expense/receipts')
@UseGuards(JwtAuthGuard)
export class ExpenseReceiptController {
  constructor(private readonly receipts: ExpenseReceiptService) {}

  @Post('recognize')
  recognize(@Req() req: Request, @Body() dto: RecognizeReceiptDto) {
    return this.receipts.recognize((req.user as { id: string }).id, dto);
  }
}
