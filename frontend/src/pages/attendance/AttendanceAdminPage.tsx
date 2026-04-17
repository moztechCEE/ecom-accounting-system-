import React, { useEffect, useMemo, useState } from "react";
import { message, Tooltip } from "antd";
import {
  CalendarOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  DashboardOutlined,
  DeleteOutlined,
  EditOutlined,
  FileAddOutlined,
  FileTextOutlined,
  PlusOutlined,
  PaperClipOutlined,
  ReloadOutlined,
  SettingOutlined,
  TeamOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import { attendanceService } from "../../services/attendance.service";
import { payrollService } from "../../services/payroll.service";
import {
  AdminLeaveBalance,
  AdminLeaveRequest,
  AttendancePolicy,
  LeaveStatus,
  LeaveType,
  SeniorityTier,
} from "../../types/attendance";
import { Department, Employee } from "../../types";
import { GlassButton } from "../../components/ui/GlassButton";
import { GlassCard } from "../../components/ui/GlassCard";
import { GlassInput } from "../../components/ui/GlassInput";
import { GlassModal } from "../../components/ui/GlassModal";
import { GlassSelect } from "../../components/ui/GlassSelect";
import { GlassTextarea } from "../../components/ui/GlassTextarea";

type AdminTab = "attendance" | "requests" | "policies" | "types" | "balances";

const emptyLeaveTypeForm = {
  code: "",
  name: "",
  balanceResetPolicy: "CALENDAR_YEAR",
  maxDaysPerYear: "",
  paidPercentage: "100",
  minNoticeHours: "0",
  requiresDocument: "false",
  allowCarryOver: "false",
  carryOverLimitHours: "0",
  seniorityTiers: [] as SeniorityTier[],
};

type PolicyScheduleForm = {
  assignmentScope: "department" | "employee";
  assignmentId: string;
  weekday: string;
  shiftStart: string;
  shiftEnd: string;
  breakMinutes: string;
  allowRemote: string;
};

const emptyPolicySchedule = (): PolicyScheduleForm => ({
  assignmentScope: "department",
  assignmentId: "",
  weekday: "1",
  shiftStart: "09:00",
  shiftEnd: "18:00",
  breakMinutes: "60",
  allowRemote: "false",
});

const emptyPolicyForm = {
  name: "",
  type: "office",
  requiresPhoto: "false",
  maxEarlyClock: "15",
  maxLateClock: "5",
  ipAllowList: "",
  geofence: "",
  schedules: [emptyPolicySchedule()],
};

const weekdayOptions = [
  { value: "0", label: "週日" },
  { value: "1", label: "週一" },
  { value: "2", label: "週二" },
  { value: "3", label: "週三" },
  { value: "4", label: "週四" },
  { value: "5", label: "週五" },
  { value: "6", label: "週六" },
];

const getSeniorityTiers = (leaveType?: LeaveType): SeniorityTier[] =>
  Array.isArray(leaveType?.metadata?.seniorityTiers)
    ? leaveType!.metadata!.seniorityTiers!
    : [];

const normalizeSeniorityTiers = (
  tiers?: Array<
    | {
        minYears?: number | string | null;
        maxYears?: number | string | null;
        days?: number | string | null;
      }
    | null
    | undefined
  >,
): SeniorityTier[] =>
  (tiers || [])
    .map((tier) => ({
      minYears: Number(tier?.minYears),
      maxYears:
        tier?.maxYears === undefined ||
        tier?.maxYears === null ||
        tier?.maxYears === ""
          ? undefined
          : Number(tier.maxYears),
      days: Number(tier?.days),
    }))
    .filter(
      (tier) =>
        Number.isFinite(tier.minYears) &&
        Number.isFinite(tier.days) &&
        (tier.maxYears === undefined || Number.isFinite(tier.maxYears)),
    )
    .sort((a, b) => a.minYears - b.minYears);

const formatSeniorityTier = (tier: SeniorityTier) =>
  tier.maxYears !== undefined
    ? `${tier.minYears} - ${tier.maxYears} 年：${tier.days} 天`
    : `${tier.minYears} 年以上：${tier.days} 天`;

const formatHistoryAction = (action: string) => {
  const map: Record<string, string> = {
    SUBMIT: "送出申請",
    APPROVE: "核准假單",
    REJECT: "駁回假單",
    MOVE_TO_REVIEW: "移至審核中",
  };

  return map[action] || action;
};

const isExternalDocumentUrl = (value?: string | null) =>
  Boolean(value && /^https?:\/\//i.test(value));

const formatWeekday = (weekday: number) =>
  weekdayOptions.find((item) => Number(item.value) === weekday)?.label ||
  `週${weekday}`;

const AttendanceAdminPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<AdminTab>("requests");
  const [loading, setLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState(dayjs());
  const [selectedYear, setSelectedYear] = useState(dayjs().year());
  const [dailyData, setDailyData] = useState<any[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<AdminLeaveRequest[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [leaveBalances, setLeaveBalances] = useState<AdminLeaveBalance[]>([]);
  const [policies, setPolicies] = useState<AttendancePolicy[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [requestStatusFilter, setRequestStatusFilter] = useState<string>("");
  const [employeeFilter, setEmployeeFilter] = useState<string>("");
  const [typeModalOpen, setTypeModalOpen] = useState(false);
  const [editingLeaveType, setEditingLeaveType] = useState<LeaveType | null>(
    null,
  );
  const [typeForm, setTypeForm] = useState(emptyLeaveTypeForm);
  const [policyModalOpen, setPolicyModalOpen] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<AttendancePolicy | null>(
    null,
  );
  const [policyForm, setPolicyForm] = useState(emptyPolicyForm);
  const [balanceModalOpen, setBalanceModalOpen] = useState(false);
  const [editingBalance, setEditingBalance] =
    useState<AdminLeaveBalance | null>(null);
  const [requestModalOpen, setRequestModalOpen] = useState(false);
  const [selectedRequest, setSelectedRequest] =
    useState<AdminLeaveRequest | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [balanceForm, setBalanceForm] = useState({
    accruedHours: "",
    carryOverHours: "",
    manualAdjustmentHours: "",
  });

  useEffect(() => {
    void loadAttendance();
  }, [selectedDate]);

  useEffect(() => {
    void loadManagementData();
  }, [selectedYear, requestStatusFilter, employeeFilter]);

  useEffect(() => {
    void loadReferenceData();
  }, []);

  const loadAttendance = async () => {
    try {
      setLoading(true);
      const result = await attendanceService.getDailySummary(
        selectedDate.format("YYYY-MM-DD"),
      );
      setDailyData(result);
    } catch (error) {
      console.error(error);
      message.error("無法載入考勤資料");
    } finally {
      setLoading(false);
    }
  };

  const loadManagementData = async () => {
    try {
      setLoading(true);
      const [requests, types, balances, policies] = await Promise.all([
        attendanceService.getAdminLeaveRequests({
          year: selectedYear,
          status: (requestStatusFilter as LeaveStatus | "") || "",
          employeeId: employeeFilter || undefined,
        }),
        attendanceService.getAdminLeaveTypes(),
        attendanceService.getAdminLeaveBalances({
          year: selectedYear,
          employeeId: employeeFilter || undefined,
        }),
        attendanceService.getAdminPolicies(),
      ]);
      setLeaveRequests(requests);
      setLeaveTypes(types);
      setLeaveBalances(balances);
      setPolicies(policies);
    } catch (error) {
      console.error(error);
      message.error("無法載入請假與額度管理資料");
    } finally {
      setLoading(false);
    }
  };

  const loadReferenceData = async () => {
    try {
      const [employeeResult, departmentResult] = await Promise.all([
        payrollService.getEmployees(1, 200),
        payrollService.getDepartments(),
      ]);
      setEmployees(employeeResult.items);
      setDepartments(departmentResult);
    } catch (error) {
      console.error(error);
      message.error("無法載入班表設定參考資料");
    }
  };

  const employeeOptions = useMemo(() => {
    const map = new Map<string, string>();
    [...leaveRequests, ...leaveBalances].forEach((item: any) => {
      if (item.employee?.id) {
        map.set(item.employee.id, item.employee.name);
      }
    });

    return [
      { value: "", label: "全部員工" },
      ...Array.from(map.entries()).map(([value, label]) => ({ value, label })),
    ];
  }, [leaveRequests, leaveBalances]);

  const attendanceStats = {
    total: dailyData.length,
    present: dailyData.filter((d) => d.clockInTime).length,
    missing: dailyData.filter((d) => !d.clockInTime).length,
    late: dailyData.filter((d) => d.status === "late").length,
  };

  const managementStats = {
    pendingRequests: leaveRequests.filter(
      (request) => request.status === LeaveStatus.SUBMITTED,
    ).length,
    activeLeaveTypes: leaveTypes.filter(
      (type) => (type as any).isActive !== false,
    ).length,
    trackedBalances: leaveBalances.length,
    remainingAnnualHours: leaveBalances
      .filter((balance) => balance.leaveType.code === "ANNUAL")
      .reduce((sum, balance) => sum + balance.remainingHours, 0),
  };

  const requestStatusBadge = (status: string) => {
    const config: Record<string, string> = {
      APPROVED: "bg-emerald-100/70 text-emerald-700",
      REJECTED: "bg-rose-100/70 text-rose-700",
      SUBMITTED: "bg-sky-100/70 text-sky-700",
      UNDER_REVIEW: "bg-amber-100/70 text-amber-700",
      DRAFT: "bg-slate-100/70 text-slate-600",
      CANCELLED: "bg-slate-100/70 text-slate-500",
    };

    return (
      <span
        className={`rounded-full px-3 py-1 text-xs font-semibold border border-white/30 ${
          config[status] || "bg-slate-100/70 text-slate-600"
        }`}
      >
        {status}
      </span>
    );
  };

  const attendanceStatusBadge = (status: string) => {
    const config: Record<string, { text: string; className: string }> = {
      completed: {
        text: "正常",
        className: "bg-emerald-100/70 text-emerald-700",
      },
      pending: { text: "進行中", className: "bg-amber-100/70 text-amber-700" },
      missing_clock: {
        text: "缺卡",
        className: "bg-rose-100/70 text-rose-700",
      },
      leave: { text: "請假", className: "bg-sky-100/70 text-sky-700" },
      late: { text: "遲到", className: "bg-orange-100/70 text-orange-700" },
    };

    const badge = config[status] || {
      text: status,
      className: "bg-slate-100/70 text-slate-600",
    };

    return (
      <span
        className={`rounded-full px-3 py-1 text-xs font-semibold ${badge.className}`}
      >
        {badge.text}
      </span>
    );
  };

  const handleApproveRequest = async (
    requestId: string,
    status: LeaveStatus,
    note?: string,
  ) => {
    try {
      await attendanceService.updateLeaveStatus(requestId, status, note);
      message.success(
        `假單已${status === LeaveStatus.APPROVED ? "核准" : "駁回"}`,
      );
      setRequestModalOpen(false);
      setSelectedRequest(null);
      setReviewNote("");
      await loadManagementData();
    } catch (error: any) {
      console.error(error);
      message.error(error?.response?.data?.message || "更新假單狀態失敗");
    }
  };

  const openRequestModal = (request: AdminLeaveRequest) => {
    setSelectedRequest(request);
    setReviewNote("");
    setRequestModalOpen(true);
  };

  const openCreateLeaveType = () => {
    setEditingLeaveType(null);
    setTypeForm(emptyLeaveTypeForm);
    setTypeModalOpen(true);
  };

  const openCreatePolicy = () => {
    setEditingPolicy(null);
    setPolicyForm({
      ...emptyPolicyForm,
      schedules: [emptyPolicySchedule()],
    });
    setPolicyModalOpen(true);
  };

  const openEditPolicy = (policy: AttendancePolicy) => {
    setEditingPolicy(policy);
    setPolicyForm({
      name: policy.name,
      type: policy.type,
      requiresPhoto: String(Boolean(policy.requiresPhoto)),
      maxEarlyClock: String(policy.maxEarlyClock ?? 15),
      maxLateClock: String(policy.maxLateClock ?? 5),
      ipAllowList: Array.isArray(policy.ipAllowList)
        ? policy.ipAllowList.join("\n")
        : "",
      geofence: policy.geofence
        ? JSON.stringify(policy.geofence, null, 2)
        : "",
      schedules:
        policy.schedules.length > 0
          ? policy.schedules.map((schedule) => ({
              assignmentScope: schedule.employeeId ? "employee" : "department",
              assignmentId:
                schedule.employeeId || schedule.departmentId || "",
              weekday: String(schedule.weekday),
              shiftStart: schedule.shiftStart,
              shiftEnd: schedule.shiftEnd,
              breakMinutes: String(schedule.breakMinutes ?? 60),
              allowRemote: String(Boolean(schedule.allowRemote)),
            }))
          : [emptyPolicySchedule()],
    });
    setPolicyModalOpen(true);
  };

  const savePolicy = async () => {
    try {
      const ipAllowList = policyForm.ipAllowList
        .split(/\n|,/)
        .map((item) => item.trim())
        .filter(Boolean);
      const geofence =
        policyForm.geofence.trim().length > 0
          ? JSON.parse(policyForm.geofence)
          : undefined;
      const schedules = policyForm.schedules
        .filter((schedule) => schedule.assignmentId)
        .map((schedule) => ({
          weekday: Number(schedule.weekday),
          shiftStart: schedule.shiftStart,
          shiftEnd: schedule.shiftEnd,
          breakMinutes: Number(schedule.breakMinutes || 60),
          allowRemote: schedule.allowRemote === "true",
          employeeId:
            schedule.assignmentScope === "employee"
              ? schedule.assignmentId
              : undefined,
          departmentId:
            schedule.assignmentScope === "department"
              ? schedule.assignmentId
              : undefined,
        }));

      const payload = {
        name: policyForm.name.trim(),
        type: policyForm.type as "office" | "remote" | "hybrid",
        requiresPhoto: policyForm.requiresPhoto === "true",
        maxEarlyClock: Number(policyForm.maxEarlyClock || 15),
        maxLateClock: Number(policyForm.maxLateClock || 5),
        ipAllowList,
        geofence,
        schedules,
      };

      if (!payload.name) {
        message.error("請先輸入政策名稱");
        return;
      }

      if (editingPolicy) {
        await attendanceService.updateAdminPolicy(editingPolicy.id, payload);
        message.success("班表政策已更新");
      } else {
        await attendanceService.createAdminPolicy(payload);
        message.success("班表政策已建立");
      }

      setPolicyModalOpen(false);
      setEditingPolicy(null);
      setPolicyForm({
        ...emptyPolicyForm,
        schedules: [emptyPolicySchedule()],
      });
      await loadManagementData();
    } catch (error: any) {
      console.error(error);
      message.error(error?.response?.data?.message || "儲存班表政策失敗");
    }
  };

  const deletePolicy = async (policy: AttendancePolicy) => {
    if (!window.confirm(`確認刪除政策「${policy.name}」？這會一起移除旗下班表。`)) {
      return;
    }

    try {
      await attendanceService.deleteAdminPolicy(policy.id);
      message.success("班表政策已刪除");
      await loadManagementData();
    } catch (error: any) {
      console.error(error);
      message.error(error?.response?.data?.message || "刪除班表政策失敗");
    }
  };

  const openEditLeaveType = (leaveType: LeaveType) => {
    setEditingLeaveType(leaveType);
    setTypeForm({
      code: leaveType.code,
      name: leaveType.name,
      balanceResetPolicy: leaveType.balanceResetPolicy || "CALENDAR_YEAR",
      maxDaysPerYear:
        leaveType.maxDaysPerYear !== undefined
          ? String(leaveType.maxDaysPerYear)
          : "",
      paidPercentage:
        leaveType.paidPercentage !== undefined
          ? String(leaveType.paidPercentage)
          : "100",
      minNoticeHours:
        leaveType.minNoticeHours !== undefined
          ? String(leaveType.minNoticeHours)
          : "0",
      requiresDocument: String(Boolean(leaveType.requiresDocument)),
      allowCarryOver: String(Boolean(leaveType.allowCarryOver)),
      carryOverLimitHours:
        leaveType.carryOverLimitHours !== undefined
          ? String(leaveType.carryOverLimitHours)
          : "0",
      seniorityTiers: getSeniorityTiers(leaveType),
    });
    setTypeModalOpen(true);
  };

  const saveLeaveType = async () => {
    try {
      const payload = {
        code: typeForm.code,
        name: typeForm.name,
        balanceResetPolicy: typeForm.balanceResetPolicy as
          | "CALENDAR_YEAR"
          | "HIRE_ANNIVERSARY"
          | "NONE",
        maxDaysPerYear:
          typeForm.maxDaysPerYear !== ""
            ? Number(typeForm.maxDaysPerYear)
            : undefined,
        paidPercentage:
          typeForm.paidPercentage !== ""
            ? Number(typeForm.paidPercentage)
            : undefined,
        minNoticeHours:
          typeForm.minNoticeHours !== ""
            ? Number(typeForm.minNoticeHours)
            : undefined,
        requiresDocument: typeForm.requiresDocument === "true",
        allowCarryOver: typeForm.allowCarryOver === "true",
        carryOverLimitHours:
          typeForm.carryOverLimitHours !== ""
            ? Number(typeForm.carryOverLimitHours)
            : undefined,
        seniorityTiers:
          typeForm.code.trim().toUpperCase() === "ANNUAL"
            ? normalizeSeniorityTiers(typeForm.seniorityTiers)
            : [],
      };

      if (editingLeaveType) {
        await attendanceService.updateLeaveType(editingLeaveType.id, payload);
        message.success("假別規則已更新");
      } else {
        await attendanceService.createLeaveType(payload);
        message.success("假別規則已建立");
      }

      setTypeModalOpen(false);
      await loadManagementData();
    } catch (error) {
      console.error(error);
      message.error("儲存假別規則失敗");
    }
  };

  const openBalanceEditor = (balance: AdminLeaveBalance) => {
    setEditingBalance(balance);
    setBalanceForm({
      accruedHours: String(balance.accruedHours),
      carryOverHours: String(balance.carryOverHours),
      manualAdjustmentHours: String(balance.manualAdjustmentHours),
    });
    setBalanceModalOpen(true);
  };

  const saveBalanceAdjustment = async () => {
    if (!editingBalance) {
      return;
    }

    try {
      await attendanceService.adjustLeaveBalance(editingBalance.id, {
        accruedHours: Number(balanceForm.accruedHours || 0),
        carryOverHours: Number(balanceForm.carryOverHours || 0),
        manualAdjustmentHours: Number(balanceForm.manualAdjustmentHours || 0),
      });
      message.success("年度額度已更新");
      setBalanceModalOpen(false);
      await loadManagementData();
    } catch (error) {
      console.error(error);
      message.error("更新額度失敗");
    }
  };

  const tabs: { key: AdminTab; label: string; icon: React.ReactNode }[] = [
    { key: "attendance", label: "每日出勤", icon: <DashboardOutlined /> },
    { key: "requests", label: "假單審核", icon: <CheckCircleOutlined /> },
    { key: "policies", label: "班表政策", icon: <ClockCircleOutlined /> },
    { key: "types", label: "假別規則", icon: <SettingOutlined /> },
    { key: "balances", label: "年度額度", icon: <CalendarOutlined /> },
  ];

  const primaryAction =
    activeTab === "policies"
      ? {
          label: "新增班表政策",
          icon: <ClockCircleOutlined />,
          onClick: openCreatePolicy,
        }
      : {
          label: "新增假別規則",
          icon: <FileAddOutlined />,
          onClick: openCreateLeaveType,
        };

  return (
    <div className="space-y-6 animate-[fadeInUp_0.4s_ease-out]">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <GlassCard className="relative overflow-hidden border-white/35 bg-white/40">
          <div className="absolute inset-y-0 right-0 w-56 bg-[radial-gradient(circle_at_center,rgba(96,165,250,0.24),transparent_72%)]" />
          <div className="relative">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/35 px-4 py-2 text-xs font-semibold tracking-[0.25em] text-slate-500 uppercase">
              <TeamOutlined />
              Attendance Control Deck
            </div>
            <h1 className="mt-4 text-3xl font-semibold text-slate-900">
              考勤後臺
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-500">
              這個工作台把每日出勤、假單審核、假別規則與年度額度整合在一起。主管與人資可以在同一個後臺快速切換日常巡檢、審核與規則維護，不需要再來回翻頁找按鈕。
            </p>
          </div>
        </GlassCard>

        <GlassCard className="border-white/35 bg-white/45 p-5">
          <div className="mb-3 text-xs font-semibold tracking-[0.2em] text-slate-400 uppercase">
            工具列
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-1">
            <GlassInput
              type="date"
              value={selectedDate.format("YYYY-MM-DD")}
              onChange={(event) => setSelectedDate(dayjs(event.target.value))}
            />
            <GlassInput
              type="number"
              value={String(selectedYear)}
              onChange={(event) => setSelectedYear(Number(event.target.value))}
            />
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-1">
            <GlassButton
              variant="secondary"
              className="h-12 gap-2 text-sm text-slate-800"
              onClick={() => {
                void loadAttendance();
                void loadManagementData();
              }}
            >
              <ReloadOutlined />
              重新整理資料
            </GlassButton>
            <GlassButton
              className="h-12 gap-2 text-sm"
              onClick={primaryAction.onClick}
            >
              {primaryAction.icon}
              {primaryAction.label}
            </GlassButton>
          </div>
        </GlassCard>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <GlassCard className="relative overflow-hidden">
          <div className="absolute right-4 top-4 text-slate-300">
            <ClockCircleOutlined className="text-4xl" />
          </div>
          <div className="text-sm text-slate-500">待審核假單</div>
          <div className="mt-2 text-3xl font-semibold text-slate-900">
            {managementStats.pendingRequests}
          </div>
          <div className="mt-3 text-xs text-slate-400">
            主管未處理的請假單數量
          </div>
        </GlassCard>
        <GlassCard className="relative overflow-hidden">
          <div className="absolute right-4 top-4 text-emerald-300">
            <CheckCircleOutlined className="text-4xl" />
          </div>
          <div className="text-sm text-slate-500">啟用中假別</div>
          <div className="mt-2 text-3xl font-semibold text-slate-900">
            {managementStats.activeLeaveTypes}
          </div>
          <div className="mt-3 text-xs text-slate-400">
            正在參與額度與薪資規則的假別
          </div>
        </GlassCard>
        <GlassCard className="relative overflow-hidden">
          <div className="absolute right-4 top-4 text-sky-300">
            <CalendarOutlined className="text-4xl" />
          </div>
          <div className="text-sm text-slate-500">
            {selectedYear} 年額度帳本
          </div>
          <div className="mt-2 text-3xl font-semibold text-slate-900">
            {managementStats.trackedBalances}
          </div>
          <div className="mt-3 text-xs text-slate-400">
            已建立的員工假別年度額度
          </div>
        </GlassCard>
        <GlassCard className="relative overflow-hidden">
          <div className="absolute right-4 top-4 text-orange-300">
            <WarningOutlined className="text-4xl" />
          </div>
          <div className="text-sm text-slate-500">全體特休餘額</div>
          <div className="mt-2 text-3xl font-semibold text-slate-900">
            {(managementStats.remainingAnnualHours / 8).toFixed(1)} 天
          </div>
          <div className="mt-3 text-xs text-slate-400">
            當年度已建立額度帳本的特休總剩餘量
          </div>
        </GlassCard>
      </div>

      <GlassCard className="overflow-hidden p-0">
        <div className="border-b border-white/20 bg-white/10 p-4">
          <div className="flex flex-wrap gap-2">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`inline-flex items-center gap-2 rounded-2xl px-4 py-2 text-sm font-semibold transition-all ${
                  activeTab === tab.key
                    ? "bg-slate-900 text-white shadow-[0_10px_30px_rgba(15,23,42,0.18)]"
                    : "bg-white/20 text-slate-600 hover:bg-white/30"
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="p-6">
          {(activeTab === "requests" || activeTab === "balances") && (
            <div className="mb-6 flex flex-wrap gap-3">
              <div className="w-40">
                <GlassSelect
                  options={[
                    { value: "", label: "全部狀態" },
                    { value: LeaveStatus.SUBMITTED, label: "簽核中" },
                    { value: LeaveStatus.APPROVED, label: "已核准" },
                    { value: LeaveStatus.REJECTED, label: "已駁回" },
                    { value: LeaveStatus.CANCELLED, label: "已取消" },
                  ]}
                  value={requestStatusFilter}
                  onChange={(event) =>
                    setRequestStatusFilter(event.target.value)
                  }
                />
              </div>
              <div className="w-48">
                <GlassSelect
                  options={employeeOptions}
                  value={employeeFilter}
                  onChange={(event) => setEmployeeFilter(event.target.value)}
                />
              </div>
            </div>
          )}

          {activeTab === "attendance" && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                <GlassCard>
                  <div className="text-sm text-slate-500">應到人數</div>
                  <div className="mt-2 text-3xl font-semibold text-slate-900">
                    {attendanceStats.total}
                  </div>
                </GlassCard>
                <GlassCard>
                  <div className="text-sm text-slate-500">實到人數</div>
                  <div className="mt-2 text-3xl font-semibold text-emerald-600">
                    {attendanceStats.present}
                  </div>
                </GlassCard>
                <GlassCard>
                  <div className="text-sm text-slate-500">缺卡/未到</div>
                  <div className="mt-2 text-3xl font-semibold text-rose-600">
                    {attendanceStats.missing}
                  </div>
                </GlassCard>
                <GlassCard>
                  <div className="text-sm text-slate-500">遲到</div>
                  <div className="mt-2 text-3xl font-semibold text-orange-500">
                    {attendanceStats.late}
                  </div>
                </GlassCard>
              </div>

              <div className="overflow-x-auto rounded-3xl border border-white/20 bg-white/20">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-white/20 text-sm text-slate-500">
                      <th className="px-5 py-4 font-medium">員工</th>
                      <th className="px-5 py-4 font-medium">部門</th>
                      <th className="px-5 py-4 font-medium">上班</th>
                      <th className="px-5 py-4 font-medium">下班</th>
                      <th className="px-5 py-4 font-medium">工時</th>
                      <th className="px-5 py-4 font-medium">狀態</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dailyData.map((record) => (
                      <tr
                        key={record.id}
                        className="border-b border-white/10 text-sm text-slate-700"
                      >
                        <td className="px-5 py-4 font-medium text-slate-900">
                          {record.employee?.name}
                        </td>
                        <td className="px-5 py-4">
                          {record.employee?.department?.name || "未分配"}
                        </td>
                        <td className="px-5 py-4 font-mono">
                          {record.clockInTime
                            ? dayjs(record.clockInTime).format("HH:mm:ss")
                            : "-"}
                        </td>
                        <td className="px-5 py-4 font-mono">
                          {record.clockOutTime
                            ? dayjs(record.clockOutTime).format("HH:mm:ss")
                            : "-"}
                        </td>
                        <td className="px-5 py-4">
                          {record.workedMinutes
                            ? `${(record.workedMinutes / 60).toFixed(1)} 小時`
                            : "-"}
                        </td>
                        <td className="px-5 py-4">
                          {attendanceStatusBadge(record.status)}
                        </td>
                      </tr>
                    ))}
                    {dailyData.length === 0 && (
                      <tr>
                        <td
                          colSpan={6}
                          className="px-5 py-10 text-center text-sm text-slate-400"
                        >
                          目前沒有這一天的出勤摘要資料
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === "requests" && (
            <div className="overflow-x-auto rounded-3xl border border-white/20 bg-white/20">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-white/20 text-sm text-slate-500">
                    <th className="px-5 py-4 font-medium">員工</th>
                    <th className="px-5 py-4 font-medium">假別</th>
                    <th className="px-5 py-4 font-medium">期間</th>
                    <th className="px-5 py-4 font-medium">時數</th>
                    <th className="px-5 py-4 font-medium">原因</th>
                    <th className="px-5 py-4 font-medium">狀態</th>
                    <th className="px-5 py-4 font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {leaveRequests.map((request) => (
                    <tr
                      key={request.id}
                      className="border-b border-white/10 text-sm text-slate-700"
                    >
                      <td className="px-5 py-4">
                        <div className="font-medium text-slate-900">
                          {request.employee.name}
                        </div>
                        <div className="text-xs text-slate-400">
                          {request.employee.department?.name || "未分配部門"}
                        </div>
                      </td>
                      <td className="px-5 py-4">{request.leaveType?.name}</td>
                      <td className="px-5 py-4">
                        <div>
                          {dayjs(request.startAt).format("YYYY/MM/DD HH:mm")}
                        </div>
                        <div className="text-xs text-slate-400">
                          至 {dayjs(request.endAt).format("YYYY/MM/DD HH:mm")}
                        </div>
                      </td>
                      <td className="px-5 py-4 font-mono">{request.hours}</td>
                      <td className="px-5 py-4 max-w-[280px]">
                        <div className="truncate">{request.reason || "—"}</div>
                        <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-400">
                          {request.documents?.length ? (
                            <span>附件 {request.documents.length} 筆</span>
                          ) : null}
                          {request.location ? <span>地點：{request.location}</span> : null}
                          {request.requiredDocsMet === false ? (
                            <span className="text-rose-500">附件未補齊</span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        {requestStatusBadge(request.status)}
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex flex-wrap gap-2">
                          <GlassButton
                            variant="secondary"
                            className="gap-2 px-4 py-2 text-sm"
                            onClick={() => openRequestModal(request)}
                          >
                            <FileTextOutlined />
                            {request.status === LeaveStatus.SUBMITTED ? "審核" : "詳情"}
                          </GlassButton>
                          {request.status === LeaveStatus.SUBMITTED && (
                            <span className="text-xs text-slate-400">
                              待主管處理
                            </span>
                          )}
                          {request.status !== LeaveStatus.SUBMITTED && (
                            <span className="text-xs text-slate-400">
                              {request.reviewer?.name
                                ? `處理人：${request.reviewer.name}`
                                : "已處理"}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {leaveRequests.length === 0 && (
                    <tr>
                      <td
                        colSpan={7}
                        className="px-5 py-10 text-center text-sm text-slate-400"
                      >
                        目前沒有符合條件的假單
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === "types" && (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              {leaveTypes.map((leaveType) => (
                <GlassCard
                  key={leaveType.id}
                  className="relative overflow-hidden"
                >
                  <div className="absolute right-4 top-4 rounded-full bg-white/30 px-3 py-1 text-[11px] font-semibold tracking-[0.2em] text-slate-500">
                    {leaveType.code}
                  </div>
                  <div className="pr-20">
                    <div className="text-xl font-semibold text-slate-900">
                      {leaveType.name}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                      <span className="rounded-full bg-white/30 px-3 py-1">
                        重算週期：
                        {leaveType.balanceResetPolicy || "CALENDAR_YEAR"}
                      </span>
                      <span className="rounded-full bg-white/30 px-3 py-1">
                        支薪比例：{leaveType.paidPercentage ?? 100}%
                      </span>
                      <span className="rounded-full bg-white/30 px-3 py-1">
                        年度額度：{leaveType.maxDaysPerYear ?? "—"} 天
                      </span>
                      {getSeniorityTiers(leaveType).length > 0 ? (
                        <span className="rounded-full bg-white/30 px-3 py-1">
                          自訂級距：{getSeniorityTiers(leaveType).length} 段
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-4 text-sm leading-6 text-slate-500">
                      {leaveType.requiresDocument ? "需附件" : "免附件"}
                      ，通知提前 {leaveType.minNoticeHours ?? 0} 小時，
                      {leaveType.allowCarryOver
                        ? `可結轉，最多 ${leaveType.carryOverLimitHours ?? 0} 小時`
                        : "不結轉"}
                    </div>
                    {getSeniorityTiers(leaveType).length > 0 ? (
                      <div className="mt-3 rounded-2xl border border-sky-100/70 bg-sky-50/70 px-4 py-3 text-xs leading-6 text-sky-700">
                        {getSeniorityTiers(leaveType)
                          .map((tier) => formatSeniorityTier(tier))
                          .join(" / ")}
                      </div>
                    ) : null}
                    {leaveType.code === "ANNUAL" ? (
                      <div className="mt-3 rounded-2xl border border-emerald-100/60 bg-emerald-50/70 px-4 py-3 text-xs leading-6 text-emerald-700">
                        特休目前會依到職年資自動計算年度額度，未手動設定固定天數時，系統會套用標準年資級距。
                      </div>
                    ) : null}
                  </div>
                  <div className="mt-5 flex justify-end">
                    <GlassButton
                      variant="secondary"
                      className="gap-2 px-4 py-2 text-sm"
                      onClick={() => openEditLeaveType(leaveType)}
                    >
                      <EditOutlined />
                      編輯規則
                    </GlassButton>
                  </div>
                </GlassCard>
              ))}
            </div>
          )}

          {activeTab === "policies" && (
            <div className="space-y-5">
              <GlassCard className="border border-sky-100/70 bg-sky-50/70">
                <div className="text-sm font-semibold text-sky-900">班表與打卡政策</div>
                <div className="mt-2 text-sm leading-6 text-sky-800">
                  在這裡設定打卡照片要求、最早可打卡時間、遲到寬限，以及員工或部門的每週班表。打卡驗證與異常檢查會直接使用這裡的設定。
                </div>
              </GlassCard>

              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                {policies.map((policy) => (
                  <GlassCard key={policy.id} className="relative overflow-hidden">
                    <div className="absolute right-4 top-4 rounded-full bg-white/30 px-3 py-1 text-[11px] font-semibold tracking-[0.2em] text-slate-500 uppercase">
                      {policy.type}
                    </div>
                    <div className="pr-20">
                      <div className="text-xl font-semibold text-slate-900">
                        {policy.name}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
                        <span className="rounded-full bg-white/30 px-3 py-1">
                          最早打卡：前 {policy.maxEarlyClock} 分鐘
                        </span>
                        <span className="rounded-full bg-white/30 px-3 py-1">
                          遲到寬限：{policy.maxLateClock} 分鐘
                        </span>
                        <span className="rounded-full bg-white/30 px-3 py-1">
                          班表：{policy.schedules.length} 筆
                        </span>
                        <span className="rounded-full bg-white/30 px-3 py-1">
                          {policy.requiresPhoto ? "需拍照" : "免拍照"}
                        </span>
                      </div>
                      <div className="mt-4 space-y-2">
                        {policy.schedules.slice(0, 4).map((schedule) => (
                          <div
                            key={schedule.id}
                            className="rounded-2xl border border-white/20 bg-white/25 px-4 py-3 text-sm text-slate-600"
                          >
                            <div className="font-medium text-slate-800">
                              {formatWeekday(schedule.weekday)} · {schedule.shiftStart} - {schedule.shiftEnd}
                            </div>
                            <div className="mt-1 text-xs text-slate-500">
                              {schedule.department?.name
                                ? `部門：${schedule.department.name}`
                                : schedule.employee?.name
                                  ? `員工：${schedule.employee.name}`
                                  : "未指定對象"}
                              {" · "}休息 {schedule.breakMinutes} 分鐘
                              {schedule.allowRemote ? " · 允許遠端" : ""}
                            </div>
                          </div>
                        ))}
                        {policy.schedules.length > 4 ? (
                          <div className="text-xs text-slate-400">
                            另外還有 {policy.schedules.length - 4} 筆班表設定。
                          </div>
                        ) : null}
                        {policy.schedules.length === 0 ? (
                          <div className="rounded-2xl border border-dashed border-white/30 px-4 py-5 text-sm text-slate-400">
                            目前尚未設定班表。
                          </div>
                        ) : null}
                      </div>
                    </div>
                    <div className="mt-5 flex flex-wrap justify-end gap-2">
                      <GlassButton
                        variant="secondary"
                        className="gap-2 px-4 py-2 text-sm"
                        onClick={() => openEditPolicy(policy)}
                      >
                        <EditOutlined />
                        編輯政策
                      </GlassButton>
                      <GlassButton
                        variant="danger"
                        className="gap-2 px-4 py-2 text-sm"
                        onClick={() => void deletePolicy(policy)}
                      >
                        <DeleteOutlined />
                        刪除
                      </GlassButton>
                    </div>
                  </GlassCard>
                ))}
              </div>

              {policies.length === 0 ? (
                <GlassCard className="border border-dashed border-white/35 bg-white/20 text-center text-sm text-slate-400">
                  目前還沒有班表政策，建立後就能讓打卡驗證與異常檢查套用正式規則。
                </GlassCard>
              ) : null}
            </div>
          )}

          {activeTab === "balances" && (
            <div className="overflow-x-auto rounded-3xl border border-white/20 bg-white/20">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-white/20 text-sm text-slate-500">
                    <th className="px-5 py-4 font-medium">員工</th>
                    <th className="px-5 py-4 font-medium">假別</th>
                    <th className="px-5 py-4 font-medium">週期</th>
                    <th className="px-5 py-4 font-medium">應得</th>
                    <th className="px-5 py-4 font-medium">已用</th>
                    <th className="px-5 py-4 font-medium">待核</th>
                    <th className="px-5 py-4 font-medium">剩餘</th>
                    <th className="px-5 py-4 font-medium">調整</th>
                  </tr>
                </thead>
                <tbody>
                  {leaveBalances.map((balance) => (
                    <tr
                      key={balance.id}
                      className="border-b border-white/10 text-sm text-slate-700"
                    >
                      <td className="px-5 py-4">
                        <div className="font-medium text-slate-900">
                          {balance.employee.name}
                        </div>
                        <div className="text-xs text-slate-400">
                          {balance.employee.department?.name || "未分配部門"}
                        </div>
                      </td>
                      <td className="px-5 py-4">{balance.leaveType.name}</td>
                      <td className="px-5 py-4 text-xs text-slate-500">
                        {dayjs(balance.periodStart).format("YYYY/MM/DD")} 至{" "}
                        {dayjs(balance.periodEnd).format("YYYY/MM/DD")}
                      </td>
                      <td className="px-5 py-4 font-mono">
                        {balance.accruedHours}
                      </td>
                      <td className="px-5 py-4 font-mono">
                        {balance.usedHours}
                      </td>
                      <td className="px-5 py-4 font-mono">
                        {balance.pendingHours}
                      </td>
                      <td className="px-5 py-4 font-mono text-slate-900">
                        {balance.remainingHours}
                      </td>
                      <td className="px-5 py-4">
                        <Tooltip title="調整年度額度與人工補正">
                          <button
                            className="rounded-xl bg-white/30 p-2 text-slate-500 transition-colors hover:bg-white/50 hover:text-slate-900"
                            onClick={() => openBalanceEditor(balance)}
                          >
                            <EditOutlined />
                          </button>
                        </Tooltip>
                      </td>
                    </tr>
                  ))}
                  {leaveBalances.length === 0 && (
                    <tr>
                      <td
                        colSpan={8}
                        className="px-5 py-10 text-center text-sm text-slate-400"
                      >
                        目前沒有這個年度的額度帳本
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </GlassCard>

      <GlassModal
        isOpen={policyModalOpen}
        onClose={() => {
          setPolicyModalOpen(false);
          setEditingPolicy(null);
          setPolicyForm({
            ...emptyPolicyForm,
            schedules: [emptyPolicySchedule()],
          });
        }}
        title={editingPolicy ? "編輯班表政策" : "新增班表政策"}
        maxWidth="max-w-[960px]"
        footer={
          <>
            <GlassButton
              variant="secondary"
              onClick={() => {
                setPolicyModalOpen(false);
                setEditingPolicy(null);
                setPolicyForm({
                  ...emptyPolicyForm,
                  schedules: [emptyPolicySchedule()],
                });
              }}
            >
              取消
            </GlassButton>
            <GlassButton onClick={() => void savePolicy()}>
              {editingPolicy ? "儲存更新" : "建立政策"}
            </GlassButton>
          </>
        }
      >
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <GlassInput
              label="政策名稱"
              value={policyForm.name}
              onChange={(event) =>
                setPolicyForm((prev) => ({ ...prev, name: event.target.value }))
              }
              placeholder="例如：總部辦公室平日班"
            />
            <GlassSelect
              label="政策類型"
              value={policyForm.type}
              onChange={(event) =>
                setPolicyForm((prev) => ({ ...prev, type: event.target.value }))
              }
              options={[
                { value: "office", label: "Office" },
                { value: "hybrid", label: "Hybrid" },
                { value: "remote", label: "Remote" },
              ]}
            />
            <GlassInput
              label="最早可打卡（分鐘）"
              type="number"
              value={policyForm.maxEarlyClock}
              onChange={(event) =>
                setPolicyForm((prev) => ({
                  ...prev,
                  maxEarlyClock: event.target.value,
                }))
              }
            />
            <GlassInput
              label="遲到寬限（分鐘）"
              type="number"
              value={policyForm.maxLateClock}
              onChange={(event) =>
                setPolicyForm((prev) => ({
                  ...prev,
                  maxLateClock: event.target.value,
                }))
              }
            />
            <GlassSelect
              label="是否要求打卡照片"
              value={policyForm.requiresPhoto}
              onChange={(event) =>
                setPolicyForm((prev) => ({
                  ...prev,
                  requiresPhoto: event.target.value,
                }))
              }
              options={[
                { value: "false", label: "不需要" },
                { value: "true", label: "需要" },
              ]}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <GlassTextarea
              label="IP 白名單"
              value={policyForm.ipAllowList}
              onChange={(event) =>
                setPolicyForm((prev) => ({
                  ...prev,
                  ipAllowList: event.target.value,
                }))
              }
              placeholder={"一行一筆，例如：\n203.0.113.0/24\n10.0.0.5"}
            />
            <GlassTextarea
              label="Geofence JSON（選填）"
              value={policyForm.geofence}
              onChange={(event) =>
                setPolicyForm((prev) => ({
                  ...prev,
                  geofence: event.target.value,
                }))
              }
              placeholder='例如：{"type":"circle","center":[121.56,25.04],"radius":120}'
            />
          </div>

          <div className="rounded-3xl border border-white/20 bg-white/15 p-4">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-900">班表設定</div>
                <div className="text-xs text-slate-500">
                  每一筆班表都要指定到部門或員工。員工班表會優先覆蓋部門班表。
                </div>
              </div>
              <GlassButton
                variant="secondary"
                className="gap-2 px-4 py-2 text-sm"
                onClick={() =>
                  setPolicyForm((prev) => ({
                    ...prev,
                    schedules: [...prev.schedules, emptyPolicySchedule()],
                  }))
                }
              >
                <PlusOutlined />
                新增班表
              </GlassButton>
            </div>

            <div className="space-y-3">
              {policyForm.schedules.map((schedule, index) => {
                const assignmentOptions =
                  schedule.assignmentScope === "employee"
                    ? [
                        { value: "", label: "請選擇員工" },
                        ...employees.map((employee) => ({
                          value: employee.id,
                          label: `${employee.name} (${employee.employeeNo})`,
                        })),
                      ]
                    : [
                        { value: "", label: "請選擇部門" },
                        ...departments.map((department) => ({
                          value: department.id,
                          label: department.name,
                        })),
                      ];

                return (
                  <div
                    key={`${schedule.assignmentScope}-${index}`}
                    className="rounded-2xl border border-white/20 bg-white/25 p-4"
                  >
                    <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                      <GlassSelect
                        label="適用對象"
                        value={schedule.assignmentScope}
                        onChange={(event) =>
                          setPolicyForm((prev) => ({
                            ...prev,
                            schedules: prev.schedules.map((item, itemIndex) =>
                              itemIndex === index
                                ? {
                                    ...item,
                                    assignmentScope: event.target.value as
                                      | "department"
                                      | "employee",
                                    assignmentId: "",
                                  }
                                : item,
                            ),
                          }))
                        }
                        options={[
                          { value: "department", label: "部門" },
                          { value: "employee", label: "員工" },
                        ]}
                      />
                      <GlassSelect
                        label={schedule.assignmentScope === "employee" ? "員工" : "部門"}
                        value={schedule.assignmentId}
                        onChange={(event) =>
                          setPolicyForm((prev) => ({
                            ...prev,
                            schedules: prev.schedules.map((item, itemIndex) =>
                              itemIndex === index
                                ? { ...item, assignmentId: event.target.value }
                                : item,
                            ),
                          }))
                        }
                        options={assignmentOptions}
                      />
                      <GlassSelect
                        label="星期"
                        value={schedule.weekday}
                        onChange={(event) =>
                          setPolicyForm((prev) => ({
                            ...prev,
                            schedules: prev.schedules.map((item, itemIndex) =>
                              itemIndex === index
                                ? { ...item, weekday: event.target.value }
                                : item,
                            ),
                          }))
                        }
                        options={weekdayOptions}
                      />
                    </div>

                    <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-4">
                      <GlassInput
                        label="上班時間"
                        type="time"
                        value={schedule.shiftStart}
                        onChange={(event) =>
                          setPolicyForm((prev) => ({
                            ...prev,
                            schedules: prev.schedules.map((item, itemIndex) =>
                              itemIndex === index
                                ? { ...item, shiftStart: event.target.value }
                                : item,
                            ),
                          }))
                        }
                      />
                      <GlassInput
                        label="下班時間"
                        type="time"
                        value={schedule.shiftEnd}
                        onChange={(event) =>
                          setPolicyForm((prev) => ({
                            ...prev,
                            schedules: prev.schedules.map((item, itemIndex) =>
                              itemIndex === index
                                ? { ...item, shiftEnd: event.target.value }
                                : item,
                            ),
                          }))
                        }
                      />
                      <GlassInput
                        label="休息分鐘"
                        type="number"
                        value={schedule.breakMinutes}
                        onChange={(event) =>
                          setPolicyForm((prev) => ({
                            ...prev,
                            schedules: prev.schedules.map((item, itemIndex) =>
                              itemIndex === index
                                ? { ...item, breakMinutes: event.target.value }
                                : item,
                            ),
                          }))
                        }
                      />
                      <GlassSelect
                        label="遠端打卡"
                        value={schedule.allowRemote}
                        onChange={(event) =>
                          setPolicyForm((prev) => ({
                            ...prev,
                            schedules: prev.schedules.map((item, itemIndex) =>
                              itemIndex === index
                                ? { ...item, allowRemote: event.target.value }
                                : item,
                            ),
                          }))
                        }
                        options={[
                          { value: "false", label: "不允許" },
                          { value: "true", label: "允許" },
                        ]}
                      />
                    </div>

                    <div className="mt-3 flex justify-end">
                      <GlassButton
                        variant="danger"
                        className="gap-2 px-4 py-2 text-sm"
                        onClick={() =>
                          setPolicyForm((prev) => ({
                            ...prev,
                            schedules:
                              prev.schedules.length === 1
                                ? [emptyPolicySchedule()]
                                : prev.schedules.filter(
                                    (_, itemIndex) => itemIndex !== index,
                                  ),
                          }))
                        }
                      >
                        <DeleteOutlined />
                        刪除班表
                      </GlassButton>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </GlassModal>

      <GlassModal
        isOpen={requestModalOpen}
        onClose={() => {
          setRequestModalOpen(false);
          setSelectedRequest(null);
          setReviewNote("");
        }}
        title={selectedRequest?.status === LeaveStatus.SUBMITTED ? "審核假單" : "假單詳情"}
        maxWidth="max-w-[880px]"
        footer={
          selectedRequest ? (
            selectedRequest.status === LeaveStatus.SUBMITTED ? (
              <>
                <GlassButton
                  variant="secondary"
                  onClick={() => {
                    setRequestModalOpen(false);
                    setSelectedRequest(null);
                    setReviewNote("");
                  }}
                >
                  取消
                </GlassButton>
                <GlassButton
                  variant="danger"
                  onClick={() =>
                    void handleApproveRequest(
                      selectedRequest.id,
                      LeaveStatus.REJECTED,
                      reviewNote,
                    )
                  }
                >
                  駁回假單
                </GlassButton>
                <GlassButton
                  onClick={() =>
                    void handleApproveRequest(
                      selectedRequest.id,
                      LeaveStatus.APPROVED,
                      reviewNote,
                    )
                  }
                >
                  核准假單
                </GlassButton>
              </>
            ) : (
              <GlassButton
                variant="secondary"
                onClick={() => {
                  setRequestModalOpen(false);
                  setSelectedRequest(null);
                  setReviewNote("");
                }}
              >
                關閉
              </GlassButton>
            )
          ) : null
        }
      >
        {selectedRequest ? (
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-white/20 bg-white/20 p-4">
                <div className="text-xs font-semibold tracking-[0.2em] text-slate-400 uppercase">
                  申請人
                </div>
                <div className="mt-2 text-lg font-semibold text-slate-900">
                  {selectedRequest.employee.name}
                </div>
                <div className="mt-1 text-sm text-slate-500">
                  {selectedRequest.employee.department?.name || "未分配部門"}
                </div>
              </div>
              <div className="rounded-2xl border border-white/20 bg-white/20 p-4">
                <div className="text-xs font-semibold tracking-[0.2em] text-slate-400 uppercase">
                  假別與狀態
                </div>
                <div className="mt-2 text-lg font-semibold text-slate-900">
                  {selectedRequest.leaveType?.name}
                </div>
                <div className="mt-2">{requestStatusBadge(selectedRequest.status)}</div>
              </div>
              <div className="rounded-2xl border border-white/20 bg-white/20 p-4">
                <div className="text-xs font-semibold tracking-[0.2em] text-slate-400 uppercase">
                  請假期間
                </div>
                <div className="mt-2 text-sm text-slate-700">
                  {dayjs(selectedRequest.startAt).format("YYYY/MM/DD HH:mm")}
                </div>
                <div className="text-sm text-slate-500">
                  至 {dayjs(selectedRequest.endAt).format("YYYY/MM/DD HH:mm")}
                </div>
              </div>
              <div className="rounded-2xl border border-white/20 bg-white/20 p-4">
                <div className="text-xs font-semibold tracking-[0.2em] text-slate-400 uppercase">
                  時數與地點
                </div>
                <div className="mt-2 text-sm text-slate-700">
                  {selectedRequest.hours} 小時
                </div>
                <div className="text-sm text-slate-500">
                  {selectedRequest.location || "未填寫地點"}
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-white/20 bg-white/20 p-4">
              <div className="text-sm font-semibold text-slate-900">請假原因</div>
              <div className="mt-2 text-sm leading-6 text-slate-600">
                {selectedRequest.reason || "未填寫原因"}
              </div>
            </div>

            <div className="rounded-2xl border border-white/20 bg-white/20 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <PaperClipOutlined />
                附件資料
              </div>
              <div className="mt-3 space-y-3">
                {selectedRequest.documents?.length ? (
                  selectedRequest.documents.map((document) => (
                    <div
                      key={document.id}
                      className="rounded-2xl border border-white/20 bg-white/30 p-4"
                    >
                      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                        <div>
                          <div className="font-medium text-slate-900">
                            {document.fileName}
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            類型：{document.docType || "未指定"} ·
                            上傳時間：{dayjs(document.uploadedAt).format("YYYY/MM/DD HH:mm")}
                          </div>
                        </div>
                        {isExternalDocumentUrl(document.fileUrl) ? (
                          <a
                            href={document.fileUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-sm font-medium text-sky-600 hover:text-sky-700"
                          >
                            開啟附件
                          </a>
                        ) : (
                          <span className="text-xs text-slate-400">尚未附上外部連結</span>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-2xl border border-dashed border-white/30 px-4 py-6 text-sm text-slate-400">
                    這張假單目前沒有附件。
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-white/20 bg-white/20 p-4">
              <div className="text-sm font-semibold text-slate-900">審核歷程</div>
              <div className="mt-3 space-y-3">
                {selectedRequest.histories?.length ? (
                  selectedRequest.histories.map((history) => (
                    <div
                      key={history.id}
                      className="rounded-2xl border border-white/20 bg-white/30 p-4"
                    >
                      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                        <div>
                          <div className="font-medium text-slate-900">
                            {formatHistoryAction(history.action)}
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            {history.actor?.name || "系統"} ·{" "}
                            {dayjs(history.createdAt).format("YYYY/MM/DD HH:mm")}
                          </div>
                        </div>
                        {history.toStatus ? requestStatusBadge(history.toStatus) : null}
                      </div>
                      {history.note ? (
                        <div className="mt-3 text-sm leading-6 text-slate-600">
                          {history.note}
                        </div>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <div className="rounded-2xl border border-dashed border-white/30 px-4 py-6 text-sm text-slate-400">
                    目前尚無審核歷程。
                  </div>
                )}
              </div>
            </div>

            {selectedRequest.status === LeaveStatus.SUBMITTED ? (
              <GlassTextarea
                label="審核備註"
                value={reviewNote}
                onChange={(event) => setReviewNote(event.target.value)}
                placeholder="例如：請補正式證明、已與主管確認班表調整。"
              />
            ) : null}
          </div>
        ) : null}
      </GlassModal>

      <GlassModal
        isOpen={typeModalOpen}
        onClose={() => setTypeModalOpen(false)}
        title={editingLeaveType ? "編輯假別規則" : "新增假別規則"}
        footer={
          <>
            <GlassButton
              variant="secondary"
              onClick={() => setTypeModalOpen(false)}
            >
              取消
            </GlassButton>
            <GlassButton onClick={() => void saveLeaveType()}>
              {editingLeaveType ? "儲存更新" : "建立假別"}
            </GlassButton>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {(typeForm.code || editingLeaveType?.code) === "ANNUAL" ? (
            <div className="md:col-span-2 rounded-2xl border border-emerald-100/60 bg-emerald-50/70 px-4 py-3 text-xs leading-6 text-emerald-700">
              特休假別若使用到職週年制，系統會依年資自動計算額度。若你另外填入固定年度額度，會優先採用固定值。
            </div>
          ) : null}
          <GlassInput
            label="假別代碼"
            value={typeForm.code}
            onChange={(event) =>
              setTypeForm((prev) => ({ ...prev, code: event.target.value }))
            }
          />
          <GlassInput
            label="假別名稱"
            value={typeForm.name}
            onChange={(event) =>
              setTypeForm((prev) => ({ ...prev, name: event.target.value }))
            }
          />
          <GlassSelect
            label="年度重算方式"
            value={typeForm.balanceResetPolicy}
            onChange={(event) =>
              setTypeForm((prev) => ({
                ...prev,
                balanceResetPolicy: event.target.value,
              }))
            }
            options={[
              { value: "CALENDAR_YEAR", label: "曆年制" },
              { value: "HIRE_ANNIVERSARY", label: "到職週年制" },
              { value: "NONE", label: "無年度額度" },
            ]}
          />
          <GlassInput
            label="年度額度（天）"
            type="number"
            value={typeForm.maxDaysPerYear}
            onChange={(event) =>
              setTypeForm((prev) => ({
                ...prev,
                maxDaysPerYear: event.target.value,
              }))
            }
          />
          <GlassInput
            label="支薪比例（%）"
            type="number"
            value={typeForm.paidPercentage}
            onChange={(event) =>
              setTypeForm((prev) => ({
                ...prev,
                paidPercentage: event.target.value,
              }))
            }
          />
          <GlassInput
            label="最低提前時數"
            type="number"
            value={typeForm.minNoticeHours}
            onChange={(event) =>
              setTypeForm((prev) => ({
                ...prev,
                minNoticeHours: event.target.value,
              }))
            }
          />
          <GlassSelect
            label="是否需附件"
            value={typeForm.requiresDocument}
            onChange={(event) =>
              setTypeForm((prev) => ({
                ...prev,
                requiresDocument: event.target.value,
              }))
            }
            options={[
              { value: "false", label: "不需要" },
              { value: "true", label: "需要" },
            ]}
          />
          <GlassSelect
            label="是否可結轉"
            value={typeForm.allowCarryOver}
            onChange={(event) =>
              setTypeForm((prev) => ({
                ...prev,
                allowCarryOver: event.target.value,
              }))
            }
            options={[
              { value: "false", label: "不可結轉" },
              { value: "true", label: "可結轉" },
            ]}
          />
          <div className="md:col-span-2">
            <GlassInput
              label="結轉上限（小時）"
              type="number"
              value={typeForm.carryOverLimitHours}
              onChange={(event) =>
                setTypeForm((prev) => ({
                  ...prev,
                  carryOverLimitHours: event.target.value,
                }))
              }
            />
          </div>
          {(typeForm.code || editingLeaveType?.code) === "ANNUAL" ? (
            <div className="md:col-span-2 rounded-2xl border border-slate-200/80 bg-slate-50/80 p-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-slate-900">
                    自訂年資級距
                  </div>
                  <div className="text-xs text-slate-500">
                    沒有設定時，系統會採用內建的台灣標準特休級距。
                  </div>
                </div>
                <GlassButton
                  variant="secondary"
                  className="gap-2 px-4 py-2 text-sm"
                  onClick={() =>
                    setTypeForm((prev) => ({
                      ...prev,
                      seniorityTiers: [
                        ...prev.seniorityTiers,
                        { minYears: 0, days: 0 },
                      ],
                    }))
                  }
                >
                  <PlusOutlined />
                  新增級距
                </GlassButton>
              </div>

              <div className="space-y-3">
                {typeForm.seniorityTiers.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-white/70 px-4 py-5 text-sm text-slate-400">
                    目前沒有自訂級距。
                  </div>
                ) : null}

                {typeForm.seniorityTiers.map((tier, index) => (
                  <div
                    key={`${tier.minYears}-${tier.maxYears ?? "open"}-${index}`}
                    className="grid grid-cols-1 gap-3 rounded-2xl border border-slate-200 bg-white/80 p-4 md:grid-cols-[1fr_1fr_1fr_auto]"
                  >
                    <GlassInput
                      label="起始年資"
                      type="number"
                      value={String(tier.minYears)}
                      onChange={(event) =>
                        setTypeForm((prev) => ({
                          ...prev,
                          seniorityTiers: prev.seniorityTiers.map((item, itemIndex) =>
                            itemIndex === index
                              ? {
                                  ...item,
                                  minYears: Number(event.target.value),
                                }
                              : item,
                          ),
                        }))
                      }
                    />
                    <GlassInput
                      label="結束年資"
                      type="number"
                      value={
                        tier.maxYears === undefined ? "" : String(tier.maxYears)
                      }
                      placeholder="留空代表以上"
                      onChange={(event) =>
                        setTypeForm((prev) => ({
                          ...prev,
                          seniorityTiers: prev.seniorityTiers.map((item, itemIndex) =>
                            itemIndex === index
                              ? {
                                  ...item,
                                  maxYears:
                                    event.target.value === ""
                                      ? undefined
                                      : Number(event.target.value),
                                }
                              : item,
                          ),
                        }))
                      }
                    />
                    <GlassInput
                      label="給假天數"
                      type="number"
                      value={String(tier.days)}
                      onChange={(event) =>
                        setTypeForm((prev) => ({
                          ...prev,
                          seniorityTiers: prev.seniorityTiers.map((item, itemIndex) =>
                            itemIndex === index
                              ? {
                                  ...item,
                                  days: Number(event.target.value),
                                }
                              : item,
                          ),
                        }))
                      }
                    />
                    <div className="flex items-end">
                      <GlassButton
                        variant="danger"
                        className="gap-2 px-4 py-3 text-sm"
                        onClick={() =>
                          setTypeForm((prev) => ({
                            ...prev,
                            seniorityTiers: prev.seniorityTiers.filter(
                              (_, itemIndex) => itemIndex !== index,
                            ),
                          }))
                        }
                      >
                        <DeleteOutlined />
                        刪除
                      </GlassButton>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </GlassModal>

      <GlassModal
        isOpen={balanceModalOpen}
        onClose={() => setBalanceModalOpen(false)}
        title="調整年度額度"
        footer={
          <>
            <GlassButton
              variant="secondary"
              onClick={() => setBalanceModalOpen(false)}
            >
              取消
            </GlassButton>
            <GlassButton onClick={() => void saveBalanceAdjustment()}>
              儲存調整
            </GlassButton>
          </>
        }
        maxWidth="max-w-[560px]"
      >
        {editingBalance && (
          <div className="space-y-5">
            <div className="rounded-2xl border border-white/20 bg-white/20 p-4 text-sm text-slate-600">
              <div className="font-semibold text-slate-900">
                {editingBalance.employee.name}
              </div>
              <div className="mt-1">
                {editingBalance.leaveType.name} ·{" "}
                {dayjs(editingBalance.periodStart).format("YYYY/MM/DD")} -{" "}
                {dayjs(editingBalance.periodEnd).format("YYYY/MM/DD")}
              </div>
            </div>

            <GlassInput
              label="應得額度（小時）"
              type="number"
              value={balanceForm.accruedHours}
              onChange={(event) =>
                setBalanceForm((prev) => ({
                  ...prev,
                  accruedHours: event.target.value,
                }))
              }
            />
            <GlassInput
              label="結轉額度（小時）"
              type="number"
              value={balanceForm.carryOverHours}
              onChange={(event) =>
                setBalanceForm((prev) => ({
                  ...prev,
                  carryOverHours: event.target.value,
                }))
              }
            />
            <GlassInput
              label="人工補正（小時）"
              type="number"
              value={balanceForm.manualAdjustmentHours}
              onChange={(event) =>
                setBalanceForm((prev) => ({
                  ...prev,
                  manualAdjustmentHours: event.target.value,
                }))
              }
            />
          </div>
        )}
      </GlassModal>
    </div>
  );
};

export default AttendanceAdminPage;
