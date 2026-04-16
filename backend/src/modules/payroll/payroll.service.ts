import { Injectable, Logger } from '@nestjs/common';
import { AttendanceIntegrationService } from '../attendance/services/integration.service';
import { PrismaService } from '../../common/prisma/prisma.service';

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
  ) {}

  async getEmployees(entityId?: string) {
    return this.prisma.employee.findMany({
      where: entityId ? { entityId } : undefined,
      include: {
        department: true,
      },
    });
  }

  async getDepartments(entityId?: string) {
    return this.prisma.department.findMany({
      where: entityId ? { entityId } : undefined,
    });
  }

  async getPayrollRuns(entityId?: string) {
    return this.prisma.payrollRun.findMany({
      where: entityId ? { entityId } : undefined,
      orderBy: { createdAt: 'desc' },
    });
  }
  /**
   * 建立薪資批次
   */
  async createPayrollRun(data: {
    entityId: string;
    periodStart: Date;
    periodEnd: Date;
    payDate: Date;
  }) {
    const { entityId, periodStart, periodEnd, payDate } = data;

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
        createdBy: 'SYSTEM', // Should be current user ID in real scenario
      },
    });

    // 3. Get Active Employees
    const employees = await this.prisma.employee.findMany({
      where: {
        entityId,
        isActive: true,
        hireDate: { lte: periodEnd },
        OR: [
          { terminateDate: null },
          { terminateDate: { gte: periodStart } },
        ],
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

    return this.prisma.payrollRun.findUnique({
      where: { id: payrollRun.id },
      include: { items: true },
    });
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
      'shanghai': 0.105,
      'beijing': 0.102,
      'shenzhen': 0.100,
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
