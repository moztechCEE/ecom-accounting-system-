import { useEffect, useState } from 'react';
import { Alert, Button, DatePicker, Input, message, Modal, Space, Table, Tabs, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { useAuth } from '../../contexts/AuthContext';
import { attendanceService } from '../../services/attendance.service';
import { AdminAttendanceRecord, AdminLeaveRequest, LeaveStatus } from '../../types/attendance';

const labels: Record<string,string> = { SUBMITTED: '待審', UNDER_REVIEW: '審核中', APPROVED: '已核准', REJECTED: '已駁回', CANCELLED: '已取消', DRAFT: '草稿' };
export default function DepartmentAttendancePage() {
  const { user } = useAuth();
  const [month, setMonth] = useState(dayjs());
  const [records, setRecords] = useState<AdminAttendanceRecord[]>([]);
  const [requests, setRequests] = useState<AdminLeaveRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<AdminLeaveRequest | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const load = async () => {
    setLoading(true); setError('');
    try {
      const [attendance, leaves] = await Promise.all([
        attendanceService.getAdminAttendanceRecords({ startDate: month.startOf('month').format('YYYY-MM-DD'), endDate: month.endOf('month').format('YYYY-MM-DD') }),
        attendanceService.getAdminLeaveRequests({ year: month.year() }),
      ]);
      setRecords(attendance); setRequests(leaves);
    } catch (e: any) { setError(e?.response?.data?.message || '無法載入部門出勤'); setRecords([]); setRequests([]); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [month, user?.departmentAccess?.departmentId]);
  const review = async (status: LeaveStatus) => {
    if (!selected || saving) return;
    setSaving(true);
    try { await attendanceService.updateLeaveStatus(selected.id, status, note); message.success('審核已儲存'); setSelected(null); await load(); }
    catch(e: any) { message.error(e?.response?.data?.message || '審核失敗，請重新載入'); }
    finally { setSaving(false); }
  };
  return <div className="space-y-6">
    <div className="flex flex-wrap justify-between items-center gap-4">
      <div><Typography.Title level={2}>部門出勤</Typography.Title><Typography.Text type="secondary">{user?.departmentAccess?.departmentName}</Typography.Text></div>
      <Space><DatePicker picker="month" allowClear={false} value={month} onChange={date => date && setMonth(date)} /><Button onClick={() => void load()} loading={loading}>重新整理</Button></Space>
    </div>
    {error && <Alert type="error" message={error} showIcon />}
    <div className="rounded-2xl bg-white p-6 border border-slate-200"><Tabs items={[
      { key: 'leave', label: '請假審核', children: <Table rowKey="id" loading={loading} dataSource={requests} scroll={{ x: 760 }} columns={[
        { title: '人員', render: (_, row) => row.employee.name },
        { title: '假別', render: (_, row) => row.leaveType?.name || '—' },
        { title: '期間', render: (_, row) => `${dayjs(row.startAt).format('MM/DD HH:mm')} ～ ${dayjs(row.endAt).format('MM/DD HH:mm')}` },
        { title: '時數', dataIndex: 'hours' },
        { title: '狀態', render: (_, row) => <Tag>{labels[row.status] || row.status}</Tag> },
        { title: '操作', render: (_, row) => <Button disabled={row.employee.id === user?.departmentAccess?.employeeId || !['SUBMITTED','UNDER_REVIEW'].includes(row.status)} onClick={() => { setSelected(row); setNote(''); }}>審核</Button> },
      ]} /> },
      { key: 'attendance', label: '出勤紀錄', children: <Table rowKey="id" loading={loading} dataSource={records} scroll={{ x: 650 }} columns={[
        { title: '人員', render: (_, row) => row.employee?.name },
        { title: '日期', render: (_, row) => dayjs(row.workDate).format('YYYY-MM-DD') },
        { title: '上班', render: (_, row) => row.clockInTime ? dayjs(row.clockInTime).format('HH:mm') : '—' },
        { title: '下班', render: (_, row) => row.clockOutTime ? dayjs(row.clockOutTime).format('HH:mm') : '—' },
        { title: '工時', render: (_, row) => `${((row.workedMinutes || 0) / 60).toFixed(1)} 小時` },
      ]} /> },
    ]} /></div>
    <Modal title="請假審核" open={Boolean(selected)} onCancel={() => !saving && setSelected(null)} footer={<Space><Button disabled={saving} onClick={() => setSelected(null)}>取消</Button><Button danger loading={saving} onClick={() => void review(LeaveStatus.REJECTED)}>駁回</Button><Button type="primary" loading={saving} onClick={() => void review(LeaveStatus.APPROVED)}>核准</Button></Space>}>
      <p>{selected?.employee.name} · {selected?.leaveType?.name} · {selected?.hours} 小時</p>
      <p>{selected?.reason || '未填寫原因'}</p>
      <Input.TextArea aria-label="審核備註" placeholder="審核備註" value={note} onChange={event => setNote(event.target.value)} />
    </Modal>
  </div>;
}
