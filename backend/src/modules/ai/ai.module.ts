import { Module, Global } from '@nestjs/common';
import { AiService } from './ai.service';
import { AiInsightsService } from './ai-insights.service';
import { AiCopilotService } from './ai-copilot.service';
import { AiKnowledgeService } from './ai-knowledge.service';
import { AiComputerUseService } from './ai-computer-use.service';
import { AiController } from './ai.controller';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { ReportsModule } from '../reports/reports.module';
import { AiCopilotAccessService } from './ai-copilot-access.service';
import { RolesGuard } from '../../common/guards/roles.guard';

@Global()
@Module({
  imports: [PrismaModule, ReportsModule],
  controllers: [AiController],
  providers: [
    AiService,
    AiInsightsService,
    AiKnowledgeService,
    AiCopilotService,
    AiCopilotAccessService,
    AiComputerUseService,
    RolesGuard,
  ],
  exports: [
    AiService,
    AiInsightsService,
    AiKnowledgeService,
    AiCopilotService,
    AiCopilotAccessService,
    AiComputerUseService,
  ],
})
export class AiModule {}
