export interface Permission {
  id: string;
  resource: string;
  action: string;
  description?: string;
}

export const TaxType = {
  TAXABLE_5_PERCENT: "TAXABLE_5_PERCENT",
  NON_DEDUCTIBLE_5_PERCENT: "NON_DEDUCTIBLE_5_PERCENT",
  ZERO_RATED: "ZERO_RATED",
  TAX_FREE: "TAX_FREE",
} as const;

export type TaxType = (typeof TaxType)[keyof typeof TaxType];

export interface RolePermissionLink {
  roleId: string;
  permissionId: string;
  permission: Permission;
}

export interface Role {
  id: string;
  code: string;
  name: string;
  description?: string;
  hierarchyLevel: number;
  permissions?: RolePermissionLink[];
}

export interface UserRoleLink {
  userId: string;
  roleId: string;
  role: Role;
}

export interface ManagedUser {
  id: string;
  email: string;
  name: string;
  isActive: boolean;
  mustChangePassword?: boolean;
  employeeDataScope?: 'SELF' | 'DEPARTMENT' | 'ENTITY';
  attendanceDataScope?: 'SELF' | 'DEPARTMENT' | 'ENTITY';
  payrollDataScope?: 'SELF' | 'DEPARTMENT' | 'ENTITY';
  createdAt?: string;
  updatedAt?: string;
  roles: UserRoleLink[];
}

export interface PaginatedResult<T> {
  items: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface User {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  mustChangePassword?: boolean;
  employeeDataScope?: 'SELF' | 'DEPARTMENT' | 'ENTITY';
  attendanceDataScope?: 'SELF' | 'DEPARTMENT' | 'ENTITY';
  payrollDataScope?: 'SELF' | 'DEPARTMENT' | 'ENTITY';
  roles: string[];
  permissions: string[];
}

export interface LoginRequest {
  email?: string;
  entityId?: string;
  employeeNo?: string;
  password: string;
}

export interface LoginResponse {
  access_token: string;
  user: User;
}

export interface EmployeeLoginAccountResult {
  employee: Employee;
  user: ManagedUser;
  temporaryPassword: string;
  mustChangePassword: boolean;
}

export interface EmployeeCreateResult extends Employee {
  initialLogin?: {
    employeeNo: string;
    temporaryPassword: string;
    entityId: string;
    user: ManagedUser;
  };
}

export interface Account {
  id: string;
  code: string;
  name: string;
  nameEn: string;
  type: string;
  category: string;
  isActive: boolean;
  balance?: number;
  currency: string;
  entity: {
    id: string;
    code: string;
    name: string;
  };
}

export interface Vendor {
  id: string;
  code: string;
  name: string;
  taxId?: string;
  contactPerson?: string;
  email?: string;
  phone?: string;
  address?: string;
  paymentTerms?: string;
  currency: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateVendorDto {
  code: string;
  name: string;
  taxId?: string;
  contactPerson?: string;
  email?: string;
  phone?: string;
  address?: string;
  paymentTerms?: string;
  currency?: string;
  isActive?: boolean;
}

export type UpdateVendorDto = Partial<CreateVendorDto>;

export interface ArInvoice {
  id: string;
  invoiceNo: string;
  customerId: string;
  customerName?: string;
  amountOriginal: number;
  amountCurrency: string;
  paidAmountOriginal: number;
  status: string;
  issueDate: string;
  dueDate: string;
}

export interface ApInvoice {
  id: string;
  entityId: string;
  invoiceNo: string;
  vendorId: string;
  vendorName?: string;
  amountOriginal: number;
  amountCurrency: string;
  paidAmountOriginal: number;
  taxType?: TaxType;
  taxAmount?: number;
  status: string;
  invoiceDate: string;
  dueDate: string;
  paymentFrequency?: "one_time" | "monthly";
  isRecurringMonthly?: boolean;
  recurringDayOfMonth?: number | null;
  nextDueDate?: string | null;
  notes?: string | null;
  source?: "payment_task" | "ap_invoice";
  sourceModule?: string | null;
  serviceType?: string | null;
  merchantKey?: string | null;
  merchantId?: string | null;
  invoiceIssuedStatus?: string | null;
  matchedFeeAmount?: number;
  coverageStatus?: string | null;
  isUrgent?: boolean;
  vendor?: {
    id: string;
    name: string;
  };
}

export interface ApInvoiceAlerts {
  unpaid: number;
  overdue: number;
  upcoming: number;
}

export interface EcpayServiceFeeInvoiceSummaryItem {
  id: string;
  invoiceNo: string;
  invoiceDate: string;
  amountOriginal: number;
  paidAmountOriginal: number;
  status: string;
  vendorName: string | null;
  merchantKey: string | null;
  merchantId: string | null;
  serviceType: string | null;
  invoiceIssuedStatus: string | null;
  matchedGatewayFeeAmount: number;
  coverageStatus: string | null;
}

export interface EcpayServiceFeeInvoiceSummary {
  entityId: string;
  range: {
    startDate: string | null;
    endDate: string | null;
  };
  summary: {
    invoiceCount: number;
    invoiceAmount: number;
    paidOffsetAmount: number;
    issuedCount: number;
    paidOffsetCount: number;
    matchedCount: number;
    unmatchedCount: number;
  };
  items: EcpayServiceFeeInvoiceSummaryItem[];
}

export interface ExpenseRequest {
  id: string;
  description: string;
  amountOriginal: number;
  amountCurrency: string;
  taxType?: TaxType;
  taxAmount?: number;
  status: string;
  createdBy: string;
  createdByName?: string;
  createdAt: string;
}

export interface BankAccount {
  id: string;
  entityId?: string;
  bankName: string;
  branch?: string | null;
  accountName?: string;
  accountAlias?: string;
  accountNo: string;
  currency: string;
  balance?: number;
  isActive: boolean;
  allowedUserIds?: string[];
  accessScope?: "all" | "restricted";
}

export interface BankTransaction {
  id: string;
  txnDate: string;
  amountOriginal: number;
  amountCurrency: string;
  descriptionRaw: string;
  reconcileStatus: string;
}

export interface Department {
  id: string;
  name: string;
  costCenterId?: string;
  isActive: boolean;
}

export interface Employee {
  id: string;
  userId?: string | null;
  employeeNo: string;
  name: string;
  nationalId?: string | null;
  mailingAddress?: string | null;
  departmentId?: string;
  departmentName?: string;
  salaryBaseOriginal: number;
  isActive: boolean;
  hireDate: string;
  terminateDate?: string | null;
  compensationSettings?: EmployeeCompensationSettings;
  onboardingDocuments?: EmployeeOnboardingDocument[];
  user?: {
    id: string;
    name: string;
    email?: string;
  } | null;
}

export interface EmployeeCompensationSettings {
  transportAllowance: number;
  supervisorAllowance: number;
  extraAllowance: number;
  courseAllowance: number;
  seniorityPay: number;
  bonus: number;
  salaryAdjustment: number;
  annualAdjustment: number;
  laborInsuranceDeduction: number;
  healthInsuranceDeduction: number;
  pensionSelfContribution: number;
  dependentInsurance: number;
  salaryAdvance: number;
}

export interface EmployeeOnboardingDocument {
  id: string;
  docType: "ID_FRONT" | "ID_BACK" | "HEALTH_CHECK";
  status: "PENDING" | "UPLOADED" | "VERIFIED";
  fileName?: string | null;
  mimeType?: string | null;
  fileSize?: number;
  uploadedAt?: string | null;
  verifiedAt?: string | null;
  verifiedBy?: string | null;
}

export interface PayrollRun {
  id: string;
  entityId?: string;
  periodStart: string;
  periodEnd: string;
  payDate: string;
  status: string;
  totalAmount?: number;
  employeeCount?: number;
  createdAt?: string;
  approvedAt?: string | null;
  paidAt?: string | null;
  creator?: {
    id: string;
    name: string;
  };
  approver?: {
    id: string;
    name: string;
  } | null;
  payor?: {
    id: string;
    name: string;
  } | null;
  bankAccount?: Pick<
    BankAccount,
    "id" | "bankName" | "accountNo" | "currency"
  > | null;
  items?: PayrollItem[];
}

export interface PayrollRunPrecheckIssue {
  employeeId: string;
  employeeNo: string;
  employeeName: string;
  departmentName?: string | null;
  workDate: string;
  issueType: "MISSING_ATTENDANCE_OR_LEAVE" | "INCOMPLETE_CLOCK";
  scheduleSource: "employee" | "department" | "global" | "default";
  detail: string;
  summaryStatus?: string | null;
}

export interface PayrollRunPrecheckResult {
  periodStart: string;
  periodEnd: string;
  periodWorkdayCount: number;
  employeesChecked: number;
  issueCount: number;
  issues: PayrollRunPrecheckIssue[];
}

export interface PayrollItem {
  id: string;
  employeeId: string;
  type: string;
  amountOriginal: number;
  amountBase: number;
  currency?: string;
  remark?: string | null;
  employee?: {
    id: string;
    employeeNo: string;
    name: string;
  };
}

export interface AuditLogEntry {
  id: string;
  tableName: string;
  recordId: string;
  action: string;
  createdAt: string;
  user?: {
    id: string;
    name: string;
    email?: string;
  } | null;
  oldData?: Record<string, unknown> | null;
  newData?: Record<string, unknown> | null;
}

export interface PayrollSettings {
  id: string;
  entityId: string;
  standardMonthlyHours: number;
  overtimeMultiplier: number;
  twLaborInsuranceRate: number;
  twHealthInsuranceRate: number;
  cnSocialInsuranceRate: number;
  createdAt?: string;
  updatedAt?: string;
}
