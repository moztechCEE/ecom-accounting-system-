import React, { useState, useEffect } from 'react';
import { Alert, message } from 'antd';
import { 
  EnvironmentOutlined, 
  CheckCircleOutlined, 
  LoginOutlined, 
  LogoutOutlined,
  ClockCircleOutlined,
  WarningOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-tw';
import { attendanceService } from '../../services/attendance.service';
import {
  AttendanceMethod,
  OvertimeRequest,
  OvertimeRequestStatus,
} from '../../types/attendance';
import { GlassCard } from '../../components/ui/GlassCard';
import { GlassButton } from '../../components/ui/GlassButton';
import { GlassModal } from '../../components/ui/GlassModal';
import { GlassInput } from '../../components/ui/GlassInput';
import { GlassTextarea } from '../../components/ui/GlassTextarea';

dayjs.locale('zh-tw');

const EmployeeDashboardPage: React.FC = () => {
  const [currentTime, setCurrentTime] = useState(dayjs());
  const [loading, setLoading] = useState(false);
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [employeeLinkMissing, setEmployeeLinkMissing] = useState(false);
  const [lastAction, setLastAction] = useState<{ type: string; time: string } | null>(null);
  const [todayRecords, setTodayRecords] = useState<any[]>([]);
  const [overtimeRequests, setOvertimeRequests] = useState<OvertimeRequest[]>([]);
  const [overtimeModalOpen, setOvertimeModalOpen] = useState(false);
  const [overtimeForm, setOvertimeForm] = useState({
    workDate: dayjs().format('YYYY-MM-DD'),
    requestedMinutes: '30',
    reason: '',
  });

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(dayjs());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    void loadOvertimeRequests();
  }, []);

  const loadOvertimeRequests = async () => {
    try {
      const result = await attendanceService.getMyOvertimeRequests();
      setOvertimeRequests(result);
    } catch (error) {
      console.error(error);
    }
  };

  const statusLabelMap: Record<string, string> = {
    [OvertimeRequestStatus.PENDING_MANAGER]: '待主管初審',
    [OvertimeRequestStatus.PENDING_FINAL]: '待負責人覆核',
    [OvertimeRequestStatus.APPROVED]: '已核准',
    [OvertimeRequestStatus.REJECTED]: '已駁回',
    [OvertimeRequestStatus.CANCELLED]: '已取消',
  };

  const openOvertimeModal = () => {
    setOvertimeForm({
      workDate: dayjs().format('YYYY-MM-DD'),
      requestedMinutes: '30',
      reason: '',
    });
    setOvertimeModalOpen(true);
  };

  const handleSubmitOvertime = async () => {
    try {
      await attendanceService.createOvertimeRequest({
        workDate: overtimeForm.workDate,
        requestedMinutes: Number(overtimeForm.requestedMinutes || 0),
        reason: overtimeForm.reason.trim(),
      });
      message.success('加班申請已送出，待主管審核');
      setOvertimeModalOpen(false);
      void loadOvertimeRequests();
    } catch (error: any) {
      console.error(error);
      message.error(error?.response?.data?.message || '送出加班申請失敗');
    }
  };

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          });
          setLocationError(null);
        },
        (error) => {
          console.error('Error getting location:', error);
          setLocationError('無法獲取位置資訊，請確認瀏覽器權限');
        }
      );
    } else {
      setLocationError('您的瀏覽器不支援地理定位');
    }
  }, []);

  const handleClockIn = async () => {
    if (!location) {
      message.error('需要位置資訊才能打卡');
      return;
    }
    try {
      setLoading(true);
      await attendanceService.clockIn({
        method: AttendanceMethod.WEB,
        latitude: location.lat,
        longitude: location.lng,
      });
      message.success('上班打卡成功');
      setEmployeeLinkMissing(false);
      const timeStr = dayjs().format('HH:mm:ss');
      setLastAction({ type: '上班', time: timeStr });
      setTodayRecords(prev => [...prev, { type: 'clock_in', time: timeStr }]);
      void loadOvertimeRequests();
    } catch (error) {
      console.error(error);
      const backendMessage =
        typeof error === 'object' &&
        error !== null &&
        'response' in error &&
        typeof (error as any).response?.data?.message === 'string'
          ? (error as any).response.data.message
          : '';

      if (backendMessage.includes('Employee record not found')) {
        setEmployeeLinkMissing(true);
        message.error('目前登入帳號尚未綁定員工資料');
      } else {
        message.error('打卡失敗');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleClockOut = async () => {
    if (!location) {
      message.error('需要位置資訊才能打卡');
      return;
    }
    try {
      setLoading(true);
      await attendanceService.clockOut({
        method: AttendanceMethod.WEB,
        latitude: location.lat,
        longitude: location.lng,
      });
      message.success('下班打卡成功');
      setEmployeeLinkMissing(false);
      const timeStr = dayjs().format('HH:mm:ss');
      setLastAction({ type: '下班', time: timeStr });
      setTodayRecords(prev => [...prev, { type: 'clock_out', time: timeStr }]);
      void loadOvertimeRequests();
    } catch (error) {
      console.error(error);
      const backendMessage =
        typeof error === 'object' &&
        error !== null &&
        'response' in error &&
        typeof (error as any).response?.data?.message === 'string'
          ? (error as any).response.data.message
          : '';

      if (backendMessage.includes('Employee record not found')) {
        setEmployeeLinkMissing(true);
        message.error('目前登入帳號尚未綁定員工資料');
      } else {
        message.error('打卡失敗');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8 animate-[fadeInUp_0.4s_ease-out]">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-end gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 mb-1">打卡儀表板</h1>
          <p className="text-slate-500 text-sm">歡迎回來，請確認您的打卡狀態</p>
        </div>
        <div className="flex items-center gap-2 text-sm text-slate-500 bg-white/30 px-3 py-1.5 rounded-full border border-white/20">
          <ClockCircleOutlined />
          <span>{currentTime.format('YYYY年MM月DD日 dddd')}</span>
        </div>
      </div>

      {employeeLinkMissing ? (
        <Alert
          type="warning"
          showIcon
          message="目前登入帳號尚未綁定員工資料"
          description="請到「考勤後臺 > 員工與部門」將這個登入帳號綁定到對應員工後，再進行打卡與請假。"
        />
      ) : null}
      
      {/* Stats Grid - Moved to top like AP page */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 w-full">
        <GlassCard className="relative overflow-hidden group h-full">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <ClockCircleOutlined className="text-6xl text-blue-500" />
          </div>
          <div className="text-sm text-slate-500 mb-2 font-medium">累積工時</div>
          <div className="text-3xl font-semibold text-slate-800 mb-1">0 <span className="text-sm font-normal text-slate-400">小時</span></div>
        </GlassCard>

        <GlassCard className="relative overflow-hidden group h-full">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <WarningOutlined className="text-6xl text-red-500" />
          </div>
          <div className="text-sm text-slate-500 mb-2 font-medium">遲到次數</div>
          <div className="text-3xl font-semibold text-slate-800 mb-1">0 <span className="text-sm font-normal text-slate-400">次</span></div>
        </GlassCard>

        <GlassCard className="relative overflow-hidden group h-full">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <EnvironmentOutlined className="text-6xl text-purple-500" />
          </div>
          <div className="text-sm text-slate-500 mb-2 font-medium">特休餘額</div>
          <div className="text-3xl font-semibold text-slate-800 mb-1">10 <span className="text-sm font-normal text-slate-400">天</span></div>
        </GlassCard>

        <GlassCard className="relative overflow-hidden group h-full">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <LogoutOutlined className="text-6xl text-orange-500" />
          </div>
          <div className="text-sm text-slate-500 mb-2 font-medium">本月請假</div>
          <div className="text-3xl font-semibold text-slate-800 mb-1">0 <span className="text-sm font-normal text-slate-400">小時</span></div>
        </GlassCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 w-full">
        {/* Left Column: Clock Widget & Actions */}
        <div className="lg:col-span-8 flex flex-col gap-6">
          {/* Clock Widget */}
          <GlassCard className="flex flex-col items-center justify-center py-12 w-full">
            <div className="text-[80px] font-light tracking-wider text-slate-900/80 leading-none font-mono">
              {currentTime.format('HH:mm')}
              <span className="text-4xl ml-3 text-slate-400">{currentTime.format('ss')}</span>
            </div>
            
            {/* Location Status */}
            <div className="mt-8">
              {location ? (
                <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-green-500/10 text-green-600 text-sm font-medium border border-green-500/20">
                  <EnvironmentOutlined />
                  <span>已定位: {location.lat.toFixed(4)}, {location.lng.toFixed(4)}</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-orange-500/10 text-orange-600 text-sm font-medium border border-orange-500/20">
                  <WarningOutlined />
                  <span>{locationError || '正在獲取位置資訊...'}</span>
                </div>
              )}
            </div>
          </GlassCard>

          {/* Action Buttons */}
          <div className="grid grid-cols-2 gap-6 w-full">
            <GlassButton 
              variant="primary" 
              size="lg" 
              className="h-24 flex items-center justify-center gap-4 hover:scale-[1.02] transition-transform"
              onClick={handleClockIn}
              disabled={!location || loading}
            >
              <LoginOutlined className="text-3xl" />
              <span className="text-2xl font-medium">上班打卡</span>
            </GlassButton>

            <GlassButton 
              variant="orange" 
              size="lg" 
              className="h-24 flex items-center justify-center gap-4 hover:scale-[1.02] transition-transform"
              onClick={handleClockOut}
              disabled={!location || loading}
            >
              <LogoutOutlined className="text-3xl" />
              <span className="text-2xl font-medium">下班打卡</span>
            </GlassButton>
          </div>

          <GlassButton
            variant="secondary"
            size="lg"
            className="h-16 flex items-center justify-center gap-3"
            onClick={openOvertimeModal}
          >
            <PlusOutlined className="text-xl" />
            <span className="text-lg font-medium">提出加班申請</span>
          </GlassButton>
        </div>

        {/* Right Column: History */}
        <div className="lg:col-span-4 flex flex-col gap-6">
          {/* Last Action Status */}
          {lastAction && (
            <div className="animate-[fadeInUp_0.3s_ease-out]">
              <GlassCard className="py-4 px-6 flex items-center justify-between bg-green-50/30 border-green-200/30 w-full">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-green-500 flex items-center justify-center text-white shadow-lg shadow-green-500/30">
                    <CheckCircleOutlined className="text-xl" />
                  </div>
                  <div>
                    <div className="text-sm text-slate-500">最新動作</div>
                    <div className="text-lg font-semibold text-slate-800">{lastAction.type}</div>
                  </div>
                </div>
                <div className="text-2xl font-light text-slate-700 font-mono">
                  {lastAction.time}
                </div>
              </GlassCard>
            </div>
          )}

          <GlassCard className="flex-1 w-full">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-900">今日打卡紀錄</h3>
              <span className="text-xs text-slate-500 bg-slate-100 px-2 py-1 rounded-full">
                {todayRecords.length} 筆紀錄
              </span>
            </div>
            
            {todayRecords.length > 0 ? (
              <div className="space-y-3">
                {todayRecords.map((record, idx) => (
                  <div key={idx} className="flex items-center justify-between p-3 rounded-xl bg-white/40 border border-white/40 hover:bg-white/60 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                        record.type === 'clock_in' 
                          ? 'bg-blue-100 text-blue-600' 
                          : 'bg-orange-100 text-orange-600'
                      }`}>
                        {record.type === 'clock_in' ? <LoginOutlined /> : <LogoutOutlined />}
                      </div>
                      <span className="text-slate-700 font-medium">
                        {record.type === 'clock_in' ? '上班打卡' : '下班打卡'}
                      </span>
                    </div>
                    <span className="text-slate-500 font-mono font-medium">{record.time}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="h-48 flex flex-col items-center justify-center text-slate-400 bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
                <ClockCircleOutlined className="text-3xl mb-2 opacity-50" />
                <span>尚無打卡紀錄</span>
              </div>
            )}
          </GlassCard>

          <GlassCard className="w-full">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-900">我的加班申請</h3>
              <span className="text-xs text-slate-500 bg-slate-100 px-2 py-1 rounded-full">
                {overtimeRequests.length} 筆
              </span>
            </div>

            {overtimeRequests.length > 0 ? (
              <div className="space-y-3">
                {overtimeRequests.slice(0, 5).map((request) => (
                  <div
                    key={request.id}
                    className="rounded-xl border border-white/30 bg-white/35 p-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="font-medium text-slate-800">
                          {dayjs(request.workDate).format('YYYY/MM/DD')} · {request.requestedMinutes} 分鐘
                        </div>
                        <div className="mt-1 text-xs text-slate-500">{request.reason}</div>
                      </div>
                      <span className="rounded-full bg-white/50 px-3 py-1 text-xs font-semibold text-slate-600">
                        {statusLabelMap[request.status] || request.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 px-4 py-6 text-center text-sm text-slate-400">
                目前尚無加班申請
              </div>
            )}
          </GlassCard>
        </div>
      </div>

      <GlassModal
        isOpen={overtimeModalOpen}
        onClose={() => setOvertimeModalOpen(false)}
        title="提出加班申請"
        maxWidth="max-w-[640px]"
        footer={
          <>
            <GlassButton variant="secondary" onClick={() => setOvertimeModalOpen(false)}>
              取消
            </GlassButton>
            <GlassButton onClick={() => void handleSubmitOvertime()}>
              送出申請
            </GlassButton>
          </>
        }
      >
        <div className="space-y-4">
          <div className="rounded-2xl border border-amber-100/70 bg-amber-50/70 px-4 py-3 text-sm leading-6 text-amber-800">
            加班需先完成當日上下班打卡，並且以 30 分鐘為一個申請單位。只有完成主管初審與覆核的加班申請，才可以拿來折抵遲到或計算加班費。
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <GlassInput
              label="加班日期"
              type="date"
              value={overtimeForm.workDate}
              onChange={(event) =>
                setOvertimeForm((prev) => ({ ...prev, workDate: event.target.value }))
              }
            />
            <GlassInput
              label="申請分鐘數"
              type="number"
              value={overtimeForm.requestedMinutes}
              onChange={(event) =>
                setOvertimeForm((prev) => ({
                  ...prev,
                  requestedMinutes: event.target.value,
                }))
              }
            />
          </div>
          <GlassTextarea
            label="加班原因"
            value={overtimeForm.reason}
            onChange={(event) =>
              setOvertimeForm((prev) => ({ ...prev, reason: event.target.value }))
            }
            placeholder="請說明今天延後下班的工作內容"
          />
        </div>
      </GlassModal>
    </div>
  );
};

export default EmployeeDashboardPage;
