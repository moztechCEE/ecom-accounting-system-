import { Controller, Get, Post, Body, UseGuards, Req } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AiService, AiModel } from './ai.service';
import { AiInsightsService } from './ai-insights.service';
import { AiCopilotService } from './ai-copilot.service';
import type { CopilotResponse } from './ai-copilot.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { Request } from 'express';

@ApiTags('AI Core')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('ai')
export class AiController {
  constructor(
    private readonly aiService: AiService,
    private readonly insightsService: AiInsightsService,
    private readonly copilotService: AiCopilotService,
  ) {}

  @Get('models')
  @ApiOperation({ summary: '取得可用 AI 模型列表' })
  @ApiResponse({ status: 200, description: '成功取得模型列表' })
  getModels(): AiModel[] {
    return this.aiService.getAvailableModels();
  }

  @Post('insights/daily-briefing')
  @ApiOperation({ summary: '取得每日財務 AI 簡報' })
  async getDailyBriefing(@Body() body: { entityId: string; modelId?: string }) {
    const insight = await this.insightsService.getDailyBriefing(
      body.entityId,
      body.modelId,
    );
    return { insight };
  }

  @Post('copilot/chat')
  @ApiOperation({ summary: '與 AI 助手對話（系統知識 + 實際資料查詢）' })
  async chat(
    @Req() req: Request,
    @Body() body: { message: string; entityId: string; modelId?: string },
  ): Promise<CopilotResponse> {
    const user = req.user as any;
    return this.copilotService.processChat(
      body.entityId,
      user.id,
      body.message,
      body.modelId,
    );
  }
}
