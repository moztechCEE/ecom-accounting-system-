import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Req,
  Param,
  Delete,
} from '@nestjs/common';
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
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AiComputerUseService } from './ai-computer-use.service';
import { CreateComputerUseSessionDto } from './dto/create-computer-use-session.dto';
import { RunComputerUseTaskDto } from './dto/run-computer-use-task.dto';
import { NavigateComputerUseSessionDto } from './dto/navigate-computer-use-session.dto';
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
    private readonly computerUseService: AiComputerUseService,
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
    const briefing = await this.insightsService.getDailyBriefing(
      body.entityId,
      body.modelId,
    );
    return briefing;
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

  @Get('computer-use/sessions')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: '列出目前使用者的 computer use sessions' })
  async listComputerUseSessions(@Req() req: Request) {
    const user = req.user as any;
    return this.computerUseService.listSessions(user.id);
  }

  @Post('computer-use/sessions')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: '建立 browser debugging / computer use session' })
  async createComputerUseSession(
    @Req() req: Request,
    @Body() body: CreateComputerUseSessionDto,
  ) {
    const user = req.user as any;
    return this.computerUseService.createSession(user.id, body);
  }

  @Get('computer-use/sessions/:sessionId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: '取得單一 computer use session 狀態' })
  async getComputerUseSession(
    @Req() req: Request,
    @Param('sessionId') sessionId: string,
  ) {
    const user = req.user as any;
    return this.computerUseService.getSession(user.id, sessionId);
  }

  @Post('computer-use/sessions/:sessionId/navigate')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: '手動將 computer use session 導向指定網址' })
  async navigateComputerUseSession(
    @Req() req: Request,
    @Param('sessionId') sessionId: string,
    @Body() body: NavigateComputerUseSessionDto,
  ) {
    const user = req.user as any;
    return this.computerUseService.navigateSession(user.id, sessionId, body.url);
  }

  @Post('computer-use/sessions/:sessionId/run')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: '讓 GPT-5.5 操作瀏覽器並回報除錯結果' })
  async runComputerUseTask(
    @Req() req: Request,
    @Param('sessionId') sessionId: string,
    @Body() body: RunComputerUseTaskDto,
  ) {
    const user = req.user as any;
    return this.computerUseService.runTask(user.id, sessionId, body);
  }

  @Delete('computer-use/sessions/:sessionId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: '關閉 computer use session' })
  async closeComputerUseSession(
    @Req() req: Request,
    @Param('sessionId') sessionId: string,
  ) {
    const user = req.user as any;
    return this.computerUseService.closeSession(user.id, sessionId);
  }
}
