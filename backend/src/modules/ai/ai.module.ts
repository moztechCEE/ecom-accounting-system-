import { Module, Global } from '@nestjs/common';
import { AiService } from './ai.service';
import { AiInsightsService } from './ai-insights.service';
import { AiCopilotService } from './ai-copilot.service';
import { AiKnowledgeService } from './ai-knowledge.service';
import { AiController } from './ai.controller';
import { PrismaModule } from '../../common/prisma/prisma.module';

@Global()
@Module({
  imports: [PrismaModule],
  controllers: [AiController],
  providers: [
    AiService,
    AiInsightsService,
    AiKnowledgeService,
    AiCopilotService,
  ],
  exports: [AiService, AiInsightsService, AiKnowledgeService, AiCopilotService],
})
export class AiModule {}
