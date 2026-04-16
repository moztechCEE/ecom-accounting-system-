import React, { useState, useEffect } from 'react';
import { message } from 'antd';
import { motion } from 'framer-motion';
import { PlusOutlined, CalendarOutlined, ClockCircleOutlined, CheckCircleOutlined } from '@ant-design/icons';
import { attendanceService } from '../../services/attendance.service';
import { LeaveBalance, LeaveRequest, LeaveStatus, LeaveType } from '../../types/attendance';
import dayjs from 'dayjs';
import { GlassCard } from '../../components/ui/GlassCard';
import { GlassButton } from '../../components/ui/GlassButton';
import { GlassModal } from '../../components/ui/GlassModal';
import { GlassInput } from '../../components/ui/GlassInput';
import { GlassSelect } from '../../components/ui/GlassSelect';
import { GlassTextarea } from '../../components/ui/GlassTextarea';

const LeaveRequestPage: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [leaveBalances, setLeaveBalances] = useState<LeaveBalance[]>([]);
  const [isModalVisible, setIsModalVisible] = useState(false);

  // Form State
  const [formData, setFormData] = useState({
    leaveTypeId: '',
    startDate: '',
    startTime: '',
    endDate: '',
    endTime: '',
    hours: 0,
    reason: '',
    location: ''
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [requestsData, typesData, balancesData] = await Promise.all([
        attendanceService.getLeaveRequests(),
        attendanceService.getLeaveTypes(),
        attendanceService.getLeaveBalances(dayjs().year()),
      ]);
      setRequests(requestsData);
      setLeaveTypes(typesData);
      setLeaveBalances(balancesData);
    } catch (error) {
      console.error(error);
      message.error('無法載入資料');
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async () => {
    try {
      setLoading(true);
      
      // Combine date and time
      const startAt = dayjs(`${formData.startDate} ${formData.startTime}`).toISOString();
      const endAt = dayjs(`${formData.endDate} ${formData.endTime}`).toISOString();

      await attendanceService.createLeaveRequest({
        leaveTypeId: formData.leaveTypeId,
        startAt,
        endAt,
        hours: Number(formData.hours),
        reason: formData.reason,
        location: formData.location,
      });
      
      message.success('請假申請已送出');
      setIsModalVisible(false);
      setFormData({
        leaveTypeId: '',
        startDate: '',
        startTime: '',
        endDate: '',
        endTime: '',
        hours: 0,
        reason: '',
        location: ''
      });
      void loadData();
    } catch (error) {
      console.error(error);
      message.error('申請失敗');
    } finally {
      setLoading(false);
    }
  };

  const getStatusTag = (status: LeaveStatus) => {
    const config: Record<string, { color: string; text: string; bg: string }> = {
      [LeaveStatus.APPROVED]: { color: 'text-green-600', text: '已核准', bg: 'bg-green-100/50' },
      [LeaveStatus.REJECTED]: { color: 'text-red-600', text: '已駁回', bg: 'bg-red-100/50' },
      [LeaveStatus.SUBMITTED]: { color: 'text-blue-600', text: '簽核中', bg: 'bg-blue-100/50' },
      [LeaveStatus.DRAFT]: { color: 'text-gray-600', text: '草稿', bg: 'bg-gray-100/50' },
    };
    const { color, text, bg } = config[status] || { color: 'text-gray-600', text: status, bg: 'bg-gray-100/50' };
    
    return (
      <span className={`px-3 py-1 rounded-full text-xs font-medium ${color} ${bg} border border-white/20`}>
        {text}
      </span>
    );
  };

  const formatHours = (hours?: number) => {
    if (hours === undefined || hours === null) {
      return '--';
    }

    if (Number.isInteger(hours / 8)) {
      return `${hours / 8} 天`;
    }

    return `${hours} 小時`;
  };

  const annualBalance =
    leaveBalances.find((balance) => balance.leaveType.code === 'ANNUAL') ||
    leaveBalances[0];
  const usedHours = leaveBalances.reduce((sum, balance) => sum + balance.usedHours, 0);
  const selectedLeaveType = leaveTypes.find((type) => type.id === formData.leaveTypeId);
  const selectedLeaveBalance = leaveBalances.find(
    (balance) => balance.leaveType.id === formData.leaveTypeId,
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="space-y-6"
    >
      {/* Header */}
      <div className="flex flex-wrap justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 mb-1">請假管理</h1>
          <p className="text-slate-500 text-sm">查看您的假單紀錄與剩餘額度</p>
        </div>
        <GlassButton 
          onClick={() => setIsModalVisible(true)}
          className="flex items-center gap-2"
        >
          <PlusOutlined />
          <span>新增請假申請</span>
        </GlassButton>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <GlassCard className="relative overflow-hidden group h-full">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <CalendarOutlined className="text-6xl text-blue-500" />
          </div>
          <div className="text-sm text-slate-500 mb-2 font-medium">特休剩餘</div>
          <div className="text-3xl font-semibold text-slate-800 mb-1">
            {annualBalance ? formatHours(annualBalance.remainingHours) : '--'}
          </div>
          <div className="text-xs text-slate-400">
            {annualBalance
              ? `有效期至 ${dayjs(annualBalance.periodEnd).format('YYYY/MM/DD')}`
              : '尚未建立年度額度'}
          </div>
        </GlassCard>

        <GlassCard className="relative overflow-hidden group h-full">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <CheckCircleOutlined className="text-6xl text-green-500" />
          </div>
          <div className="text-sm text-slate-500 mb-2 font-medium">本年度已休</div>
          <div className="text-3xl font-semibold text-slate-800 mb-1">{formatHours(usedHours)}</div>
          <div className="text-xs text-slate-400">依核准後的年度額度即時更新</div>
        </GlassCard>

        <GlassCard className="relative overflow-hidden group h-full">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <ClockCircleOutlined className="text-6xl text-orange-500" />
          </div>
          <div className="text-sm text-slate-500 mb-2 font-medium">待核准假單</div>
          <div className="text-3xl font-semibold text-slate-800 mb-1">
            {requests.filter(r => r.status === LeaveStatus.SUBMITTED).length} 
            <span className="text-sm font-normal text-slate-400"> 筆</span>
          </div>
          <div className="text-xs text-slate-400">請留意簽核進度</div>
        </GlassCard>
      </div>

      {/* History Table */}
      <GlassCard className="overflow-hidden p-0">
        <div className="p-6 border-b border-white/20">
          <h3 className="text-xl font-semibold text-slate-900">申請紀錄</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-white/20 text-slate-500 text-sm border-b border-white/10">
                <th className="p-4 font-medium">假別</th>
                <th className="p-4 font-medium">期間</th>
                <th className="p-4 font-medium">時數</th>
                <th className="p-4 font-medium">原因</th>
                <th className="p-4 font-medium">狀態</th>
              </tr>
            </thead>
            <tbody className="text-slate-700">
              {requests.map((request) => (
                <tr key={request.id} className="border-b border-white/10 hover:bg-white/10 transition-colors">
                  <td className="p-4">
                    <span className="font-medium text-slate-800">{request.leaveType?.name || '未知'}</span>
                  </td>
                  <td className="p-4">
                    <div className="flex flex-col text-sm">
                      <span>{dayjs(request.startAt).format('YYYY-MM-DD HH:mm')}</span>
                      <span className="text-slate-400 text-xs">至</span>
                      <span>{dayjs(request.endAt).format('YYYY-MM-DD HH:mm')}</span>
                    </div>
                  </td>
                  <td className="p-4 font-mono">{request.hours}</td>
                  <td className="p-4 max-w-xs truncate text-slate-500">{request.reason}</td>
                  <td className="p-4">
                    {getStatusTag(request.status)}
                  </td>
                </tr>
              ))}
              {requests.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-slate-400">
                    尚無申請紀錄
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </GlassCard>

      {/* New Request Modal */}
      <GlassModal
        isOpen={isModalVisible}
        onClose={() => setIsModalVisible(false)}
        title="新增請假申請"
        footer={
          <>
            <GlassButton variant="secondary" onClick={() => setIsModalVisible(false)}>
              取消
            </GlassButton>
            <GlassButton variant="primary" onClick={handleSubmit} isLoading={loading}>
              送出申請
            </GlassButton>
          </>
        }
      >
        <div className="space-y-6">
          <GlassSelect
            label="假別"
            name="leaveTypeId"
            value={formData.leaveTypeId}
            onChange={handleInputChange}
            options={[
              { value: '', label: '請選擇假別' },
              ...leaveTypes.map(t => ({ value: t.id, label: t.name }))
            ]}
          />

          {selectedLeaveType && (
            <div className="rounded-2xl border border-white/20 bg-white/20 p-4 text-sm text-slate-600">
              <div className="font-medium text-slate-800 mb-1">{selectedLeaveType.name}</div>
              <div>
                支薪比例：{selectedLeaveType.paidPercentage ?? 100}%
                {selectedLeaveBalance ? `，剩餘額度：${formatHours(selectedLeaveBalance.remainingHours)}` : '，此假別不追蹤年度額度'}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <GlassInput
              label="開始日期"
              type="date"
              name="startDate"
              value={formData.startDate}
              onChange={handleInputChange}
            />
            <GlassInput
              label="開始時間"
              type="time"
              name="startTime"
              value={formData.startTime}
              onChange={handleInputChange}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <GlassInput
              label="結束日期"
              type="date"
              name="endDate"
              value={formData.endDate}
              onChange={handleInputChange}
            />
            <GlassInput
              label="結束時間"
              type="time"
              name="endTime"
              value={formData.endTime}
              onChange={handleInputChange}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <GlassInput
              label="請假時數"
              type="number"
              name="hours"
              value={formData.hours}
              onChange={handleInputChange}
              min={0.5}
              step={0.5}
            />
            <GlassInput
              label="地點 (選填)"
              type="text"
              name="location"
              value={formData.location}
              onChange={handleInputChange}
              placeholder="例如：台北辦公室"
            />
          </div>

          <GlassTextarea
            label="請假原因"
            name="reason"
            value={formData.reason}
            onChange={handleInputChange}
            placeholder="請說明請假原因..."
            rows={4}
          />
        </div>
      </GlassModal>
    </motion.div>
  );
};

export default LeaveRequestPage;
