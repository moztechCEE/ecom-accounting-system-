import { Module, Global } from '@nestjs/common';
import { AiService } from './ai.service';
import { AiInsightsService } from './ai-insights.service';
import { AiCopilotService } from './ai-copilot.service';
import { AiKnowledgeService } from './ai-knowledge.service';
import { AiComputerUseService } from './ai-computer-use.service';
import { AiController } from './ai.controller';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { ReportsModule } from '../reports/reports.module';

@Global()
@Module({
  imports: [PrismaModule, ReportsModule],
  controllers: [AiController],
  providers: [
    AiService,
    AiInsightsService,
    AiKnowledgeService,
    AiCopilotService,
    AiComputerUseService,
  ],
  exports: [
    AiService,
    AiInsightsService,
    AiKnowledgeService,
    AiCopilotService,
    AiComputerUseService,
  ],
})
export class AiModule {}
