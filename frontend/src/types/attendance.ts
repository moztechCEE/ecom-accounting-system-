export const AttendanceMethod = {
  MOBILE: "MOBILE",
  WEB: "WEB",
  KIOSK: "KIOSK",
} as const;
export type AttendanceMethod =
  (typeof AttendanceMethod)[keyof typeof AttendanceMethod];

export const AttendanceEventType = {
  CLOCK_IN: "CLOCK_IN",
  CLOCK_OUT: "CLOCK_OUT",
  BREAK_START: "BREAK_START",
  BREAK_END: "BREAK_END",
} as const;
export type AttendanceEventType =
  (typeof AttendanceEventType)[keyof typeof AttendanceEventType];

export const LeaveStatus = {
  DRAFT: "DRAFT",
  SUBMITTED: "SUBMITTED",
  UNDER_REVIEW: "UNDER_REVIEW",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  CANCELLED: "CANCELLED",
} as const;
export type LeaveStatus = (typeof LeaveStatus)[keyof typeof LeaveStatus];

export interface ClockInDto {
  method: AttendanceMethod;
  latitude?: number;
  longitude?: number;
  ipAddress?: string;
  deviceInfo?: any;
  photoUrl?: string;
  notes?: string;
}

export interface ClockOutDto {
  method: AttendanceMethod;
  latitude?: number;
  longitude?: number;
  ipAddress?: string;
  deviceInfo?: any;
  photoUrl?: string;
  notes?: string;
}

export interface CreateLeaveRequestDto {
  leaveTypeId: string;
  startAt: string;
  endAt: string;
  hours: number;
  reason?: string;
  location?: string;
  funeralRelationship?: string;
  deceasedName?: string;
  deceasedDate?: string;
  funeralEventKey?: string;
  documents?: LeaveRequestDocumentInput[];
}

export interface LeaveRequestDocumentInput {
  fileName: string;
  fileUrl?: string;
  mimeType?: string;
  docType?: string;
  checksum?: string;
}

export interface LeaveRequestDocument {
  id: string;
  fileName: string;
  fileUrl: string;
  mimeType: string;
  checksum?: string | null;
  docType?: string | null;
  uploadedAt: string;
}

export interface LeaveRequestHistory {
  id: string;
  action: string;
  fromStatus?: LeaveStatus;
  toStatus?: LeaveStatus;
  note?: string | null;
  createdAt: string;
  actor?: {
    id: string;
    name: string;
  } | null;
}

export interface AttendanceSchedule {
  id: string;
  policyId: string;
  departmentId?: string | null;
  employeeId?: string | null;
  weekday: number;
  shiftStart: string;
  shiftEnd: string;
  breakMinutes: number;
  allowRemote: boolean;
  department?: {
    id: string;
    name: string;
  } | null;
  employee?: {
    id: string;
    name: string;
    employeeNo?: string;
  } | null;
}

export interface AttendancePolicy {
  id: string;
  entityId?: string;
  name: string;
  type: "office" | "remote" | "hybrid";
  ipAllowList?: string[] | null;
  geofence?: unknown;
  requiresPhoto: boolean;
  maxEarlyClock: number;
  maxLateClock: number;
  schedules: AttendanceSchedule[];
  createdAt?: string;
  updatedAt?: string;
}

export type DisasterClosureScopeType =
  | "ENTITY"
  | "DEPARTMENT"
  | "EMPLOYEE"
  | "LOCATION";

export type DisasterClosurePayPolicy = "NO_DEDUCTION" | "UNPAID" | "PARTIAL";

export interface DisasterClosureEvent {
  id: string;
  entityId: string;
  name: string;
  closureDate: string;
  scopeType: DisasterClosureScopeType;
  scopeIds: string[];
  payPolicy: DisasterClosurePayPolicy;
  paidPercentage?: number | null;
  source?: string | null;
  announcementRegion?: string | null;
  notes?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  creator?: {
    id: string;
    name: string;
    email?: string;
  };
}

export interface UpsertDisasterClosureDto {
  name: string;
  closureDate: string;
  scopeType: DisasterClosureScopeType;
  scopeIds?: string[];
  payPolicy: DisasterClosurePayPolicy;
  paidPercentage?: number;
  source?: string;
  announcementRegion?: string;
  notes?: string;
  isActive?: boolean;
}

export interface SeniorityTier {
  minYears: number;
  maxYears?: number;
  days: number;
}

export interface LeaveType {
  id: string;
  entityId?: string;
  code: string;
  name: string;
  isActive?: boolean;
  balanceResetPolicy?: "CALENDAR_YEAR" | "HIRE_ANNIVERSARY" | "NONE";
  requiresDocument: boolean;
  documentExamples?: string;
  maxDaysPerYear?: number;
  paidPercentage?: number;
  minNoticeHours?: number;
  allowCarryOver?: boolean;
  carryOverLimitHours?: number;
  metadata?: {
    seniorityTiers?: SeniorityTier[];
    systemDefault?: boolean;
    locale?: string;
  };
}

export interface LeaveBalance {
  id: string;
  year: number;
  periodStart: string;
  periodEnd: string;
  accruedHours: number;
  usedHours: number;
  carryOverHours: number;
  pendingHours: number;
  manualAdjustmentHours: number;
  remainingHours: number;
  leaveType: LeaveType;
}

export interface LeaveRequest {
  id: string;
  leaveTypeId: string;
  leaveType?: LeaveType;
  startAt: string;
  endAt: string;
  hours: number;
  status: LeaveStatus;
  reason?: string;
  location?: string;
  requiredDocsMet?: boolean;
  metadata?: Record<string, unknown>;
  documents?: LeaveRequestDocument[];
  histories?: LeaveRequestHistory[];
  createdAt: string;
}

export interface AdminLeaveRequest extends LeaveRequest {
  employee: {
    id: string;
    name: string;
    employeeNo?: string;
    department?: {
      id: string;
      name: string;
    };
  };
  reviewer?: {
    id: string;
    name: string;
  };
}

export interface AdminLeaveBalance extends LeaveBalance {
  employee: {
    id: string;
    name: string;
    employeeNo?: string;
    department?: {
      id: string;
      name: string;
    };
  };
}

export interface AttendanceRecord {
  id: string;
  eventType: AttendanceEventType;
  timestamp: string;
  method: AttendanceMethod;
}

export const OvertimeRequestStatus = {
  PENDING_MANAGER: "pending_manager",
  PENDING_FINAL: "pending_final",
  APPROVED: "approved",
  REJECTED: "rejected",
  CANCELLED: "cancelled",
} as const;
export type OvertimeRequestStatus =
  (typeof OvertimeRequestStatus)[keyof typeof OvertimeRequestStatus];

export interface CreateOvertimeRequestDto {
  workDate: string;
  requestedMinutes: number;
  reason: string;
}

export interface ReviewOvertimeRequestDto {
  action: "approve_manager" | "approve_final" | "reject";
  note?: string;
}

export interface OvertimeRequest {
  id: string;
  entityId: string;
  employeeId: string;
  employeeName: string;
  employeeNo?: string;
  departmentName?: string | null;
  workDate: string;
  requestedMinutes: number;
  approvedMinutes: number;
  reason: string;
  note?: string | null;
  status: OvertimeRequestStatus;
  submittedAt: string;
  managerApprovedAt?: string | null;
  finalApprovedAt?: string | null;
  managerApproverName?: string | null;
  finalApproverName?: string | null;
  requestedByName?: string | null;
}

export interface DailyAttendanceCompensation {
  workDate: string;
  scheduledMinutes: number;
  workedMinutes: number;
  leaveMinutes: number;
  lateActualMinutes: number;
  latePenaltyMinutes: number;
  approvedOvertimeRequestMinutes: number;
  approvedOffsetMinutes: number;
  remainingLatePenaltyMinutes: number;
  payableOvertimeMinutes: number;
  extraWorkMinutes: number;
}
