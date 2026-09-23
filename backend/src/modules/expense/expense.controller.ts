import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Query,
  Put,
  Req,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ExpenseService } from './expense.service';
import { AssignLegacyApprovalDto } from './dto/assign-legacy-approval.dto';
import { CreateExpenseRequestDto } from './dto/create-expense-request.dto';
import { ApproveExpenseRequestDto } from './dto/approve-expense-request.dto';
import { RejectExpenseRequestDto } from './dto/reject-expense-request.dto';
import { SubmitExpenseFeedbackDto } from './dto/submit-feedback.dto';
import { UpdatePaymentInfoDto } from './dto/update-payment-info.dto';
import {
  CreateReimbursementItemDto,
  UpdateReimbursementItemDto,
} from './dto/manage-reimbursement-item.dto';
import type { Request } from 'express';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

/**
 * 費用控制器
 * 管理費用請款、報銷申請、審批流程
 */
@ApiTags('expense')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('expense')
export class ExpenseController {
  constructor(private readonly expenseService: ExpenseService) {}

  @Get('requests')
  @ApiOperation({ summary: '查詢費用請款列表' })
  @ApiResponse({ status: 200, description: '成功取得費用請款列表' })
  async getExpenseRequests(
    @Query('entityId') entityId?: string,
    @Query('status') status?: string,
    @Req() req?: Request,
  ) {
    return this.expenseService.listAccessibleRequests((req?.user as any)?.id, entityId, status, req?.query?.mine === 'true');
  }

  @Get('requests/:id')
  @ApiOperation({ summary: '查詢單一費用請款' })
  @ApiResponse({ status: 200, description: '成功取得費用請款詳情' })
  async getExpenseRequest(@Param('id') id: string, @Req() req: Request) {
    return this.expenseService.accessibleRequest(id, (req.user as any).id);
  }

  @Post('requests')
  @ApiOperation({ summary: '建立費用請款' })
  @ApiResponse({ status: 201, description: '成功建立費用請款' })
  async createExpenseRequest(
    @Body() data: CreateExpenseRequestDto,
    @Req() req: Request,
  ) {
    const user = req.user as any;
    return this.expenseService.submitIntelligentExpenseRequest(data, {
      id: user.id,
      roleCodes: this.extractRoleCodes(user),
    });
  }

  @Post('predict-category')
  @ApiOperation({ summary: '預測報銷項目' })
  @ApiResponse({ status: 200, description: '成功預測報銷項目' })
  async predictCategory(
    @Body() data: { description: string; entityId: string; model?: string },
    @Req() req: Request,
  ) {
    await this.expenseService.assertEntityAccess((req.user as any).id, data.entityId);
    return this.expenseService.predictReimbursementItem(
      data.entityId,
      data.description,
      data.model,
    );
  }

  @Post('seed-ai-items')
  @ApiOperation({ summary: '使用 AI 生成報銷項目題庫' })
  @ApiResponse({ status: 200, description: '成功生成報銷項目' })
  @Roles('ADMIN', 'SUPER_ADMIN')
  @UseGuards(RolesGuard)
  async seedAiItems(@Body() data: { entityId: string }, @Req() req: Request) {
    await this.expenseService.assertEntityAccess((req.user as any).id, data.entityId);
    return this.expenseService.seedAiReimbursementItems(data.entityId);
  }

  @Get('test-ai-connection')
  @ApiOperation({ summary: '測試 AI 連線' })
  @ApiResponse({ status: 200, description: 'AI 連線測試結果' })
  async testAiConnection() {
    return this.expenseService.testAiConnection();
  }

  @Put('requests/:id/approve')
  @ApiOperation({ summary: '核准費用請款' })
  @ApiResponse({ status: 200, description: '成功核准費用請款' })
  async approveExpense(
    @Param('id') id: string,
    @Body() data: ApproveExpenseRequestDto,
    @Req() req: Request,
  ) {
    const user = req.user as any;
    return this.expenseService.approveExpenseRequest(
      id,
      { id: user.id, roleCodes: this.extractRoleCodes(user) },
      data,
    );
  }

  @Get('requests/:id/legacy-approval-route')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: '預覽未指派舊申請的主管審批' })
  previewLegacyApprovalRoute(@Param('id') id: string, @Req() req: Request) {
    return this.expenseService.previewLegacyApprovalRoute(id, (req.user as any).id);
  }

  @Put('requests/:id/legacy-approval-route')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: '管理員確認後為未指派舊申請建立主管審批' })
  assignLegacyApprovalRoute(@Param('id') id: string, @Body() dto: AssignLegacyApprovalDto, @Req() req: Request) {
    return this.expenseService.assignLegacyApprovalRoute(id, (req.user as any).id, dto);
  }

  @Put('requests/:id/reject')
  @ApiOperation({ summary: '駁回費用請款' })
  @ApiResponse({ status: 200, description: '成功駁回費用請款' })
  async rejectExpense(
    @Param('id') id: string,
    @Body() data: RejectExpenseRequestDto,
    @Req() req: Request,
  ) {
    const user = req.user as any;
    return this.expenseService.rejectExpenseRequest(
      id,
      { id: user.id, roleCodes: this.extractRoleCodes(user) },
      data,
    );
  }

  @Put('requests/:id/payment-info')
  @ApiOperation({ summary: '更新費用申請付款資訊 (僅限管理員/會計)' })
  @ApiResponse({ status: 200, description: '成功更新付款資訊' })
  async updatePaymentInfo(
    @Param('id') id: string,
    @Body() data: UpdatePaymentInfoDto,
    @Req() req: Request,
  ) {
    const user = req.user as any;
    return this.expenseService.updatePaymentInfo(
      id,
      data,
      { id: user.id, roleCodes: this.extractRoleCodes(user) },
    );
  }

  @Get('requests/:id/history')
  @ApiOperation({ summary: '取得費用申請歷程' })
  @ApiResponse({ status: 200, description: '成功取得歷程' })
  async getExpenseHistory(@Param('id') id: string, @Req() req: Request) {
    await this.expenseService.accessibleRequest(id, (req.user as any).id);
    return this.expenseService.getExpenseRequestHistory(id);
  }

  @Post('requests/:id/feedback')
  @ApiOperation({ summary: '提交建議結果回饋' })
  @ApiResponse({ status: 201, description: '成功送出回饋' })
  async submitFeedback(
    @Param('id') id: string,
    @Body() dto: SubmitExpenseFeedbackDto,
    @Req() req: Request,
  ) {
    const user = req.user as any;
    await this.expenseService.accessibleRequest(id, user.id);
    return this.expenseService.submitFeedback(
      id,
      { id: user.id, roleCodes: this.extractRoleCodes(user) },
      dto,
    );
  }

  @Get('my-requests')
  @ApiOperation({ summary: '查詢我的費用請款' })
  @ApiResponse({ status: 200, description: '成功取得個人費用請款列表' })
  async getMyExpenseRequests(@Req() req: Request) {
    const user = req.user as any;
    return this.expenseService.listAccessibleRequests(user.id, undefined, undefined, true);
  }

  @Get('reimbursement-items')
  @ApiOperation({ summary: '取得可用的費用報銷項目（Reimbursement Items）' })
  @ApiResponse({ status: 200, description: '成功取得報銷項目清單' })
  @ApiQuery({ name: 'entityId', required: true })
  @ApiQuery({
    name: 'roles',
    required: false,
    description: '以逗號分隔的角色代碼（例如：ADMIN,ACCOUNTANT）',
  })
  @ApiQuery({ name: 'departmentId', required: false })
  async getReimbursementItems(
    @Query('entityId') entityId: string,
    @Query('roles') roles?: string,
    @Query('departmentId') departmentId?: string,
    @Req() req?: Request,
  ) {
    const access = await this.expenseService.assertEntityAccess((req?.user as any)?.id, entityId);
    roles = access.roles.join(',');
    departmentId = access.user.employee?.departmentId || undefined;
    const roleList = roles
      ? roles
          .split(',')
          .map((r) => r.trim())
          .filter(Boolean)
      : undefined;

    return this.expenseService.getReimbursementItems(entityId, {
      roles: roleList,
      departmentId,
    });
  }

  @Get('admin/reimbursement-items')
  @ApiOperation({ summary: '管理端：查詢報銷項目' })
  @ApiResponse({ status: 200, description: '成功取得報銷項目列表' })
  @ApiQuery({ name: 'entityId', required: false })
  @ApiQuery({ name: 'includeInactive', required: false, type: Boolean })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN')
  async listReimbursementItemsAdmin(
    @Query('entityId') entityId?: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.expenseService.listReimbursementItemsAdmin(
      entityId,
      includeInactive === 'true',
    );
  }

  @Get('admin/reimbursement-items/:id')
  @ApiOperation({ summary: '管理端：查詢單一報銷項目' })
  @ApiResponse({ status: 200, description: '成功取得報銷項目詳情' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN')
  async getReimbursementItemAdmin(@Param('id') id: string) {
    return this.expenseService.getReimbursementItemAdmin(id);
  }

  @Post('admin/reimbursement-items')
  @ApiOperation({ summary: '管理端：建立報銷項目' })
  @ApiResponse({ status: 201, description: '成功建立報銷項目' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN')
  async createReimbursementItemAdmin(
    @Body() dto: CreateReimbursementItemDto,
  ) {
    return this.expenseService.createReimbursementItemAdmin(dto);
  }

  @Put('admin/reimbursement-items/:id')
  @ApiOperation({ summary: '管理端：更新報銷項目' })
  @ApiResponse({ status: 200, description: '成功更新報銷項目' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN')
  async updateReimbursementItemAdmin(
    @Param('id') id: string,
    @Body() dto: UpdateReimbursementItemDto,
  ) {
    return this.expenseService.updateReimbursementItemAdmin(id, dto);
  }

  @Put('admin/reimbursement-items/:id/archive')
  @ApiOperation({ summary: '管理端：停用報銷項目' })
  @ApiResponse({ status: 200, description: '成功停用報銷項目' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN')
  async archiveReimbursementItemAdmin(@Param('id') id: string) {
    return this.expenseService.archiveReimbursementItemAdmin(id);
  }

  @Get('admin/approval-policies')
  @ApiOperation({ summary: '管理端：查詢審批政策' })
  @ApiResponse({ status: 200, description: '成功取得審批政策列表' })
  @ApiQuery({ name: 'entityId', required: false })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN')
  async listApprovalPolicies(@Query('entityId') entityId?: string) {
    return this.expenseService.listApprovalPolicies(entityId);
  }

  private extractRoleCodes(user: any): string[] {
    if (!user?.roles) {
      return [];
    }

    return user.roles
      .map((userRole: any) => userRole?.role?.code)
      .filter((code: string | undefined): code is string => Boolean(code));
  }
}
