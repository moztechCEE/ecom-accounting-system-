import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AttendanceIntegrationService } from '../attendance/services/integration.service';
import { BalanceService } from '../attendance/services/balance.service';
import { LeaveService } from '../attendance/services/leave.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JournalService } from '../accounting/services/journal.service';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { UsersService } from '../users/users.service';
import { CreateEmployeeLoginAccountDto } from './dto/create-employee-login-account.dto';
import PDFDocument = require('pdfkit');

const DEFAULT_PAYROLL_POLICY = {
  standardMonthlyHours: 240,
  overtimeMultiplier: 1.34,
  twLaborInsuranceRate: 0.022,
  twHealthInsuranceRate: 0.015,
  cnSocialInsuranceRate: 0.105,
} as const;

const DEFAULT_EMPLOYEE_INITIAL_PASSWORD = 'qwer1234';

const EMPLOYEE_ONBOARDING_DOC_TYPES = [
  'ID_FRONT',
  'ID_BACK',
  'HEALTH_CHECK',
] as const;

const EMPLOYEE_COMPENSATION_FIELD_KEYS = [
  'transportAllowance',
  'supervisorAllowance',
  'extraAllowance',
  'courseAllowance',
  'seniorityPay',
  'bonus',
  'salaryAdjustment',
  'annualAdjustment',
  'laborInsuranceDeduction',
  'healthInsuranceDeduction',
  'pensionSelfContribution',
  'dependentInsurance',
  'salaryAdvance',
] as const;

type EmployeeCompensationFieldKey =
  (typeof EMPLOYEE_COMPENSATION_FIELD_KEYS)[number];

/**
 * 薪資管理服務
 *
 * 核心功能：
 * 1. 薪資批次計算
 * 2. 勞健保計算（台灣/大陸）
 * 3. 薪資分錄自動產生
 * 4. 薪資報表
 */
@Injectable()
export class PayrollService {
  private readonly logger = new Logger(PayrollService.name);
  private readonly defaultWeekdaySet = new Set([1, 2, 3, 4, 5]);
  private readonly maxOnboardingDocumentSizeBytes = 5 * 1024 * 1024;

  constructor(
    private readonly prisma: PrismaService,
    private readonly attendanceIntegration: AttendanceIntegrationService,
    private readonly balanceService: BalanceService,
    private readonly leaveService: LeaveService,
    private readonly journalService: JournalService,
    private readonly auditLogService: AuditLogService,
    private readonly usersService: UsersService,
  ) {}

  private toNumber(value: unknown): number {
    if (value == null) {
      return 0;
    }

    return Number(value);
  }

  private isEmployeeOnboardingDocType(value: string): value is (typeof EMPLOYEE_ONBOARDING_DOC_TYPES)[number] {
    return (EMPLOYEE_ONBOARDING_DOC_TYPES as readonly string[]).includes(value);
  }

  private getDefaultCompensationSettings() {
    return {
      transportAllowance: 0,
      supervisorAllowance: 0,
      extraAllowance: 0,
      courseAllowance: 0,
      seniorityPay: 0,
      bonus: 0,
      salaryAdjustment: 0,
      annualAdjustment: 0,
      laborInsuranceDeduction: 0,
      healthInsuranceDeduction: 0,
      pensionSelfContribution: 0,
      dependentInsurance: 0,
      salaryAdvance: 0,
    };
  }

  private normalizeCompensationSettings(input?: Record<string, unknown> | null) {
    const defaults = this.getDefaultCompensationSettings();
    const normalized = { ...defaults };

    for (const key of EMPLOYEE_COMPENSATION_FIELD_KEYS) {
      const rawValue = input?.[key];
      const value =
        rawValue === undefined || rawValue === null || rawValue === ''
          ? 0
          : Number(rawValue);

      if (!Number.isFinite(value) || value < 0) {
        throw new BadRequestException(`薪資欄位 ${key} 必須是有效的非負數字`);
      }

      normalized[key] = value;
    }

    return normalized;
  }

  private buildEmployeeInclude() {
    return {
      department: true,
      user: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      compensationSettings: true,
      onboardingDocuments: {
        select: {
          id: true,
          docType: true,
          status: true,
          fileName: true,
          mimeType: true,
          fileSize: true,
          uploadedAt: true,
          verifiedAt: true,
          verifiedBy: true,
        },
        orderBy: [{ docType: 'asc' as const }],
      },
    };
  }

  private serializeEmployee<T extends Record<string, any>>(employee: T) {
    const compensation = employee.compensationSettings
      ? {
          ...this.getDefaultCompensationSettings(),
          ...Object.fromEntries(
            EMPLOYEE_COMPENSATION_FIELD_KEYS.map((key) => [
              key,
              this.toNumber(employee.compensationSettings?.[key]),
            ]),
          ),
        }
      : this.getDefaultCompensationSettings();

    const existingDocuments = new Map(
      Array.isArray(employee.onboardingDocuments)
        ? employee.onboardingDocuments.map((document: Record<string, any>) => [
            String(document.docType),
            {
              ...document,
              fileSize:
                document.fileSize === undefined || document.fileSize === null
                  ? undefined
                  : Number(document.fileSize),
            },
          ])
        : [],
    );

    const onboardingDocuments = EMPLOYEE_ONBOARDING_DOC_TYPES.map((docType) => {
      const document = existingDocuments.get(docType);
      if (document) {
        return document;
      }

      return {
        id: `${employee.id}:${docType}`,
        docType,
        status: 'PENDING',
        fileName: null,
        mimeType: null,
        fileSize: undefined,
        uploadedAt: null,
        verifiedAt: null,
        verifiedBy: null,
      };
    });

    return {
      ...employee,
      salaryBaseOriginal: this.toNumber(employee.salaryBaseOriginal),
      salaryBaseFxRate: this.toNumber(employee.salaryBaseFxRate),
      salaryBaseBase: this.toNumber(employee.salaryBaseBase),
      departmentName: employee.department?.name ?? null,
      compensationSettings: compensation,
      onboardingDocuments,
    };
  }

  private serializePayrollRun<T extends Record<string, any>>(run: T) {
    const items: Record<string, any>[] | undefined = Array.isArray(run.items)
      ? run.items.map((item: Record<string, any>) => ({
          ...item,
          amountOriginal: this.toNumber(item.amountOriginal),
          amountFxRate: this.toNumber(item.amountFxRate),
          amountBase: this.toNumber(item.amountBase),
        }))
      : undefined;

    const totalAmount = (items ?? []).reduce(
      (sum, item) => sum + this.toNumber(item.amountBase),
      0,
    );

    const employeeCount = new Set((items ?? []).map((item) => item.employeeId))
      .size;

    return {
      ...run,
      items,
      totalAmount,
      employeeCount:
        employeeCount > 0 ? employeeCount : (run._count?.items ?? undefined),
    };
  }

  private serializePayrollPolicy<T extends Record<string, any>>(policy: T) {
    return {
      ...policy,
      standardMonthlyHours: this.toNumber(policy.standardMonthlyHours),
      overtimeMultiplier: this.toNumber(policy.overtimeMultiplier),
      twLaborInsuranceRate: this.toNumber(policy.twLaborInsuranceRate),
      twHealthInsuranceRate: this.toNumber(policy.twHealthInsuranceRate),
      cnSocialInsuranceRate: this.toNumber(policy.cnSocialInsuranceRate),
    };
  }

  private serializeAuditLog<T extends Record<string, any>>(log: T) {
    return {
      ...log,
      createdAt:
        log.createdAt instanceof Date
          ? log.createdAt.toISOString()
          : log.createdAt,
    };
  }

  private maskAccountNo(accountNo?: string | null) {
    if (!accountNo) {
      return '—';
    }

    const tail = accountNo.slice(-5);
    return `***${tail}`;
  }

  private buildPayslipFileName(
    employeeNo: string,
    payDate: Date,
    suffix = 'payslip',
  ) {
    return `${suffix}-${employeeNo}-${payDate.toISOString().slice(0, 10)}.pdf`;
  }

  private generateTemporaryPassword() {
    return DEFAULT_EMPLOYEE_INITIAL_PASSWORD;
  }

  private async generateNextEmployeeNo() {
    const employees = await this.prisma.employee.findMany({
      select: { employeeNo: true },
    });

    const maxNumber = employees.reduce((max, employee) => {
      const employeeNo = employee.employeeNo.trim();
      if (!/^\d+$/.test(employeeNo)) {
        return max;
      }

      const numeric = Number(employeeNo);
      return Number.isFinite(numeric) ? Math.max(max, numeric) : max;
    }, 0);

    return String(maxNumber + 1).padStart(4, '0');
  }

  async getNextEmployeeNo() {
    return {
      employeeNo: await this.generateNextEmployeeNo(),
    };
  }

  private generateEmployeeLoginEmail(entityId: string, employeeNo: string) {
    const normalizedEntity = entityId
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    return `${normalizedEntity || 'entity'}.${employeeNo}@employees.example`;
  }

  private normalizeInputDate(value: Date | string, fieldName: string) {
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`${fieldName}格式不正確`);
    }
    return date;
  }

  private startOfDay(value: Date) {
    const date = new Date(value.getTime());
    date.setHours(0, 0, 0, 0);
    return date;
  }

  private endOfDay(value: Date) {
    const date = new Date(value.getTime());
    date.setHours(23, 59, 59, 999);
    return date;
  }

  private dateKey(value: Date) {
    return this.startOfDay(value).toISOString().slice(0, 10);
  }

  private enumerateDates(start: Date, end: Date) {
    const dates: Date[] = [];
    const cursor = this.startOfDay(start);
    const finalDate = this.startOfDay(end);

    while (cursor <= finalDate) {
      dates.push(new Date(cursor.getTime()));
      cursor.setDate(cursor.getDate() + 1);
    }

    return dates;
  }

  private scopeIdsFromJson(value: unknown) {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : [];
  }

  private closureAppliesToEmployee(
    closure: { scopeType: string; scopeIds: unknown },
    employee: { id: string; departmentId?: string | null; location?: string | null },
  ) {
    if (closure.scopeType === 'ENTITY') {
      return true;
    }

    const scopeIds = this.scopeIdsFromJson(closure.scopeIds);
    if (closure.scopeType === 'DEPARTMENT') {
      return Boolean(employee.departmentId && scopeIds.includes(employee.departmentId));
    }
    if (closure.scopeType === 'EMPLOYEE') {
      return scopeIds.includes(employee.id);
    }
    if (closure.scopeType === 'LOCATION') {
      return Boolean(employee.location && scopeIds.includes(employee.location));
    }
    return false;
  }

  private buildWeekdaySet(values: number[]) {
    return new Set(values.filter((value) => Number.isInteger(value) && value >= 0 && value <= 6));
  }

  private async buildPayslipPdfBuffer(params: {
    run: Record<string, any>;
    employee: {
      id: string;
      employeeNo: string;
      name: string;
      department?: { name?: string | null } | null;
    };
    items: Array<Record<string, any>>;
  }) {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 48,
      info: {
        Title: this.buildPayslipFileName(
          params.employee.employeeNo,
          params.run.payDate,
        ),
        Author: 'MOZTECH E-Accounting',
      },
    });

    const chunks: Buffer[] = [];

    return new Promise<Buffer>((resolve, reject) => {
      doc.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const totalAmount = params.items.reduce(
        (sum, item) => sum + this.toNumber(item.amountBase),
        0,
      );

      const formatCurrency = (amount: number) => {
        return `$${amount.toLocaleString('en-US', {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        })}`;
      };

      doc.fontSize(22).text('Payroll Payslip', { align: 'left' });
      doc.moveDown(0.4);
      doc
        .fontSize(11)
        .fillColor('#475569')
        .text(`Entity: ${params.run.entity?.name ?? '—'}`)
        .text(
          `Employee: ${params.employee.name} (${params.employee.employeeNo})`,
        )
        .text(`Department: ${params.employee.department?.name ?? '—'}`)
        .text(
          `Period: ${params.run.periodStart.toISOString().slice(0, 10)} - ${params.run.periodEnd.toISOString().slice(0, 10)}`,
        )
        .text(`Pay Date: ${params.run.payDate.toISOString().slice(0, 10)}`)
        .text(`Status: ${String(params.run.status || '').toUpperCase()}`)
        .text(`Approver: ${params.run.approver?.name ?? '—'}`)
        .text(
          `Bank Account: ${params.run.bankAccount ? `${params.run.bankAccount.bankName} ${this.maskAccountNo(params.run.bankAccount.accountNo)}` : '—'}`,
        )
        .fillColor('#0f172a');

      doc.moveDown(1);
      doc
        .roundedRect(48, doc.y, 499, 72, 16)
        .fillAndStroke('#eff6ff', '#bfdbfe');
      doc
        .fillColor('#64748b')
        .fontSize(11)
        .text('Net Pay', 68, doc.y - 60)
        .fillColor('#0f172a')
        .fontSize(26)
        .text(formatCurrency(totalAmount), 68, doc.y - 38);
      doc
        .fillColor('#64748b')
        .fontSize(11)
        .text('Items', 250, doc.y - 48)
        .fillColor('#0f172a')
        .fontSize(18)
        .text(String(params.items.length), 250, doc.y - 28);
      doc
        .fillColor('#64748b')
        .fontSize(11)
        .text('Created', 400, doc.y - 40)
        .fillColor('#0f172a')
        .fontSize(14)
        .text(
          params.run.createdAt
            ? params.run.createdAt.toISOString().slice(0, 10)
            : '—',
          400,
          doc.y - 22,
        );
      doc.moveDown(4.8);

      const startX = 48;
      const itemColX = 48;
      const remarkColX = 220;
      const amountColX = 470;

      doc
        .fontSize(11)
        .fillColor('#475569')
        .text('Item', itemColX, doc.y)
        .text('Remark', remarkColX, doc.y)
        .text('Amount', amountColX, doc.y, { width: 70, align: 'right' });
      doc.moveDown(0.8);
      doc
        .moveTo(startX, doc.y)
        .lineTo(547, doc.y)
        .strokeColor('#cbd5e1')
        .stroke();
      doc.moveDown(0.5);

      params.items.forEach((item) => {
        const currentY = doc.y;
        doc
          .fillColor('#0f172a')
          .fontSize(11)
          .text(String(item.type || '—'), itemColX, currentY, {
            width: 150,
          })
          .fillColor('#475569')
          .text(String(item.remark || '—'), remarkColX, currentY, {
            width: 200,
          })
          .fillColor('#0f172a')
          .text(
            formatCurrency(this.toNumber(item.amountBase)),
            amountColX,
            currentY,
            {
              width: 70,
              align: 'right',
            },
          );
        doc.moveDown(1.2);
        doc
          .moveTo(startX, doc.y - 6)
          .lineTo(547, doc.y - 6)
          .strokeColor('#e2e8f0')
          .stroke();
        if (doc.y > 720) {
          doc.addPage();
        }
      });

      doc.moveDown(1.5);
      doc
        .fontSize(10)
        .fillColor('#64748b')
        .text(
          'This payslip is generated by the payroll system. Please contact HR if any amount looks incorrect.',
        );

      doc.end();
    });
  }

  private async getEmployeeForUser(userId: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { userId },
      select: {
        id: true,
        entityId: true,
        employeeNo: true,
        name: true,
      },
    });

    if (!employee) {
      throw new NotFoundException(
        'Current user is not linked to an employee record',
      );
    }

    return employee;
  }

  private async resolveEntityId(userId: string, requestedEntityId?: string) {
    if (requestedEntityId) {
      const entity = await this.prisma.entity.findUnique({
        where: { id: requestedEntityId },
        select: { id: true },
      });

      if (!entity) {
        throw new NotFoundException('Entity not found');
      }

      return entity.id;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        employee: {
          select: { entityId: true },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.employee?.entityId) {
      return user.employee.entityId;
    }

    const fallbackEntity = await this.prisma.entity.findFirst({
      orderBy: { id: 'asc' },
      select: { id: true },
    });

    if (!fallbackEntity) {
      throw new NotFoundException('No entity configured');
    }

    return fallbackEntity.id;
  }

  private async getEmployeeDataAccessContext(
    userId: string,
    requestedEntityId?: string,
  ) {
    return this.usersService.getDataAccessContext(
      userId,
      'employees',
      requestedEntityId,
    );
  }

  private async getPayrollDataAccessContext(
    userId: string,
    requestedEntityId?: string,
  ) {
    return this.usersService.getDataAccessContext(
      userId,
      'payroll',
      requestedEntityId,
    );
  }

  private buildEmployeeAccessWhere(
    access: {
      scope: 'SELF' | 'DEPARTMENT' | 'ENTITY';
      entityId: string;
      employeeId: string | null;
      departmentId: string | null;
      noAccess: boolean;
    },
  ) {
    if (access.noAccess) {
      return { id: '__no_access__', entityId: access.entityId };
    }

    if (access.scope === 'SELF') {
      return {
        entityId: access.entityId,
        id: access.employeeId || '__no_access__',
      };
    }

    if (access.scope === 'DEPARTMENT') {
      return {
        entityId: access.entityId,
        departmentId: access.departmentId || '__no_access__',
      };
    }

    return { entityId: access.entityId };
  }

  private buildPayrollItemAccessWhere(
    access: {
      scope: 'SELF' | 'DEPARTMENT' | 'ENTITY';
      employeeId: string | null;
      departmentId: string | null;
      noAccess: boolean;
    },
  ) {
    if (access.noAccess) {
      return { employeeId: '__no_access__' };
    }

    if (access.scope === 'SELF') {
      return { employeeId: access.employeeId || '__no_access__' };
    }

    if (access.scope === 'DEPARTMENT') {
      return {
        employee: {
          departmentId: access.departmentId || '__no_access__',
        },
      };
    }

    return undefined;
  }

  private ensureEntityWideAccess(access: {
    scope: 'SELF' | 'DEPARTMENT' | 'ENTITY';
    noAccess: boolean;
  }) {
    if (access.noAccess || access.scope !== 'ENTITY') {
      throw new ForbiddenException('目前帳號僅能查看限定範圍資料，無法執行此管理操作');
    }
  }

  private async ensureDepartmentInEntity(
    departmentId: string | undefined,
    entityId: string,
  ) {
    if (!departmentId) {
      return null;
    }

    const department = await this.prisma.department.findFirst({
      where: {
        id: departmentId,
        entityId,
      },
    });

    if (!department) {
      throw new NotFoundException('Department not found');
    }

    return department;
  }

  private async getOrCreatePayrollPolicy(entityId: string) {
    return this.prisma.payrollPolicy.upsert({
      where: { entityId },
      update: {},
      create: {
        entityId,
        ...DEFAULT_PAYROLL_POLICY,
      },
    });
  }

  async getPayrollSettings(userId: string, entityId?: string) {
    const resolvedEntityId = await this.resolveEntityId(userId, entityId);
    const policy = await this.getOrCreatePayrollPolicy(resolvedEntityId);
    return this.serializePayrollPolicy(policy);
  }

  async upsertPayrollSettings(
    userId: string,
    data: {
      entityId?: string;
      standardMonthlyHours?: number;
      overtimeMultiplier?: number;
      twLaborInsuranceRate?: number;
      twHealthInsuranceRate?: number;
      cnSocialInsuranceRate?: number;
    },
  ) {
    const resolvedEntityId = await this.resolveEntityId(userId, data.entityId);
    const previousPolicy = await this.prisma.payrollPolicy.findUnique({
      where: { entityId: resolvedEntityId },
    });

    const updateData: Record<string, number> = {};

    if (data.standardMonthlyHours !== undefined) {
      updateData.standardMonthlyHours = Number(data.standardMonthlyHours);
    }

    if (data.overtimeMultiplier !== undefined) {
      updateData.overtimeMultiplier = Number(data.overtimeMultiplier);
    }

    if (data.twLaborInsuranceRate !== undefined) {
      updateData.twLaborInsuranceRate = Number(data.twLaborInsuranceRate);
    }

    if (data.twHealthInsuranceRate !== undefined) {
      updateData.twHealthInsuranceRate = Number(data.twHealthInsuranceRate);
    }

    if (data.cnSocialInsuranceRate !== undefined) {
      updateData.cnSocialInsuranceRate = Number(data.cnSocialInsuranceRate);
    }

    const policy = await this.prisma.payrollPolicy.upsert({
      where: { entityId: resolvedEntityId },
      update: updateData,
      create: {
        entityId: resolvedEntityId,
        ...DEFAULT_PAYROLL_POLICY,
        ...updateData,
      },
    });

    await this.auditLogService.record({
      userId,
      tableName: 'payroll_policies',
      recordId: policy.id,
      action: previousPolicy ? 'UPDATE' : 'CREATE',
      oldData: previousPolicy,
      newData: policy,
    });

    return this.serializePayrollPolicy(policy);
  }

  async getEmployeeById(userId: string, id: string) {
    const access = await this.getEmployeeDataAccessContext(userId);
    const employee = await this.prisma.employee.findFirst({
      where: {
        id,
        ...this.buildEmployeeAccessWhere(access),
      },
      include: this.buildEmployeeInclude(),
    });

    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    return this.serializeEmployee(employee);
  }

  async getEmployees(userId: string, entityId?: string) {
    const access = await this.getEmployeeDataAccessContext(userId, entityId);

    const employees = await this.prisma.employee.findMany({
      where: this.buildEmployeeAccessWhere(access),
      include: this.buildEmployeeInclude(),
    });

    return employees.map((employee) => this.serializeEmployee(employee));
  }

  async getDepartments(userId: string, entityId?: string) {
    const access = await this.getEmployeeDataAccessContext(userId, entityId);

    return this.prisma.department.findMany({
      where: access.noAccess
        ? { id: '__no_access__', entityId: access.entityId }
        : access.scope === 'DEPARTMENT' || access.scope === 'SELF'
          ? {
              entityId: access.entityId,
              id: access.departmentId || '__no_access__',
            }
          : { entityId: access.entityId },
      orderBy: { name: 'asc' },
    });
  }

  async createDepartment(
    userId: string,
    data: {
      entityId?: string;
      name: string;
      costCenterId?: string;
      isActive?: boolean;
    },
  ) {
    const access = await this.getEmployeeDataAccessContext(userId, data.entityId);
    this.ensureEntityWideAccess(access);
    const entityId = access.entityId;
    const name = data.name?.trim();

    if (!name) {
      throw new BadRequestException('Department name is required');
    }

    const existingDepartment = await this.prisma.department.findFirst({
      where: {
        entityId,
        name,
      },
      select: { id: true },
    });

    if (existingDepartment) {
      throw new ConflictException('Department already exists');
    }

    const department = await this.prisma.department.create({
      data: {
        entityId,
        name,
        costCenterId: data.costCenterId?.trim() || null,
        isActive: data.isActive ?? true,
      },
    });

    await this.auditLogService.record({
      userId,
      tableName: 'departments',
      recordId: department.id,
      action: 'CREATE',
      newData: department,
    });

    return department;
  }

  async updateDepartment(
    id: string,
    userId: string,
    data: {
      name?: string;
      costCenterId?: string | null;
      isActive?: boolean;
    },
  ) {
    const department = await this.prisma.department.findUnique({
      where: { id },
    });

    if (!department) {
      throw new NotFoundException('Department not found');
    }

    const access = await this.getEmployeeDataAccessContext(userId, department.entityId);
    this.ensureEntityWideAccess(access);
    if (access.entityId !== department.entityId) {
      throw new NotFoundException('Department not found');
    }

    const updateData: Record<string, any> = {};

    if (data.name !== undefined) {
      const name = data.name.trim();
      if (!name) {
        throw new BadRequestException('Department name is required');
      }

      const existingDepartment = await this.prisma.department.findFirst({
        where: {
          entityId: department.entityId,
          name,
          NOT: { id },
        },
        select: { id: true },
      });

      if (existingDepartment) {
        throw new ConflictException('Department already exists');
      }

      updateData.name = name;
    }

    if (data.costCenterId !== undefined) {
      updateData.costCenterId = data.costCenterId?.trim() || null;
    }

    if (data.isActive !== undefined) {
      updateData.isActive = data.isActive;
    }

    const updatedDepartment = await this.prisma.department.update({
      where: { id },
      data: updateData,
    });

    await this.auditLogService.record({
      userId,
      tableName: 'departments',
      recordId: id,
      action: 'UPDATE',
      oldData: department,
      newData: updatedDepartment,
    });

    return updatedDepartment;
  }

  async createEmployee(
    userId: string,
    data: {
      entityId?: string;
      userId?: string | null;
      employeeNo?: string;
      name: string;
      departmentId?: string;
      hireDate: string | Date;
      salaryBaseOriginal: number;
      isActive?: boolean;
      location?: string;
      nationalId?: string | null;
      mailingAddress?: string | null;
      compensationSettings?: Record<string, unknown> | null;
    },
  ) {
    const access = await this.getEmployeeDataAccessContext(userId, data.entityId);
    this.ensureEntityWideAccess(access);
    const entityId = access.entityId;
    const entity = await this.prisma.entity.findUnique({
      where: { id: entityId },
      select: {
        id: true,
        country: true,
        baseCurrency: true,
      },
    });

    if (!entity) {
      throw new NotFoundException('Entity not found');
    }

    const employeeNo = data.employeeNo?.trim() || await this.generateNextEmployeeNo();
    if (!employeeNo) {
      throw new BadRequestException('Employee number is required');
    }

    const name = data.name.trim();
    if (!name) {
      throw new BadRequestException('Employee name is required');
    }

    const existingEmployee = await this.prisma.employee.findFirst({
      where: {
        entityId,
        employeeNo,
      },
      select: { id: true },
    });

    if (existingEmployee) {
      throw new ConflictException(
        `Employee number ${employeeNo} already exists`,
      );
    }

    await this.ensureDepartmentInEntity(data.departmentId, entityId);
    await this.ensureUserAssignable(data.userId);

    const salaryBaseOriginal = Number(data.salaryBaseOriginal);
    if (!Number.isFinite(salaryBaseOriginal) || salaryBaseOriginal < 0) {
      throw new BadRequestException(
        'Salary must be a valid non-negative number',
      );
    }

    const compensationSettings = this.normalizeCompensationSettings(
      data.compensationSettings,
    );

    const employee = await this.prisma.employee.create({
      data: {
        entityId,
        userId: data.userId || null,
        employeeNo,
        name,
        nationalId: data.nationalId?.trim() || null,
        mailingAddress: data.mailingAddress?.trim() || null,
        country: entity.country,
        location: data.location?.trim() || null,
        departmentId: data.departmentId || null,
        hireDate: new Date(data.hireDate),
        salaryBaseOriginal,
        salaryBaseCurrency: entity.baseCurrency,
        salaryBaseFxRate: 1,
        salaryBaseBase: salaryBaseOriginal,
        isActive: data.isActive ?? true,
        compensationSettings: {
          create: compensationSettings,
        },
      },
      include: this.buildEmployeeInclude(),
    });

    await this.leaveService.initializeEmployeeLeaveSetup(userId, {
      id: employee.id,
      entityId: employee.entityId,
      hireDate: employee.hireDate,
    });

    await this.auditLogService.record({
      userId,
      tableName: 'employees',
      recordId: employee.id,
      action: 'CREATE',
      newData: this.serializeEmployee(employee),
    });

    if (data.userId) {
      return this.serializeEmployee(employee);
    }

    const loginAccount = await this.createEmployeeLoginAccount(
      employee.id,
      userId,
      {},
    );

    return {
      ...loginAccount.employee,
      initialLogin: {
        employeeNo,
        temporaryPassword: loginAccount.temporaryPassword,
        entityId,
        user: loginAccount.user,
      },
    };
  }

  async createEmployeeLoginAccount(
    id: string,
    actorUserId: string,
    dto: CreateEmployeeLoginAccountDto,
  ) {
    const employee = await this.prisma.employee.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    const access = await this.getEmployeeDataAccessContext(
      actorUserId,
      employee.entityId,
    );
    const visibleEmployee = await this.prisma.employee.findFirst({
      where: {
        id: employee.id,
        ...this.buildEmployeeAccessWhere(access),
      },
      select: { id: true },
    });
    if (!visibleEmployee) {
      throw new NotFoundException('Employee not found');
    }

    if (employee.userId) {
      throw new ConflictException('Employee already has a linked login account');
    }

    const email =
      dto.email?.trim().toLowerCase() ||
      this.generateEmployeeLoginEmail(employee.entityId, employee.employeeNo);
    const password = dto.password?.trim() || this.generateTemporaryPassword();
    const defaultEmployeeRole = await this.prisma.role.findFirst({
      where: {
        OR: [
          { code: 'EMPLOYEE' },
          { name: 'EMPLOYEE' },
          { code: 'OPERATOR' },
          { name: 'OPERATOR' },
        ],
      },
      select: { id: true },
    });

    const createdUser = await this.usersService.createUser({
      email,
      password,
      name: employee.name,
      roleIds: defaultEmployeeRole ? [defaultEmployeeRole.id] : [],
      mustChangePassword: true,
    });

    const updatedEmployee = await this.prisma.employee.update({
      where: { id: employee.id },
      data: {
        userId: createdUser.id,
      },
      include: this.buildEmployeeInclude(),
    });

    await this.auditLogService.record({
      userId: actorUserId,
      tableName: 'employees',
      recordId: updatedEmployee.id,
      action: 'UPDATE',
      oldData: employee,
      newData: updatedEmployee,
    });

    return {
      employee: this.serializeEmployee(updatedEmployee),
      user: createdUser,
      temporaryPassword: password,
      mustChangePassword: true,
    };
  }

  async updateEmployee(
    id: string,
    userId: string,
    data: {
      userId?: string | null;
      name?: string;
      departmentId?: string | null;
      hireDate?: string | Date;
      salaryBaseOriginal?: number;
      isActive?: boolean;
      location?: string | null;
      terminateDate?: string | Date | null;
      nationalId?: string | null;
      mailingAddress?: string | null;
      compensationSettings?: Record<string, unknown> | null;
    },
  ) {
    const employee = await this.prisma.employee.findUnique({
      where: { id },
      include: this.buildEmployeeInclude(),
    });

    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    const access = await this.getEmployeeDataAccessContext(userId, employee.entityId);
    const visibleEmployee = await this.prisma.employee.findFirst({
      where: {
        id: employee.id,
        ...this.buildEmployeeAccessWhere(access),
      },
      select: { id: true },
    });
    if (!visibleEmployee) {
      throw new NotFoundException('Employee not found');
    }

    if (data.departmentId !== undefined && data.departmentId !== null) {
      await this.ensureDepartmentInEntity(data.departmentId, employee.entityId);
    }
    if (data.userId !== undefined) {
      await this.ensureUserAssignable(data.userId, employee.id);
    }

    const updateData: Record<string, any> = {};

    if (data.name !== undefined) {
      const name = data.name.trim();
      if (!name) {
        throw new BadRequestException('Employee name is required');
      }
      updateData.name = name;
    }

    if (data.departmentId !== undefined) {
      updateData.departmentId = data.departmentId || null;
    }

    if (data.userId !== undefined) {
      updateData.userId = data.userId || null;
    }

    if (data.hireDate !== undefined) {
      updateData.hireDate = new Date(data.hireDate);
    }

    if (data.salaryBaseOriginal !== undefined) {
      const salaryBaseOriginal = Number(data.salaryBaseOriginal);
      if (!Number.isFinite(salaryBaseOriginal) || salaryBaseOriginal < 0) {
        throw new BadRequestException(
          'Salary must be a valid non-negative number',
        );
      }
      updateData.salaryBaseOriginal = salaryBaseOriginal;
      updateData.salaryBaseBase = salaryBaseOriginal;
    }

    if (data.isActive !== undefined) {
      updateData.isActive = data.isActive;
    }

    if (data.location !== undefined) {
      updateData.location = data.location?.trim() || null;
    }

    if (data.nationalId !== undefined) {
      updateData.nationalId = data.nationalId?.trim() || null;
    }

    if (data.mailingAddress !== undefined) {
      updateData.mailingAddress = data.mailingAddress?.trim() || null;
    }

    if (data.terminateDate !== undefined) {
      updateData.terminateDate = data.terminateDate
        ? new Date(data.terminateDate)
        : null;
    }

    const compensationSettings =
      data.compensationSettings !== undefined
        ? this.normalizeCompensationSettings(data.compensationSettings)
        : undefined;

    const updatedEmployee = await this.prisma.employee.update({
      where: { id },
      data: {
        ...updateData,
        ...(compensationSettings
          ? {
              compensationSettings: {
                upsert: {
                  create: compensationSettings,
                  update: compensationSettings,
                },
              },
            }
          : {}),
      },
      include: this.buildEmployeeInclude(),
    });

    await this.auditLogService.record({
      userId,
      tableName: 'employees',
      recordId: id,
      action: 'UPDATE',
      oldData: employee,
      newData: this.serializeEmployee(updatedEmployee),
    });

    return this.serializeEmployee(updatedEmployee);
  }

  async uploadEmployeeOnboardingDocument(
    actorUserId: string,
    employeeId: string,
    docType: string,
    file: Express.Multer.File | undefined,
  ) {
    if (!this.isEmployeeOnboardingDocType(docType)) {
      throw new BadRequestException('不支援的入職文件類型');
    }

    if (!file) {
      throw new BadRequestException('請選擇要上傳的檔案');
    }

    if (file.size > this.maxOnboardingDocumentSizeBytes) {
      throw new BadRequestException('單一檔案大小不可超過 5MB');
    }

    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      include: this.buildEmployeeInclude(),
    });

    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    const access = await this.getEmployeeDataAccessContext(
      actorUserId,
      employee.entityId,
    );
    const visibleEmployee = await this.prisma.employee.findFirst({
      where: {
        id: employee.id,
        ...this.buildEmployeeAccessWhere(access),
      },
      select: { id: true },
    });
    if (!visibleEmployee) {
      throw new NotFoundException('Employee not found');
    }

    const uploaded = await this.prisma.employeeOnboardingDocument.upsert({
      where: {
        employeeId_docType: {
          employeeId,
          docType,
        },
      },
      create: {
        employeeId,
        docType,
        status: 'UPLOADED',
        fileName: file.originalname,
        mimeType: file.mimetype,
        fileSize: file.size,
        fileDataBase64: file.buffer.toString('base64'),
        uploadedAt: new Date(),
        verifiedAt: null,
        verifiedBy: null,
      },
      update: {
        status: 'UPLOADED',
        fileName: file.originalname,
        mimeType: file.mimetype,
        fileSize: file.size,
        fileDataBase64: file.buffer.toString('base64'),
        uploadedAt: new Date(),
        verifiedAt: null,
        verifiedBy: null,
      },
      select: {
        id: true,
        docType: true,
        status: true,
        fileName: true,
        mimeType: true,
        fileSize: true,
        uploadedAt: true,
        verifiedAt: true,
        verifiedBy: true,
      },
    });

    await this.auditLogService.record({
      userId: actorUserId,
      tableName: 'employee_onboarding_documents',
      recordId: uploaded.id,
      action: 'UPLOAD',
      newData: {
        employeeId,
        docType,
        fileName: uploaded.fileName,
        mimeType: uploaded.mimeType,
        fileSize: uploaded.fileSize,
        status: uploaded.status,
      },
    });

    return uploaded;
  }

  async updateEmployeeOnboardingDocumentStatus(
    actorUserId: string,
    employeeId: string,
    docType: string,
    data: {
      status: 'PENDING' | 'UPLOADED' | 'VERIFIED';
      clearFile?: boolean;
    },
  ) {
    if (!this.isEmployeeOnboardingDocType(docType)) {
      throw new BadRequestException('不支援的入職文件類型');
    }

    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, entityId: true },
    });

    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    const access = await this.getEmployeeDataAccessContext(
      actorUserId,
      employee.entityId,
    );
    const visibleEmployee = await this.prisma.employee.findFirst({
      where: {
        id: employee.id,
        ...this.buildEmployeeAccessWhere(access),
      },
      select: { id: true },
    });
    if (!visibleEmployee) {
      throw new NotFoundException('Employee not found');
    }

    const existing = await this.prisma.employeeOnboardingDocument.findUnique({
      where: {
        employeeId_docType: {
          employeeId,
          docType,
        },
      },
    });

    if (!existing && data.status !== 'PENDING') {
      throw new BadRequestException('請先上傳文件，再更新狀態');
    }

    if (data.status === 'VERIFIED' && !existing?.fileDataBase64) {
      throw new BadRequestException('尚未上傳文件，無法標記為已核實');
    }

    if (!existing && data.status === 'PENDING') {
      return {
        id: `${employeeId}:${docType}`,
        docType,
        status: 'PENDING',
        fileName: null,
        mimeType: null,
        fileSize: undefined,
        uploadedAt: null,
        verifiedAt: null,
        verifiedBy: null,
      };
    }

    const nextDocument =
      data.status === 'PENDING' || data.clearFile
        ? await this.prisma.employeeOnboardingDocument.upsert({
            where: {
              employeeId_docType: {
                employeeId,
                docType,
              },
            },
            create: {
              employeeId,
              docType,
              status: 'PENDING',
            },
            update: {
              status: 'PENDING',
              fileName: null,
              mimeType: null,
              fileSize: null,
              fileDataBase64: null,
              uploadedAt: null,
              verifiedAt: null,
              verifiedBy: null,
            },
            select: {
              id: true,
              docType: true,
              status: true,
              fileName: true,
              mimeType: true,
              fileSize: true,
              uploadedAt: true,
              verifiedAt: true,
              verifiedBy: true,
            },
          })
        : await this.prisma.employeeOnboardingDocument.update({
            where: {
              employeeId_docType: {
                employeeId,
                docType,
              },
            },
            data: {
              status: data.status,
              verifiedAt: data.status === 'VERIFIED' ? new Date() : null,
              verifiedBy: data.status === 'VERIFIED' ? actorUserId : null,
            },
            select: {
              id: true,
              docType: true,
              status: true,
              fileName: true,
              mimeType: true,
              fileSize: true,
              uploadedAt: true,
              verifiedAt: true,
              verifiedBy: true,
            },
          });

    await this.auditLogService.record({
      userId: actorUserId,
      tableName: 'employee_onboarding_documents',
      recordId: nextDocument.id,
      action: 'UPDATE',
      oldData: existing
        ? {
            status: existing.status,
            fileName: existing.fileName,
            verifiedAt: existing.verifiedAt,
          }
        : null,
      newData: {
        status: nextDocument.status,
        fileName: nextDocument.fileName,
        verifiedAt: nextDocument.verifiedAt,
      },
    });

    return nextDocument;
  }

  async downloadEmployeeOnboardingDocument(
    actorUserId: string,
    employeeId: string,
    docType: string,
  ) {
    if (!this.isEmployeeOnboardingDocType(docType)) {
      throw new BadRequestException('不支援的入職文件類型');
    }

    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, entityId: true, employeeNo: true },
    });

    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    const access = await this.getEmployeeDataAccessContext(
      actorUserId,
      employee.entityId,
    );
    const visibleEmployee = await this.prisma.employee.findFirst({
      where: {
        id: employee.id,
        ...this.buildEmployeeAccessWhere(access),
      },
      select: { id: true },
    });
    if (!visibleEmployee) {
      throw new NotFoundException('Employee not found');
    }

    const document = await this.prisma.employeeOnboardingDocument.findUnique({
      where: {
        employeeId_docType: {
          employeeId,
          docType,
        },
      },
      select: {
        fileName: true,
        mimeType: true,
        fileDataBase64: true,
      },
    });

    if (!document?.fileName || !document.fileDataBase64) {
      throw new NotFoundException('Onboarding document not found');
    }

    return {
      filename: document.fileName,
      mimeType: document.mimeType || 'application/octet-stream',
      buffer: Buffer.from(document.fileDataBase64, 'base64'),
    };
  }

  async getMyEmployeeProfile(userId: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { userId },
      include: this.buildEmployeeInclude(),
    });

    if (!employee) {
      throw new NotFoundException('Employee profile not found');
    }

    return this.serializeEmployee(employee);
  }

  async updateMyEmployeeProfile(
    userId: string,
    data: {
      nationalId?: string | null;
      mailingAddress?: string | null;
    },
  ) {
    const employee = await this.prisma.employee.findUnique({
      where: { userId },
      include: this.buildEmployeeInclude(),
    });

    if (!employee) {
      throw new NotFoundException('Employee profile not found');
    }

    const updatedEmployee = await this.prisma.employee.update({
      where: { id: employee.id },
      data: {
        ...(data.nationalId !== undefined
          ? { nationalId: data.nationalId?.trim() || null }
          : {}),
        ...(data.mailingAddress !== undefined
          ? { mailingAddress: data.mailingAddress?.trim() || null }
          : {}),
      },
      include: this.buildEmployeeInclude(),
    });

    await this.auditLogService.record({
      userId,
      tableName: 'employees',
      recordId: employee.id,
      action: 'UPDATE',
      oldData: this.serializeEmployee(employee),
      newData: this.serializeEmployee(updatedEmployee),
    });

    return this.serializeEmployee(updatedEmployee);
  }

  async uploadMyOnboardingDocument(
    userId: string,
    docType: string,
    file: Express.Multer.File | undefined,
  ) {
    const employee = await this.prisma.employee.findUnique({
      where: { userId },
      select: { id: true },
    });

    if (!employee) {
      throw new NotFoundException('Employee profile not found');
    }

    return this.uploadEmployeeOnboardingDocument(
      userId,
      employee.id,
      docType,
      file,
    );
  }

  async downloadMyOnboardingDocument(userId: string, docType: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { userId },
      select: { id: true },
    });

    if (!employee) {
      throw new NotFoundException('Employee profile not found');
    }

    return this.downloadEmployeeOnboardingDocument(userId, employee.id, docType);
  }

  async getOnboardingReviewQueue(userId: string) {
    const access = await this.getEmployeeDataAccessContext(userId);
    const employees = await this.prisma.employee.findMany({
      where: this.buildEmployeeAccessWhere(access),
      include: {
        department: true,
        onboardingDocuments: {
          where: {
            status: {
              in: ['UPLOADED', 'VERIFIED'],
            },
          },
          select: {
            id: true,
            docType: true,
            status: true,
            fileName: true,
            mimeType: true,
            fileSize: true,
            uploadedAt: true,
            verifiedAt: true,
            verifiedBy: true,
          },
          orderBy: [{ uploadedAt: 'desc' }],
        },
      },
      orderBy: [{ hireDate: 'desc' }, { employeeNo: 'asc' }],
    });

    return employees
      .map((employee) => ({
        employeeId: employee.id,
        employeeNo: employee.employeeNo,
        employeeName: employee.name,
        departmentName: employee.department?.name ?? null,
        hireDate: employee.hireDate,
        documents: employee.onboardingDocuments,
      }))
      .filter((employee) =>
        employee.documents.some((document) => document.status === 'UPLOADED'),
      );
  }

  async getBankAccounts(userId: string, entityId?: string) {
    const resolvedEntityId = await this.resolveEntityId(userId, entityId);

    return this.prisma.bankAccount.findMany({
      where: {
        entityId: resolvedEntityId,
        isActive: true,
      },
      orderBy: [{ bankName: 'asc' }, { accountNo: 'asc' }],
    });
  }

  private async ensureUserAssignable(
    employeeUserId?: string | null,
    excludeEmployeeId?: string,
  ) {
    if (employeeUserId === undefined) {
      return;
    }

    if (employeeUserId === null || employeeUserId === '') {
      return;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: employeeUserId },
      select: { id: true, isActive: true },
    });

    if (!user) {
      throw new NotFoundException('Assigned user not found');
    }

    if (!user.isActive) {
      throw new BadRequestException('Assigned user is inactive');
    }

    const linkedEmployee = await this.prisma.employee.findFirst({
      where: {
        userId: employeeUserId,
        ...(excludeEmployeeId
          ? {
              id: { not: excludeEmployeeId },
            }
          : {}),
      },
      select: {
        id: true,
        employeeNo: true,
        name: true,
      },
    });

    if (linkedEmployee) {
      throw new ConflictException(
        `User is already linked to employee ${linkedEmployee.employeeNo} ${linkedEmployee.name}`,
      );
    }
  }

  async getPayrollRuns(userId: string, entityId?: string) {
    const access = await this.getPayrollDataAccessContext(userId, entityId);
    const itemWhere = this.buildPayrollItemAccessWhere(access);

    const runs = await this.prisma.payrollRun.findMany({
      where: {
        entityId: access.entityId,
        ...(itemWhere ? { items: { some: itemWhere } } : {}),
      },
      include: {
        items: itemWhere ? { where: itemWhere } : true,
        creator: {
          select: { id: true, name: true },
        },
        approver: {
          select: { id: true, name: true },
        },
        payor: {
          select: { id: true, name: true },
        },
        bankAccount: {
          select: {
            id: true,
            bankName: true,
            accountNo: true,
            currency: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return runs.map((run) => this.serializePayrollRun(run));
  }

  async getLegacyPayrolls(
    userId: string,
    entityId?: string,
    year?: number,
    month?: number,
  ) {
    const runs = await this.getPayrollRuns(userId, entityId);

    return runs.filter((run) => {
      const payDate = new Date(run.payDate);
      if (year !== undefined && payDate.getFullYear() !== Number(year)) {
        return false;
      }

      if (month !== undefined && payDate.getMonth() + 1 !== Number(month)) {
        return false;
      }

      return true;
    });
  }

  async getPayrollRunById(userId: string, id: string) {
    const access = await this.getPayrollDataAccessContext(userId);
    const itemWhere = this.buildPayrollItemAccessWhere(access);
    const run = await this.prisma.payrollRun.findFirst({
      where: {
        id,
        entityId: access.entityId,
        ...(itemWhere ? { items: { some: itemWhere } } : {}),
      },
      include: {
        entity: {
          select: { id: true, name: true },
        },
        creator: {
          select: { id: true, name: true },
        },
        approver: {
          select: { id: true, name: true },
        },
        payor: {
          select: { id: true, name: true },
        },
        bankAccount: {
          select: {
            id: true,
            bankName: true,
            accountNo: true,
            currency: true,
          },
        },
        items: itemWhere
          ? {
              where: itemWhere,
              include: {
                employee: {
                  select: {
                    id: true,
                    employeeNo: true,
                    name: true,
                  },
                },
              },
              orderBy: [{ employeeId: 'asc' }, { type: 'asc' }],
            }
          : {
              include: {
                employee: {
                  select: {
                    id: true,
                    employeeNo: true,
                    name: true,
                  },
                },
              },
              orderBy: [{ employeeId: 'asc' }, { type: 'asc' }],
            },
      },
    });

    if (!run) {
      throw new NotFoundException('Payroll run not found');
    }

    return this.serializePayrollRun(run);
  }

  async getPayrollRunAuditLogs(userId: string, id: string) {
    await this.getPayrollRunById(userId, id);

    const logs = await this.auditLogService.listByRecord('payroll_runs', id);
    return logs.map((log) => this.serializeAuditLog(log));
  }

  async getMyPayrollRuns(userId: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { userId },
      select: {
        id: true,
      },
    });

    if (!employee) {
      return [];
    }

    const runs = await this.prisma.payrollRun.findMany({
      where: {
        status: {
          in: ['approved', 'posted', 'paid'],
        },
        items: {
          some: {
            employeeId: employee.id,
          },
        },
      },
      include: {
        creator: {
          select: { id: true, name: true },
        },
        approver: {
          select: { id: true, name: true },
        },
        payor: {
          select: { id: true, name: true },
        },
        bankAccount: {
          select: {
            id: true,
            bankName: true,
            accountNo: true,
            currency: true,
          },
        },
        items: {
          where: {
            employeeId: employee.id,
          },
          include: {
            employee: {
              select: {
                id: true,
                employeeNo: true,
                name: true,
              },
            },
          },
          orderBy: { type: 'asc' },
        },
      },
      orderBy: { payDate: 'desc' },
    });

    return runs.map((run) => this.serializePayrollRun(run));
  }

  async getMyPayrollRunById(userId: string, id: string) {
    const employee = await this.getEmployeeForUser(userId);
    const run = await this.prisma.payrollRun.findFirst({
      where: {
        id,
        status: {
          in: ['approved', 'posted', 'paid'],
        },
        items: {
          some: {
            employeeId: employee.id,
          },
        },
      },
      include: {
        entity: {
          select: { id: true, name: true },
        },
        creator: {
          select: { id: true, name: true },
        },
        approver: {
          select: { id: true, name: true },
        },
        payor: {
          select: { id: true, name: true },
        },
        bankAccount: {
          select: {
            id: true,
            bankName: true,
            accountNo: true,
            currency: true,
          },
        },
        items: {
          where: {
            employeeId: employee.id,
          },
          include: {
            employee: {
              select: {
                id: true,
                employeeNo: true,
                name: true,
              },
            },
          },
          orderBy: { type: 'asc' },
        },
      },
    });

    if (!run) {
      throw new NotFoundException('Payroll run not found');
    }

    return this.serializePayrollRun(run);
  }

  async getPayrollRunPdf(userId: string, id: string, employeeId?: string) {
    const access = await this.getPayrollDataAccessContext(userId);
    const itemWhere = this.buildPayrollItemAccessWhere(access);
    const run = await this.prisma.payrollRun.findFirst({
      where: {
        id,
        entityId: access.entityId,
        ...(itemWhere ? { items: { some: itemWhere } } : {}),
      },
      include: {
        entity: {
          select: { id: true, name: true },
        },
        approver: {
          select: { id: true, name: true },
        },
        bankAccount: {
          select: {
            id: true,
            bankName: true,
            accountNo: true,
            currency: true,
          },
        },
        items: itemWhere
          ? {
              where: itemWhere,
              include: {
                employee: {
                  select: {
                    id: true,
                    employeeNo: true,
                    name: true,
                    department: {
                      select: {
                        name: true,
                      },
                    },
                  },
                },
              },
              orderBy: { type: 'asc' },
            }
          : {
              include: {
                employee: {
                  select: {
                    id: true,
                    employeeNo: true,
                    name: true,
                    department: {
                      select: {
                        name: true,
                      },
                    },
                  },
                },
              },
              orderBy: { type: 'asc' },
            },
      },
    });

    if (!run) {
      throw new NotFoundException('Payroll run not found');
    }

    const availableEmployeeIds = Array.from(
      new Set(run.items.map((item) => item.employeeId)),
    );
    const resolvedEmployeeId =
      employeeId ||
      (availableEmployeeIds.length === 1 ? availableEmployeeIds[0] : undefined);

    if (!resolvedEmployeeId) {
      throw new BadRequestException('請指定要下載哪位員工的薪資單');
    }

    const employeeItems = run.items.filter(
      (item) => item.employeeId === resolvedEmployeeId,
    );

    if (employeeItems.length === 0) {
      throw new NotFoundException(
        'Payroll items not found for selected employee',
      );
    }

    const employee = employeeItems[0].employee;
    const buffer = await this.buildPayslipPdfBuffer({
      run,
      employee,
      items: employeeItems,
    });

    return {
      buffer,
      filename: this.buildPayslipFileName(employee.employeeNo, run.payDate),
    };
  }

  async getMyPayrollRunPdf(userId: string, id: string) {
    const employee = await this.getEmployeeForUser(userId);
    const run = await this.prisma.payrollRun.findFirst({
      where: {
        id,
        status: {
          in: ['approved', 'posted', 'paid'],
        },
        items: {
          some: {
            employeeId: employee.id,
          },
        },
      },
      include: {
        entity: {
          select: { id: true, name: true },
        },
        approver: {
          select: { id: true, name: true },
        },
        bankAccount: {
          select: {
            id: true,
            bankName: true,
            accountNo: true,
            currency: true,
          },
        },
        items: {
          where: {
            employeeId: employee.id,
          },
          include: {
            employee: {
              select: {
                id: true,
                employeeNo: true,
                name: true,
                department: {
                  select: {
                    name: true,
                  },
                },
              },
            },
          },
          orderBy: { type: 'asc' },
        },
      },
    });

    if (!run || run.items.length === 0) {
      throw new NotFoundException('Payroll run not found');
    }

    const buffer = await this.buildPayslipPdfBuffer({
      run,
      employee: run.items[0].employee,
      items: run.items,
    });

    return {
      buffer,
      filename: this.buildPayslipFileName(employee.employeeNo, run.payDate),
    };
  }

  async previewPayrollRunWarnings(
    data: {
      entityId?: string;
      periodStart: Date | string;
      periodEnd: Date | string;
      payDate?: Date | string;
    },
    userId: string,
  ) {
    const access = await this.getPayrollDataAccessContext(userId, data.entityId);
    const entityId = access.entityId;
    const periodStart = this.startOfDay(
      this.normalizeInputDate(data.periodStart, '計薪期間開始日'),
    );
    const periodEnd = this.endOfDay(
      this.normalizeInputDate(data.periodEnd, '計薪期間結束日'),
    );

    if (periodEnd < periodStart) {
      throw new BadRequestException('計薪期間結束日不可早於開始日');
    }

    const employees = await this.prisma.employee.findMany({
      where: {
        ...this.buildEmployeeAccessWhere(access),
        isActive: true,
        hireDate: { lte: periodEnd },
        OR: [{ terminateDate: null }, { terminateDate: { gte: periodStart } }],
      },
      select: {
        id: true,
        employeeNo: true,
        name: true,
        departmentId: true,
        location: true,
        hireDate: true,
        terminateDate: true,
        department: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: [{ department: { name: 'asc' } }, { employeeNo: 'asc' }],
    });

    if (employees.length === 0) {
      return {
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        periodWorkdayCount: 0,
        employeesChecked: 0,
        issueCount: 0,
        issues: [],
      };
    }

    const employeeIds = employees.map((employee) => employee.id);
    const departmentIds = Array.from(
      new Set(
        employees
          .map((employee) => employee.departmentId)
          .filter((value): value is string => Boolean(value)),
      ),
    );

    const [dailySummaries, leaveRequests, schedules, closures] =
      await Promise.all([
        this.prisma.attendanceDailySummary.findMany({
          where: {
            entityId,
            employeeId: { in: employeeIds },
            workDate: {
              gte: periodStart,
              lte: periodEnd,
            },
          },
          select: {
            employeeId: true,
            workDate: true,
            status: true,
            clockInTime: true,
            clockOutTime: true,
            anomalyReason: true,
          },
        }),
        this.prisma.leaveRequest.findMany({
          where: {
            entityId,
            employeeId: { in: employeeIds },
            status: { in: ['SUBMITTED', 'APPROVED'] },
            startAt: { lte: periodEnd },
            endAt: { gte: periodStart },
          },
          select: {
            employeeId: true,
            startAt: true,
            endAt: true,
            status: true,
            leaveType: {
              select: {
                name: true,
              },
            },
          },
        }),
        this.prisma.attendanceSchedule.findMany({
          where: {
            policy: {
              entityId,
            },
            OR: [
              { employeeId: { in: employeeIds } },
              departmentIds.length > 0
                ? { departmentId: { in: departmentIds } }
                : { id: '__NO_DEPARTMENT_SCOPE__' },
              { employeeId: null, departmentId: null },
            ],
          },
          select: {
            employeeId: true,
            departmentId: true,
            weekday: true,
          },
        }),
        this.prisma.disasterClosureEvent.findMany({
          where: {
            entityId,
            isActive: true,
            closureDate: {
              gte: periodStart,
              lte: periodEnd,
            },
          },
          select: {
            id: true,
            name: true,
            closureDate: true,
            scopeType: true,
            scopeIds: true,
          },
          orderBy: { closureDate: 'asc' },
        }),
      ]);

    const summaryByEmployeeDate = new Map<string, (typeof dailySummaries)[number]>();
    for (const summary of dailySummaries) {
      summaryByEmployeeDate.set(
        `${summary.employeeId}:${this.dateKey(summary.workDate)}`,
        summary,
      );
    }

    const leaveByEmployeeDate = new Map<
      string,
      { status: string; leaveTypeName: string }[]
    >();
    for (const leaveRequest of leaveRequests) {
      const leaveStart = this.startOfDay(leaveRequest.startAt);
      const leaveEnd = this.startOfDay(leaveRequest.endAt);
      const effectiveStart = leaveStart > periodStart ? leaveStart : periodStart;
      const effectiveEnd = leaveEnd < periodEnd ? leaveEnd : this.startOfDay(periodEnd);
      const dates = this.enumerateDates(effectiveStart, effectiveEnd);
      for (const date of dates) {
        const key = `${leaveRequest.employeeId}:${this.dateKey(date)}`;
        const current = leaveByEmployeeDate.get(key) ?? [];
        current.push({
          status: leaveRequest.status,
          leaveTypeName: leaveRequest.leaveType?.name ?? '請假',
        });
        leaveByEmployeeDate.set(key, current);
      }
    }

    const employeeWeekdays = new Map<string, Set<number>>();
    const departmentWeekdays = new Map<string, Set<number>>();
    const globalWeekdays: number[] = [];

    for (const schedule of schedules) {
      if (schedule.employeeId) {
        const current = employeeWeekdays.get(schedule.employeeId) ?? new Set<number>();
        current.add(schedule.weekday);
        employeeWeekdays.set(schedule.employeeId, current);
        continue;
      }

      if (schedule.departmentId) {
        const current =
          departmentWeekdays.get(schedule.departmentId) ?? new Set<number>();
        current.add(schedule.weekday);
        departmentWeekdays.set(schedule.departmentId, current);
        continue;
      }

      globalWeekdays.push(schedule.weekday);
    }

    const globalWeekdaySet =
      globalWeekdays.length > 0
        ? this.buildWeekdaySet(globalWeekdays)
        : this.defaultWeekdaySet;

    const entityWideClosureDates = new Set(
      closures
        .filter((closure) => closure.scopeType === 'ENTITY')
        .map((closure) => this.dateKey(closure.closureDate)),
    );

    const periodWorkdayCount = this.enumerateDates(periodStart, periodEnd).filter(
      (date) =>
        globalWeekdaySet.has(date.getDay()) &&
        !entityWideClosureDates.has(this.dateKey(date)),
    ).length;

    const issues: Array<{
      employeeId: string;
      employeeNo: string;
      employeeName: string;
      departmentName: string | null;
      workDate: string;
      issueType: 'MISSING_ATTENDANCE_OR_LEAVE' | 'INCOMPLETE_CLOCK';
      scheduleSource: 'employee' | 'department' | 'global' | 'default';
      detail: string;
      summaryStatus: string | null;
    }> = [];

    for (const employee of employees) {
      const employeeStart =
        this.startOfDay(employee.hireDate) > periodStart
          ? this.startOfDay(employee.hireDate)
          : periodStart;
      const employeeEnd =
        employee.terminateDate && this.endOfDay(employee.terminateDate) < periodEnd
          ? this.endOfDay(employee.terminateDate)
          : periodEnd;

      if (employeeEnd < employeeStart) {
        continue;
      }

      let applicableWeekdays = employeeWeekdays.get(employee.id);
      let scheduleSource: 'employee' | 'department' | 'global' | 'default' =
        'employee';

      if (!applicableWeekdays && employee.departmentId) {
        applicableWeekdays = departmentWeekdays.get(employee.departmentId);
        scheduleSource = 'department';
      }

      if (!applicableWeekdays && globalWeekdays.length > 0) {
        applicableWeekdays = globalWeekdaySet;
        scheduleSource = 'global';
      }

      if (!applicableWeekdays) {
        applicableWeekdays = this.defaultWeekdaySet;
        scheduleSource = 'default';
      }

      const employeeClosures = closures
        .filter((closure) => this.closureAppliesToEmployee(closure, employee))
        .map((closure) => this.dateKey(closure.closureDate));
      const employeeClosureDates = new Set(employeeClosures);

      for (const date of this.enumerateDates(employeeStart, employeeEnd)) {
        if (!applicableWeekdays.has(date.getDay())) {
          continue;
        }

        const workDate = this.dateKey(date);
        if (employeeClosureDates.has(workDate)) {
          continue;
        }

        const leaveKey = `${employee.id}:${workDate}`;
        if ((leaveByEmployeeDate.get(leaveKey) ?? []).length > 0) {
          continue;
        }

        const summaryKey = `${employee.id}:${workDate}`;
        const summary = summaryByEmployeeDate.get(summaryKey);

        if (!summary) {
          issues.push({
            employeeId: employee.id,
            employeeNo: employee.employeeNo,
            employeeName: employee.name,
            departmentName: employee.department?.name ?? null,
            workDate,
            issueType: 'MISSING_ATTENDANCE_OR_LEAVE',
            scheduleSource,
            summaryStatus: null,
            detail: '該工作日沒有打卡摘要，也沒有已送出或已核准的請假紀錄。',
          });
          continue;
        }

        if (
          summary.status === 'disaster_closure' ||
          (summary.clockInTime && summary.clockOutTime && summary.status !== 'missing_clock')
        ) {
          continue;
        }

        issues.push({
          employeeId: employee.id,
          employeeNo: employee.employeeNo,
          employeeName: employee.name,
          departmentName: employee.department?.name ?? null,
          workDate,
          issueType: 'INCOMPLETE_CLOCK',
          scheduleSource,
          summaryStatus: summary.status ?? null,
          detail:
            !summary.clockInTime && !summary.clockOutTime
              ? '有出勤摘要，但沒有完整打卡時間，請確認是否漏打卡或需要補請假。'
              : !summary.clockInTime
                ? '缺少上班打卡時間，請確認是否忘記上班打卡。'
                : '缺少下班打卡時間，請確認是否忘記下班打卡。',
        });
      }
    }

    issues.sort((left, right) => {
      const dateCompare = left.workDate.localeCompare(right.workDate);
      if (dateCompare !== 0) {
        return dateCompare;
      }
      return left.employeeNo.localeCompare(right.employeeNo);
    });

    return {
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      periodWorkdayCount,
      employeesChecked: employees.length,
      issueCount: issues.length,
      issues,
    };
  }
  /**
   * 建立薪資批次
   */
  async createPayrollRun(
    data: {
      entityId?: string;
      periodStart: Date | string;
      periodEnd: Date | string;
      payDate: Date | string;
    },
    userId: string,
  ) {
    const access = await this.getPayrollDataAccessContext(userId, data.entityId);
    const entityId = access.entityId;
    const periodStart = this.startOfDay(
      this.normalizeInputDate(data.periodStart, '計薪期間開始日'),
    );
    const periodEnd = this.endOfDay(
      this.normalizeInputDate(data.periodEnd, '計薪期間結束日'),
    );
    const payDate = this.normalizeInputDate(data.payDate, '預計發薪日');

    if (periodEnd < periodStart) {
      throw new BadRequestException('計薪期間結束日不可早於開始日');
    }

    const overlappingRun = await this.prisma.payrollRun.findFirst({
      where: {
        entityId,
        periodStart,
        periodEnd,
      },
      select: { id: true },
    });

    if (overlappingRun) {
      throw new BadRequestException('相同計薪期間的薪資批次已存在');
    }

    // 1. Get Entity to know the country
    const entity = await this.prisma.entity.findUnique({
      where: { id: entityId },
    });
    if (!entity) throw new Error('Entity not found');

    // 2. Create Payroll Run Header
    const payrollRun = await this.prisma.payrollRun.create({
      data: {
        entityId,
        country: entity.country,
        periodStart,
        periodEnd,
        payDate,
        status: 'draft',
        createdBy: userId,
      },
    });

    // 3. Get Active Employees
    const employees = await this.prisma.employee.findMany({
      where: {
        ...this.buildEmployeeAccessWhere(access),
        isActive: true,
        hireDate: { lte: periodEnd },
        OR: [{ terminateDate: null }, { terminateDate: { gte: periodStart } }],
      },
    });

    this.logger.log(`Found ${employees.length} employees for payroll run`);

    // 4. Calculate and Create Items for each employee
    for (const employee of employees) {
      try {
        const calculation = await this.calculateEmployeePayroll(
          employee.id,
          periodStart,
          periodEnd,
        );

        // Save items
        if (calculation.items && calculation.items.length > 0) {
          await this.prisma.payrollItem.createMany({
            data: calculation.items.map((item) => ({
              payrollRunId: payrollRun.id,
              employeeId: employee.id,
              type: item.type,
              amountOriginal: item.amount,
              amountCurrency: entity.baseCurrency,
              amountFxRate: 1, // Assuming base currency for now
              amountBase: item.amount,
              currency: entity.baseCurrency,
              remark: item.remark,
            })),
          });
        }
      } catch (error) {
        this.logger.error(
          `Failed to calculate payroll for employee ${employee.id}: ${error.message}`,
        );
      }
    }

    const createdRun = await this.getPayrollRunById(userId, payrollRun.id);

    await this.auditLogService.record({
      userId,
      tableName: 'payroll_runs',
      recordId: payrollRun.id,
      action: 'CREATE',
      newData: {
        entityId,
        periodStart,
        periodEnd,
        payDate,
        status: 'draft',
        employeeCount: createdRun.employeeCount,
        totalAmount: createdRun.totalAmount,
      },
    });

    return createdRun;
  }

  async submitPayrollRun(id: string, userId: string) {
    const run = await this.prisma.payrollRun.findUnique({
      where: { id },
      include: {
        items: {
          select: { id: true },
        },
      },
    });

    if (!run) {
      throw new NotFoundException('Payroll run not found');
    }

    if (run.status !== 'draft') {
      throw new BadRequestException('只有草稿批次可以送審');
    }

    if (run.items.length === 0) {
      throw new BadRequestException('薪資批次尚未產生任何薪資明細');
    }

    await this.prisma.payrollRun.update({
      where: { id },
      data: {
        status: 'pending_approval',
        approvedBy: null,
        approvedAt: null,
      },
    });

    const existingApproval = await this.prisma.approvalRequest.findFirst({
      where: {
        type: 'payroll_run',
        refId: id,
      },
      select: { id: true },
    });

    if (existingApproval) {
      await this.prisma.approvalRequest.update({
        where: { id: existingApproval.id },
        data: {
          status: 'pending',
          requestedBy: userId,
          approverId: null,
          approvedAt: null,
        },
      });
    } else {
      await this.prisma.approvalRequest.create({
        data: {
          entityId: run.entityId,
          type: 'payroll_run',
          refId: id,
          status: 'pending',
          requestedBy: userId,
        },
      });
    }

    await this.auditLogService.record({
      userId,
      tableName: 'payroll_runs',
      recordId: id,
      action: 'SUBMIT',
      oldData: {
        status: run.status,
      },
      newData: {
        status: 'pending_approval',
      },
    });

    return this.getPayrollRunById(userId, id);
  }

  async approvePayrollRun(id: string, userId: string) {
    const run = await this.prisma.payrollRun.findUnique({
      where: { id },
      select: {
        id: true,
        entityId: true,
        status: true,
      },
    });

    if (!run) {
      throw new NotFoundException('Payroll run not found');
    }

    if (run.status !== 'pending_approval') {
      throw new BadRequestException('只有待批准批次可以批准');
    }

    const approvedAt = new Date();

    await this.prisma.payrollRun.update({
      where: { id },
      data: {
        status: 'approved',
        approvedBy: userId,
        approvedAt,
      },
    });

    const existingApproval = await this.prisma.approvalRequest.findFirst({
      where: {
        type: 'payroll_run',
        refId: id,
      },
      select: { id: true },
    });

    if (existingApproval) {
      await this.prisma.approvalRequest.update({
        where: { id: existingApproval.id },
        data: {
          status: 'approved',
          approverId: userId,
          approvedAt,
        },
      });
    } else {
      await this.prisma.approvalRequest.create({
        data: {
          entityId: run.entityId,
          type: 'payroll_run',
          refId: id,
          status: 'approved',
          requestedBy: userId,
          approverId: userId,
          approvedAt,
        },
      });
    }

    await this.auditLogService.record({
      userId,
      tableName: 'payroll_runs',
      recordId: id,
      action: 'APPROVE',
      oldData: {
        status: run.status,
      },
      newData: {
        status: 'approved',
        approvedAt,
      },
    });

    return this.getPayrollRunById(userId, id);
  }

  async postPayrollRun(id: string, userId: string) {
    const run = await this.prisma.payrollRun.findUnique({
      where: { id },
      include: {
        entity: true,
        items: true,
      },
    });

    if (!run) {
      throw new NotFoundException('Payroll run not found');
    }

    if (run.status !== 'approved') {
      throw new BadRequestException('只有已批准批次可以過帳');
    }

    const postingAmount = run.items.reduce(
      (sum, item) => sum + this.toNumber(item.amountBase),
      0,
    );

    if (postingAmount <= 0) {
      throw new BadRequestException('薪資批次金額異常，無法過帳');
    }

    const [salaryExpenseAccount, payrollPayableAccount] = await Promise.all([
      this.prisma.account.findUnique({
        where: {
          entityId_code: {
            entityId: run.entityId,
            code: '6111',
          },
        },
      }),
      this.prisma.account.findUnique({
        where: {
          entityId_code: {
            entityId: run.entityId,
            code: '2191',
          },
        },
      }),
    ]);

    if (!salaryExpenseAccount || !payrollPayableAccount) {
      throw new NotFoundException('缺少薪資過帳所需會計科目（6111 / 2191）');
    }

    const period = await this.prisma.period.findFirst({
      where: {
        entityId: run.entityId,
        status: 'open',
        startDate: { lte: run.payDate },
        endDate: { gte: run.payDate },
      },
      select: { id: true },
    });

    const existingJournal = await this.prisma.journalEntry.findFirst({
      where: {
        sourceModule: 'payroll',
        sourceId: run.id,
      },
      select: { id: true, approvedAt: true },
    });

    if (!existingJournal) {
      const journalEntry = await this.journalService.createJournalEntry({
        entityId: run.entityId,
        date: run.payDate,
        description: `薪資批次過帳 ${run.entity.name} ${run.periodStart.toISOString().slice(0, 10)} ~ ${run.periodEnd.toISOString().slice(0, 10)}`,
        sourceModule: 'payroll',
        sourceId: run.id,
        periodId: period?.id,
        createdBy: userId,
        lines: [
          {
            accountId: salaryExpenseAccount.id,
            debit: postingAmount,
            credit: 0,
            amountBase: postingAmount,
            memo: '薪資支出',
          },
          {
            accountId: payrollPayableAccount.id,
            debit: 0,
            credit: postingAmount,
            amountBase: postingAmount,
            memo: '應付薪資',
          },
        ],
      });

      await this.journalService.approveJournalEntry(journalEntry.id, userId);
    } else if (!existingJournal.approvedAt) {
      await this.journalService.approveJournalEntry(existingJournal.id, userId);
    }

    await this.prisma.payrollRun.update({
      where: { id },
      data: {
        status: 'posted',
      },
    });

    await this.auditLogService.record({
      userId,
      tableName: 'payroll_runs',
      recordId: id,
      action: 'POST',
      oldData: {
        status: run.status,
      },
      newData: {
        status: 'posted',
        postingAmount,
      },
    });

    return this.getPayrollRunById(userId, id);
  }

  async payPayrollRun(
    id: string,
    userId: string,
    data: { bankAccountId: string; paidAt?: string },
  ) {
    const run = await this.prisma.payrollRun.findUnique({
      where: { id },
      include: {
        entity: true,
        items: true,
      },
    });

    if (!run) {
      throw new NotFoundException('Payroll run not found');
    }

    if (run.status !== 'posted') {
      throw new BadRequestException('只有已過帳批次可以標記已發薪');
    }

    const bankAccount = await this.prisma.bankAccount.findFirst({
      where: {
        id: data.bankAccountId,
        entityId: run.entityId,
        isActive: true,
      },
    });

    if (!bankAccount) {
      throw new NotFoundException('Bank account not found');
    }

    const payAmount = run.items.reduce(
      (sum, item) => sum + this.toNumber(item.amountBase),
      0,
    );

    if (payAmount <= 0) {
      throw new BadRequestException('薪資批次實發金額異常，無法標記已發薪');
    }

    const [payrollPayableAccount, bankDepositAccount] = await Promise.all([
      this.prisma.account.findUnique({
        where: {
          entityId_code: {
            entityId: run.entityId,
            code: '2191',
          },
        },
      }),
      this.prisma.account.findUnique({
        where: {
          entityId_code: {
            entityId: run.entityId,
            code: '1113',
          },
        },
      }),
    ]);

    if (!payrollPayableAccount || !bankDepositAccount) {
      throw new NotFoundException('缺少薪資付款所需會計科目（2191 / 1113）');
    }

    const paidAt = data.paidAt ? new Date(data.paidAt) : new Date();

    const existingPaymentJournal = await this.prisma.journalEntry.findFirst({
      where: {
        sourceModule: 'payroll_payment',
        sourceId: run.id,
      },
      select: { id: true, approvedAt: true },
    });

    if (!existingPaymentJournal) {
      const paymentJournal = await this.journalService.createJournalEntry({
        entityId: run.entityId,
        date: paidAt,
        description: `薪資付款 ${run.entity.name} ${run.periodStart.toISOString().slice(0, 10)} ~ ${run.periodEnd.toISOString().slice(0, 10)}`,
        sourceModule: 'payroll_payment',
        sourceId: run.id,
        createdBy: userId,
        lines: [
          {
            accountId: payrollPayableAccount.id,
            debit: payAmount,
            credit: 0,
            amountBase: payAmount,
            memo: '沖銷應付薪資',
          },
          {
            accountId: bankDepositAccount.id,
            debit: 0,
            credit: payAmount,
            amountBase: payAmount,
            memo: `銀行出款 ${bankAccount.bankName} ${bankAccount.accountNo.slice(-5)}`,
          },
        ],
      });

      await this.journalService.approveJournalEntry(paymentJournal.id, userId);
    } else if (!existingPaymentJournal.approvedAt) {
      await this.journalService.approveJournalEntry(
        existingPaymentJournal.id,
        userId,
      );
    }

    await this.prisma.payrollRun.update({
      where: { id },
      data: {
        status: 'paid',
        bankAccountId: bankAccount.id,
        paidBy: userId,
        paidAt,
      },
    });

    await this.auditLogService.record({
      userId,
      tableName: 'payroll_runs',
      recordId: id,
      action: 'PAY',
      oldData: {
        status: run.status,
      },
      newData: {
        status: 'paid',
        bankAccountId: bankAccount.id,
        paidAt,
        payAmount,
      },
    });

    return this.getPayrollRunById(userId, id);
  }

  async processLegacyPayroll(
    id: string,
    userId: string,
    data?: { bankAccountId?: string; paidAt?: string },
  ) {
    const run = await this.prisma.payrollRun.findUnique({
      where: { id },
      select: {
        id: true,
        entityId: true,
        status: true,
        approvedBy: true,
        createdBy: true,
      },
    });

    if (!run) {
      throw new NotFoundException('Payroll run not found');
    }

    if (run.status === 'draft') {
      return this.submitPayrollRun(id, userId);
    }

    if (run.status === 'pending_approval') {
      return this.approvePayrollRun(id, userId);
    }

    if (run.status === 'approved') {
      return this.postPayrollRun(id, userId);
    }

    if (run.status === 'posted') {
      let bankAccountId = data?.bankAccountId;
      if (!bankAccountId) {
        const fallbackBankAccount = await this.prisma.bankAccount.findFirst({
          where: {
            entityId: run.entityId,
            isActive: true,
          },
          orderBy: [{ bankName: 'asc' }, { accountNo: 'asc' }],
          select: { id: true },
        });

        if (!fallbackBankAccount) {
          throw new BadRequestException(
            '尚未設定可用銀行帳戶，請先建立銀行帳戶後再處理發薪。',
          );
        }

        bankAccountId = fallbackBankAccount.id;
      }

      return this.payPayrollRun(id, userId, {
        bankAccountId,
        paidAt: data?.paidAt,
      });
    }

    return this.getPayrollRunById(userId, id);
  }

  /**
   * 計算員工薪資
   */
  async calculateEmployeePayroll(
    employeeId: string,
    periodStart: Date,
    periodEnd: Date,
  ) {
    this.logger.log(`Calculating payroll for employee ${employeeId}`);

    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      include: {
        compensationSettings: true,
      },
    });
    if (!employee) throw new Error('Employee not found');
    const payrollPolicy = await this.getOrCreatePayrollPolicy(
      employee.entityId,
    );

    // 1. Get Attendance Data
    const attendanceData = await this.attendanceIntegration.getPayrollData(
      employeeId,
      periodStart,
      periodEnd,
    );

    this.logger.log(`Attendance data: ${JSON.stringify(attendanceData)}`);

    const items: { type: string; amount: number; remark?: string }[] = [];
    const baseSalary = Number(employee.salaryBaseOriginal);
    const standardMonthlyHours = this.toNumber(
      payrollPolicy.standardMonthlyHours,
    );
    const overtimeMultiplier = this.toNumber(payrollPolicy.overtimeMultiplier);
    const twLaborInsuranceRate = this.toNumber(
      payrollPolicy.twLaborInsuranceRate,
    );
    const twHealthInsuranceRate = this.toNumber(
      payrollPolicy.twHealthInsuranceRate,
    );
    const cnSocialInsuranceRate = this.toNumber(
      payrollPolicy.cnSocialInsuranceRate,
    );
    const hourlyRate = baseSalary / standardMonthlyHours;

    // 2. Base Salary (Full month for now, TODO: pro-rate for new hires/terminations)
    items.push({
      type: 'BASE_SALARY',
      amount: baseSalary,
      remark: '固定給付：月薪',
    });

    const compensationSettings = employee.compensationSettings
      ? this.normalizeCompensationSettings(employee.compensationSettings as Record<string, unknown>)
      : null;

    const fixedAdditionItems = [
      {
        key: 'transportAllowance' as const,
        type: 'TRANSPORT_ALLOWANCE',
        remark: '固定給付：車資補助',
      },
      {
        key: 'supervisorAllowance' as const,
        type: 'SUPERVISOR_ALLOWANCE',
        remark: '固定給付：主管加級',
      },
      {
        key: 'extraAllowance' as const,
        type: 'EXTRA_ALLOWANCE',
        remark: '固定給付：額外補貼',
      },
      {
        key: 'courseAllowance' as const,
        type: 'COURSE_ALLOWANCE',
        remark: '固定給付：課程補助',
      },
      {
        key: 'seniorityPay' as const,
        type: 'SENIORITY_PAY',
        remark: '固定給付：年工薪',
      },
      {
        key: 'bonus' as const,
        type: 'BONUS',
        remark: '固定給付：獎金',
      },
      {
        key: 'salaryAdjustment' as const,
        type: 'SALARY_ADJUSTMENT',
        remark: '固定給付：調薪',
      },
      {
        key: 'annualAdjustment' as const,
        type: 'ANNUAL_ADJUSTMENT',
        remark: '固定給付：年度調節',
      },
    ];

    for (const addition of fixedAdditionItems) {
      const amount = this.toNumber(compensationSettings?.[addition.key]);
      if (amount > 0) {
        items.push({
          type: addition.type,
          amount: Math.round(amount),
          remark: addition.remark,
        });
      }
    }

    // 3. Overtime Pay
    if (attendanceData.overtimeHours > 0) {
      const overtimePay =
        attendanceData.overtimeHours * hourlyRate * overtimeMultiplier;
      items.push({
        type: 'OVERTIME',
        amount: Math.round(overtimePay),
        remark: `核准加班 ${attendanceData.overtimeHours}h × ${overtimeMultiplier.toFixed(2)} 倍`,
      });
    }

    if (attendanceData.lateDeductionHours > 0) {
      const lateDeductionAmount = Math.round(
        attendanceData.lateDeductionHours * hourlyRate,
      );
      if (lateDeductionAmount > 0) {
        items.push({
          type: 'LATE_DEDUCTION',
          amount: -lateDeductionAmount,
          remark: `遲到扣款 ${attendanceData.lateDeductionHours}h（已扣除核准加班互抵時數）`,
        });
      }
    }

    const leaveDeductions = new Map<
      string,
      { amount: number; hours: number; paidPercentage: number; name: string }
    >();
    for (const leaveEntry of attendanceData.leaveEntries || []) {
      if (!leaveEntry.deductionFactor) {
        continue;
      }

      const deductionAmount = Math.round(
        leaveEntry.hours * hourlyRate * leaveEntry.deductionFactor,
      );

      if (deductionAmount <= 0) {
        continue;
      }

      const existing = leaveDeductions.get(leaveEntry.code);
      if (existing) {
        existing.amount += deductionAmount;
        existing.hours += leaveEntry.hours;
      } else {
        leaveDeductions.set(leaveEntry.code, {
          amount: deductionAmount,
          hours: leaveEntry.hours,
          paidPercentage: leaveEntry.paidPercentage,
          name: leaveEntry.name,
        });
      }
    }

    for (const [code, deduction] of leaveDeductions.entries()) {
      items.push({
        type: 'LEAVE_DEDUCTION',
        amount: -deduction.amount,
        remark: `${deduction.name} ${deduction.hours}h (${deduction.paidPercentage}% 支薪, ${code})`,
      });
    }

    for (const closure of attendanceData.disasterClosures || []) {
      const payPolicy = closure.payPolicy;
      const paidPercentage =
        payPolicy === 'PARTIAL' ? Number(closure.paidPercentage ?? 0) : 0;
      const deductionFactor =
        payPolicy === 'UNPAID'
          ? 1
          : payPolicy === 'PARTIAL'
            ? Math.max(0, (100 - paidPercentage) / 100)
            : 0;

      if (deductionFactor <= 0) {
        continue;
      }

      const deductionAmount = Math.round(8 * hourlyRate * deductionFactor);
      if (deductionAmount <= 0) {
        continue;
      }

      const policyLabel =
        payPolicy === 'UNPAID'
          ? '不支薪'
          : `部分支薪 ${paidPercentage}%`;

      items.push({
        type: 'DISASTER_CLOSURE_DEDUCTION',
        amount: -deductionAmount,
        remark: `統一放假 ${closure.name} ${new Date(
          closure.closureDate,
        ).toISOString().slice(0, 10)} (${policyLabel})`,
      });
    }

    if (
      employee.country === 'TW' &&
      employee.terminateDate &&
      employee.terminateDate >= periodStart &&
      employee.terminateDate <= periodEnd
    ) {
      const annualLeaveAdjustment =
        await this.balanceService.getTerminationAnnualLeaveAdjustment(
          employee.id,
          employee.terminateDate,
        );

      if (annualLeaveAdjustment?.excessHours) {
        items.push({
          type: 'ANNUAL_LEAVE_OVERUSE_DEDUCTION',
          amount: -Math.round(annualLeaveAdjustment.excessHours * hourlyRate),
          remark: annualLeaveAdjustment.note,
        });
      }
    }

    // 4. Deductions
    const fixedDeductionItems = [
      {
        key: 'laborInsuranceDeduction' as const,
        type: 'LABOR_INSURANCE_DEDUCTION',
        remark: '固定扣除：勞保扣照額',
      },
      {
        key: 'healthInsuranceDeduction' as const,
        type: 'HEALTH_INSURANCE_DEDUCTION',
        remark: '固定扣除：健保扣照額',
      },
      {
        key: 'pensionSelfContribution' as const,
        type: 'PENSION_SELF_CONTRIBUTION',
        remark: '固定扣除：個人自提 6%',
      },
      {
        key: 'dependentInsurance' as const,
        type: 'DEPENDENT_INSURANCE',
        remark: '固定扣除：家人加保',
      },
      {
        key: 'salaryAdvance' as const,
        type: 'SALARY_ADVANCE',
        remark: '固定扣除：薪資預支',
      },
    ];

    const useLegacyAutoDeductions = !employee.compensationSettings;

    for (const deduction of fixedDeductionItems) {
      const amount = this.toNumber(compensationSettings?.[deduction.key]);
      if (amount > 0) {
        items.push({
          type: deduction.type,
          amount: -Math.round(amount),
          remark: deduction.remark,
        });
      }
    }

    if (useLegacyAutoDeductions) {
      if (employee.country === 'TW') {
        const laborIns = Math.round(baseSalary * twLaborInsuranceRate);
        items.push({
          type: 'INS_EMP_LABOR',
          amount: -laborIns,
          remark: '未設定固定扣除時，沿用舊制自動勞保扣款',
        });

        const healthIns = Math.round(baseSalary * twHealthInsuranceRate);
        items.push({
          type: 'INS_EMP_HEALTH',
          amount: -healthIns,
          remark: '未設定固定扣除時，沿用舊制自動健保扣款',
        });
      } else if (employee.country === 'CN') {
        const socialIns = Math.round(baseSalary * cnSocialInsuranceRate);
        items.push({
          type: 'INS_EMP_SOCIAL',
          amount: -socialIns,
          remark: '未設定固定扣除時，沿用舊制自動社保扣款',
        });
      }
    }

    // Calculate Totals
    const grossPay = items
      .filter((i) => i.amount > 0)
      .reduce((sum, i) => sum + i.amount, 0);
    const deductions = items
      .filter((i) => i.amount < 0)
      .reduce((sum, i) => sum + i.amount, 0);
    const netPay = grossPay + deductions;

    return {
      employeeId,
      period: { start: periodStart, end: periodEnd },
      attendance: attendanceData,
      items,
      grossPay,
      netPay,
    };
  }

  /**
   * 計算社保（大陸）
   */
  async calculateSocialInsurance(salary: number, city: string) {
    // Simplified calculation
    const rates = {
      shanghai: 0.105,
      beijing: 0.102,
      shenzhen: 0.1,
    };
    const rate = rates[city.toLowerCase()] || 0.105; // Default to Shanghai rate
    return Math.round(salary * rate);
  }

  /**
   * 產生薪資分錄
   */
  async generatePayrollJournalEntry(payrollRunId: string) {
    // TODO: 產生薪資分錄
    // 借：薪資費用、勞健保費用（公司負擔）
    // 貸：應付薪資、應付勞健保、應付所得稅
  }

  /**
   * 薪資發放
   */
  async payPayroll(payrollRunId: string) {
    // TODO: 標記為已發放
    // TODO: 產生銀行付款分錄
  }

  /**
   * 薪資報表
   */
  async getPayrollReport(entityId: string, periodStart: Date, periodEnd: Date) {
    const runs = await this.prisma.payrollRun.findMany({
      where: {
        entityId,
        periodStart: { gte: periodStart },
        periodEnd: { lte: periodEnd },
      },
      include: {
        items: {
          include: {
            employee: {
              select: {
                id: true,
                employeeNo: true,
                name: true,
              },
            },
          },
        },
      },
      orderBy: { payDate: 'asc' },
    });

    const totalsByType = new Map<string, number>();
    const totalsByEmployee = new Map<
      string,
      { employeeId: string; employeeNo: string; name: string; total: number }
    >();

    for (const run of runs) {
      for (const item of run.items) {
        totalsByType.set(
          item.type,
          (totalsByType.get(item.type) || 0) + this.toNumber(item.amountBase),
        );

        const existingEmployeeTotal = totalsByEmployee.get(item.employeeId) || {
          employeeId: item.employeeId,
          employeeNo: item.employee.employeeNo,
          name: item.employee.name,
          total: 0,
        };
        existingEmployeeTotal.total += this.toNumber(item.amountBase);
        totalsByEmployee.set(item.employeeId, existingEmployeeTotal);
      }
    }

    return {
      periodStart,
      periodEnd,
      runCount: runs.length,
      totalsByType: Array.from(totalsByType.entries()).map(
        ([type, amount]) => ({
          type,
          amount,
        }),
      ),
      totalsByEmployee: Array.from(totalsByEmployee.values()).sort(
        (a, b) => b.total - a.total,
      ),
      totalAmount: Array.from(totalsByType.values()).reduce(
        (sum, amount) => sum + amount,
        0,
      ),
    };
  }

  /**
   * 年度薪資總表（用於報稅）
   */
  async getAnnualPayrollSummary(entityId: string, year: number) {
    const annualStart = new Date(year, 0, 1);
    const annualEnd = new Date(year, 11, 31, 23, 59, 59, 999);
    const report = await this.getPayrollReport(
      entityId,
      annualStart,
      annualEnd,
    );

    const monthlyRuns = await this.prisma.payrollRun.findMany({
      where: {
        entityId,
        payDate: {
          gte: annualStart,
          lte: annualEnd,
        },
      },
      include: {
        items: true,
      },
      orderBy: { payDate: 'asc' },
    });

    const monthlyTotals = Array.from({ length: 12 }, (_, index) => ({
      month: index + 1,
      total: 0,
    }));

    for (const run of monthlyRuns) {
      const monthIndex = run.payDate.getMonth();
      monthlyTotals[monthIndex].total += run.items.reduce(
        (sum, item) => sum + this.toNumber(item.amountBase),
        0,
      );
    }

    return {
      year,
      ...report,
      monthlyTotals,
    };
  }

  /**
   * 計算薪資
   * @param entityId - 實體ID
   * @param year - 年份
   * @param month - 月份
   * @returns 薪資計算結果
   */
  async calculatePayroll(entityId: string, year: number, month: number) {
    this.logger.log(
      `Calculating payroll for entity ${entityId}, period: ${year}/${month}`,
    );
    const periodStart = new Date(year, month - 1, 1);
    const periodEnd = new Date(year, month, 0, 23, 59, 59, 999);
    const employees = await this.prisma.employee.findMany({
      where: {
        entityId,
        isActive: true,
        hireDate: { lte: periodEnd },
        OR: [{ terminateDate: null }, { terminateDate: { gte: periodStart } }],
      },
      orderBy: { employeeNo: 'asc' },
    });

    const results = [];
    for (const employee of employees) {
      results.push(
        await this.calculateEmployeePayroll(
          employee.id,
          periodStart,
          periodEnd,
        ),
      );
    }

    return {
      entityId,
      year,
      month,
      periodStart,
      periodEnd,
      employeeCount: results.length,
      results,
    };
  }

  /**
   * 薪資過帳至會計
   * @param payrollRunId - 薪資批次ID
   * @returns 過帳結果
   */
  async postPayrollToAccounting(payrollRunId: string) {
    this.logger.log(`Posting payroll ${payrollRunId} to accounting`);
    const run = await this.prisma.payrollRun.findUnique({
      where: { id: payrollRunId },
      select: {
        id: true,
        approvedBy: true,
        createdBy: true,
      },
    });

    if (!run) {
      throw new NotFoundException('Payroll run not found');
    }

    return this.postPayrollRun(payrollRunId, run.approvedBy || run.createdBy);
  }

  /**
   * 沖回薪資
   * @param payrollRunId - 薪資批次ID
   * @param reason - 沖回原因
   * @returns 沖回結果
   */
  async reversePayroll(payrollRunId: string, reason: string) {
    this.logger.log(`Reversing payroll ${payrollRunId}, reason: ${reason}`);
    throw new Error('Not implemented: reversePayroll');
  }

  /**
   * 計算勞保
   * @param salary - 薪資金額
   * @returns 勞保金額
   */
  async calculateLaborInsurance(salary: number) {
    this.logger.log(`Calculating labor insurance for salary: ${salary}`);
    return Math.round(salary * DEFAULT_PAYROLL_POLICY.twLaborInsuranceRate);
  }

  /**
   * 計算健保
   * @param salary - 薪資金額
   * @returns 健保金額
   */
  async calculateHealthInsurance(salary: number) {
    this.logger.log(`Calculating health insurance for salary: ${salary}`);
    return Math.round(salary * DEFAULT_PAYROLL_POLICY.twHealthInsuranceRate);
  }
}
