import api from './api';
import {
  ClockInDto,
  ClockOutDto,
  CreateLeaveRequestDto,
  LeaveRequest,
  AttendanceRecord,
  LeaveType,
  LeaveBalance,
} from '../types/attendance';

export const attendanceService = {
  clockIn: async (data: ClockInDto): Promise<AttendanceRecord> => {
    const response = await api.post<AttendanceRecord>('/attendance/clock-in', data);
    return response.data;
  },

  clockOut: async (data: ClockOutDto): Promise<AttendanceRecord> => {
    const response = await api.post<AttendanceRecord>('/attendance/clock-out', data);
    return response.data;
  },

  createLeaveRequest: async (data: CreateLeaveRequestDto): Promise<LeaveRequest> => {
    const response = await api.post<LeaveRequest>('/attendance/leaves', data);
    return response.data;
  },

  getLeaveRequests: async (): Promise<LeaveRequest[]> => {
    const response = await api.get<LeaveRequest[]>('/attendance/leaves');
    return response.data;
  },

  getDailySummary: async (date: string): Promise<any[]> => {
    const response = await api.get<any[]>(`/attendance/admin/daily-summary?date=${date}`);
    return response.data;
  },
  
  getLeaveTypes: async (): Promise<LeaveType[]> => {
    const response = await api.get<LeaveType[]>('/attendance/leaves/types');
    return response.data;
  },

  getLeaveBalances: async (year?: number): Promise<LeaveBalance[]> => {
    const response = await api.get<LeaveBalance[]>('/attendance/leaves/balances', {
      params: year ? { year } : undefined,
    });
    return response.data;
  },
};
