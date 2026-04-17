import api from "./api";
import {
  ClockInDto,
  ClockOutDto,
  CreateLeaveRequestDto,
  LeaveRequest,
  AttendanceRecord,
  LeaveType,
  LeaveBalance,
  AdminLeaveRequest,
  AdminLeaveBalance,
  LeaveStatus,
} from "../types/attendance";

export const attendanceService = {
  clockIn: async (data: ClockInDto): Promise<AttendanceRecord> => {
    const response = await api.post<AttendanceRecord>(
      "/attendance/clock-in",
      data,
    );
    return response.data;
  },

  clockOut: async (data: ClockOutDto): Promise<AttendanceRecord> => {
    const response = await api.post<AttendanceRecord>(
      "/attendance/clock-out",
      data,
    );
    return response.data;
  },

  createLeaveRequest: async (
    data: CreateLeaveRequestDto,
  ): Promise<LeaveRequest> => {
    const response = await api.post<LeaveRequest>("/attendance/leaves", data);
    return response.data;
  },

  getLeaveRequests: async (): Promise<LeaveRequest[]> => {
    const response = await api.get<LeaveRequest[]>("/attendance/leaves");
    return response.data;
  },

  getDailySummary: async (date: string): Promise<any[]> => {
    const response = await api.get<any[]>(
      `/attendance/admin/daily-summary?date=${date}`,
    );
    return response.data;
  },

  getLeaveTypes: async (): Promise<LeaveType[]> => {
    const response = await api.get<LeaveType[]>("/attendance/leaves/types");
    return response.data;
  },

  getLeaveBalances: async (year?: number): Promise<LeaveBalance[]> => {
    const response = await api.get<LeaveBalance[]>(
      "/attendance/leaves/balances",
      {
        params: year ? { year } : undefined,
      },
    );
    return response.data;
  },

  getAdminLeaveRequests: async (params?: {
    status?: LeaveStatus | "";
    employeeId?: string;
    leaveTypeId?: string;
    year?: number;
  }): Promise<AdminLeaveRequest[]> => {
    const response = await api.get<AdminLeaveRequest[]>(
      "/attendance/leaves/admin/requests",
      {
        params,
      },
    );
    return response.data;
  },

  getAdminLeaveTypes: async (): Promise<LeaveType[]> => {
    const response = await api.get<LeaveType[]>(
      "/attendance/leaves/admin/types",
    );
    return response.data;
  },

  createLeaveType: async (
    data: Partial<LeaveType> & Record<string, unknown>,
  ): Promise<LeaveType> => {
    const response = await api.post<LeaveType>(
      "/attendance/leaves/admin/types",
      data,
    );
    return response.data;
  },

  updateLeaveType: async (
    id: string,
    data: Partial<LeaveType> & Record<string, unknown>,
  ): Promise<LeaveType> => {
    const response = await api.patch<LeaveType>(
      `/attendance/leaves/admin/types/${id}`,
      data,
    );
    return response.data;
  },

  getAdminLeaveBalances: async (params?: {
    year?: number;
    employeeId?: string;
    leaveTypeId?: string;
  }): Promise<AdminLeaveBalance[]> => {
    const response = await api.get<AdminLeaveBalance[]>(
      "/attendance/leaves/admin/balances",
      {
        params,
      },
    );
    return response.data;
  },

  adjustLeaveBalance: async (
    id: string,
    data: {
      accruedHours?: number;
      carryOverHours?: number;
      manualAdjustmentHours?: number;
    },
  ): Promise<AdminLeaveBalance> => {
    const response = await api.patch<AdminLeaveBalance>(
      `/attendance/leaves/admin/balances/${id}`,
      data,
    );
    return response.data;
  },

  updateLeaveStatus: async (
    id: string,
    status: LeaveStatus,
    note?: string,
  ): Promise<LeaveRequest> => {
    const response = await api.patch<LeaveRequest>(
      `/attendance/leaves/${id}/status`,
      { status, note },
    );
    return response.data;
  },
};
