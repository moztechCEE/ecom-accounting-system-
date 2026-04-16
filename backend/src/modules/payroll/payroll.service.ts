import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AttendanceIntegrationService } from '../attendance/services/integration.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JournalService } from '../accounting/services/journal.service';

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

  constructor(
    private readonly prisma: PrismaService,
    private readonly attendanceIntegration: AttendanceIntegrationService,
    private readonly journalService: JournalService,
  ) {}

  private toNumber(value: unknown): number {
    if (value == null) {
      return 0;
    }

    return Number(value);
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

  async getEmployeeById(id: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id },
      include: {
        department: true,
      },
    });

    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    return employee;
  }

  async getEmployees(userId: string, entityId?: string) {
    const resolvedEntityId = entityId
      ? await this.resolveEntityId(userId, entityId)
      : undefined;

    return this.prisma.employee.findMany({
      where: resolvedEntityId ? { entityId: resolvedEntityId } : undefined,
      include: {
        department: true,
      },
    });
  }

  async getDepartments(userId: string, entityId?: string) {
    const resolvedEntityId = entityId
      ? await this.resolveEntityId(userId, entityId)
      : undefined;

    return this.prisma.department.findMany({
      where: resolvedEntityId ? { entityId: resolvedEntityId } : undefined,
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
    const entityId = await this.resolveEntityId(userId, data.entityId);
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

    return this.prisma.department.create({
      data: {
        entityId,
        name,
        costCenterId: data.costCenterId?.trim() || null,
        isActive: data.isActive ?? true,
      },
    });
  }

  async createEmployee(
    userId: string,
    data: {
      entityId?: string;
      employeeNo: string;
      name: string;
      departmentId?: string;
      hireDate: string | Date;
      salaryBaseOriginal: number;
      isActive?: boolean;
      location?: string;
    },
  ) {
    const entityId = await this.resolveEntityId(userId, data.entityId);
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

    const employeeNo = data.employeeNo.trim();
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

    const salaryBaseOriginal = Number(data.salaryBaseOriginal);
    if (!Number.isFinite(salaryBaseOriginal) || salaryBaseOriginal < 0) {
      throw new BadRequestException(
        'Salary must be a valid non-negative number',
      );
    }

    const employee = await this.prisma.employee.create({
      data: {
        entityId,
        employeeNo,
        name,
        country: entity.country,
        location: data.location?.trim() || null,
        departmentId: data.departmentId || null,
        hireDate: new Date(data.hireDate),
        salaryBaseOriginal,
        salaryBaseCurrency: entity.baseCurrency,
        salaryBaseFxRate: 1,
        salaryBaseBase: salaryBaseOriginal,
        isActive: data.isActive ?? true,
      },
      include: {
        department: true,
      },
    });

    return employee;
  }

  async updateEmployee(
    id: string,
    userId: string,
    data: {
      name?: string;
      departmentId?: string | null;
      hireDate?: string | Date;
      salaryBaseOriginal?: number;
      isActive?: boolean;
      location?: string | null;
      terminateDate?: string | Date | null;
    },
  ) {
    const employee = await this.prisma.employee.findUnique({
      where: { id },
      select: {
        id: true,
        entityId: true,
      },
    });

    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    const resolvedEntityId = await this.resolveEntityId(
      userId,
      employee.entityId,
    );
    if (resolvedEntityId !== employee.entityId) {
      throw new NotFoundException('Employee not found');
    }

    if (data.departmentId !== undefined && data.departmentId !== null) {
      await this.ensureDepartmentInEntity(data.departmentId, employee.entityId);
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

    if (data.terminateDate !== undefined) {
      updateData.terminateDate = data.terminateDate
        ? new Date(data.terminateDate)
        : null;
    }

    return this.prisma.employee.update({
      where: { id },
      data: updateData,
      include: {
        department: true,
      },
    });
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

  async getPayrollRuns(userId: string, entityId?: string) {
    const resolvedEntityId = entityId
      ? await this.resolveEntityId(userId, entityId)
      : undefined;

    const runs = await this.prisma.payrollRun.findMany({
      where: resolvedEntityId ? { entityId: resolvedEntityId } : undefined,
      include: {
        items: true,
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

  async getPayrollRunById(id: string) {
    const run = await this.prisma.payrollRun.findUnique({
      where: { id },
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

  async getMyPayrollRuns(userId: string) {
    const employee = await this.getEmployeeForUser(userId);
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
  /**
   * 建立薪資批次
   */
  async createPayrollRun(
    data: {
      entityId?: string;
      periodStart: Date;
      periodEnd: Date;
      payDate: Date;
    },
    userId: string,
  ) {
    const entityId = await this.resolveEntityId(userId, data.entityId);
    const { periodStart, periodEnd, payDate } = data;

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
        entityId,
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

    return this.getPayrollRunById(payrollRun.id);
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

    return this.getPayrollRunById(id);
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

    return this.getPayrollRunById(id);
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

    return this.getPayrollRunById(id);
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

    return this.getPayrollRunById(id);
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
    });
    if (!employee) throw new Error('Employee not found');

    // 1. Get Attendance Data
    const attendanceData = await this.attendanceIntegration.getPayrollData(
      employeeId,
      periodStart,
      periodEnd,
    );

    this.logger.log(`Attendance data: ${JSON.stringify(attendanceData)}`);

    const items: { type: string; amount: number; remark?: string }[] = [];
    const baseSalary = Number(employee.salaryBaseOriginal);

    // Standard working hours per month (30 days * 8 hours)
    const STANDARD_MONTHLY_HOURS = 240;
    const hourlyRate = baseSalary / STANDARD_MONTHLY_HOURS;

    // 2. Base Salary (Full month for now, TODO: pro-rate for new hires/terminations)
    items.push({
      type: 'BASE_SALARY',
      amount: baseSalary,
    });

    // 3. Overtime Pay
    if (attendanceData.overtimeHours > 0) {
      // Simplified: 1.33x for all overtime
      const overtimePay = attendanceData.overtimeHours * hourlyRate * 1.33;
      items.push({
        type: 'OVERTIME',
        amount: Math.round(overtimePay),
      });
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

    // 4. Deductions (Insurance & Tax)
    // Simplified logic based on country
    if (employee.country === 'TW') {
      // Labor Insurance (Employee Share) - Approx 2.2%
      const laborIns = Math.round(baseSalary * 0.022);
      items.push({ type: 'INS_EMP_LABOR', amount: -laborIns });

      // Health Insurance (Employee Share) - Approx 1.5%
      const healthIns = Math.round(baseSalary * 0.015);
      items.push({ type: 'INS_EMP_HEALTH', amount: -healthIns });
    } else if (employee.country === 'CN') {
      // Social Insurance (Employee Share) - Approx 10.5% total
      const socialIns = Math.round(baseSalary * 0.105);
      items.push({ type: 'INS_EMP_SOCIAL', amount: -socialIns });
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
    // TODO: 產生薪資彙總表
  }

  /**
   * 年度薪資總表（用於報稅）
   */
  async getAnnualPayrollSummary(entityId: string, year: number) {
    // TODO: 產生年度薪資總表
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
    throw new Error('Not implemented: calculatePayroll');
  }

  /**
   * 薪資過帳至會計
   * @param payrollRunId - 薪資批次ID
   * @returns 過帳結果
   */
  async postPayrollToAccounting(payrollRunId: string) {
    this.logger.log(`Posting payroll ${payrollRunId} to accounting`);
    throw new Error('Not implemented: postPayrollToAccounting');
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
    throw new Error('Not implemented: calculateLaborInsurance');
  }

  /**
   * 計算健保
   * @param salary - 薪資金額
   * @returns 健保金額
   */
  async calculateHealthInsurance(salary: number) {
    this.logger.log(`Calculating health insurance for salary: ${salary}`);
    throw new Error('Not implemented: calculateHealthInsurance');
  }
}
