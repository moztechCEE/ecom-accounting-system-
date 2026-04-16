export const AttendanceMethod = {
  MOBILE: 'MOBILE',
  WEB: 'WEB',
  KIOSK: 'KIOSK',
} as const;
export type AttendanceMethod = typeof AttendanceMethod[keyof typeof AttendanceMethod];

export const AttendanceEventType = {
  CLOCK_IN: 'CLOCK_IN',
  CLOCK_OUT: 'CLOCK_OUT',
  BREAK_START: 'BREAK_START',
  BREAK_END: 'BREAK_END',
} as const;
export type AttendanceEventType = typeof AttendanceEventType[keyof typeof AttendanceEventType];

export const LeaveStatus = {
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  UNDER_REVIEW: 'UNDER_REVIEW',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
} as const;
export type LeaveStatus = typeof LeaveStatus[keyof typeof LeaveStatus];

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
  documents?: any[];
}

export interface LeaveType {
  id: string;
  code: string;
  name: string;
  balanceResetPolicy?: 'CALENDAR_YEAR' | 'HIRE_ANNIVERSARY' | 'NONE';
  requiresDocument: boolean;
  maxDaysPerYear?: number;
  paidPercentage?: number;
  minNoticeHours?: number;
  allowCarryOver?: boolean;
  carryOverLimitHours?: number;
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
  createdAt: string;
}

export interface AttendanceRecord {
  id: string;
  eventType: AttendanceEventType;
  timestamp: string;
  method: AttendanceMethod;
}
