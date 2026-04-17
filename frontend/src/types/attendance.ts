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
