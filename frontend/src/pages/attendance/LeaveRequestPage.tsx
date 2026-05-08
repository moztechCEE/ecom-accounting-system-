import React, { useState, useEffect, useMemo } from "react";
import { Alert, message } from "antd";
import { motion } from "framer-motion";
import {
  PlusOutlined,
  CalendarOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  DeleteOutlined,
  PaperClipOutlined,
} from "@ant-design/icons";
import { attendanceService } from "../../services/attendance.service";
import { payrollService } from "../../services/payroll.service";
import { useAuth } from "../../contexts/AuthContext";
import { hasPermission } from "../../utils/access";
import {
  LeaveBalance,
  LeaveRequest,
  LeaveStatus,
  LeaveType,
  LeaveRequestDocumentInput,
} from "../../types/attendance";
import dayjs from "dayjs";
import { GlassCard } from "../../components/ui/GlassCard";
import { GlassButton } from "../../components/ui/GlassButton";
import { GlassModal } from "../../components/ui/GlassModal";
import { GlassInput } from "../../components/ui/GlassInput";
import { GlassSelect } from "../../components/ui/GlassSelect";
import { GlassTextarea } from "../../components/ui/GlassTextarea";
import { Employee } from "../../types";

const emptyDocument = (): LeaveRequestDocumentInput => ({
  fileName: "",
  fileUrl: "",
  docType: "",
});

const funeralRelationshipOptions = [
  {
    value: "PARENT_OR_SPOUSE",
    label: "8 天：父母、養父母、繼父母、配偶",
    days: 8,
  },
  {
    value: "GRANDPARENT_CHILD_OR_SPOUSE_PARENT",
    label: "6 天：祖父母/外祖父母、子女、配偶之父母",
    days: 6,
  },
  {
    value: "GREAT_GRANDPARENT_SIBLING_OR_SPOUSE_GRANDPARENT",
    label: "3 天：曾祖父母、兄弟姊妹、配偶之祖父母",
    days: 3,
  },
];

const isFuneralLeaveType = (leaveType?: LeaveType) =>
  Boolean(
    leaveType &&
    (leaveType.code?.trim().toUpperCase() === "FUNERAL" ||
      leaveType.name?.trim() === "喪假"),
  );

type LeaveRequestDraft = {
  id: string;
  employeeId: string;
  leaveTypeId: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  hours: number;
  reason: string;
  location: string;
  funeralRelationship: string;
  deceasedName: string;
  deceasedDate: string;
  documents: LeaveRequestDocumentInput[];
};

const createLeaveRequestDraft = (employeeId = ""): LeaveRequestDraft => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  employeeId,
  leaveTypeId: "",
  startDate: "",
  startTime: "",
  endDate: "",
  endTime: "",
  hours: 0,
  reason: "",
  location: "",
  funeralRelationship: "",
  deceasedName: "",
  deceasedDate: "",
  documents: [],
});

const LeaveRequestPage: React.FC = () => {
  const { user } = useAuth();
  const canCreateForEmployees = hasPermission(user, "attendance_admin:update");
  const [loading, setLoading] = useState(false);
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [leaveBalances, setLeaveBalances] = useState<LeaveBalance[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [employeeLinkMissing, setEmployeeLinkMissing] = useState(false);
  const [requestRows, setRequestRows] = useState<LeaveRequestDraft[]>([
    createLeaveRequestDraft(),
  ]);

  // Form State
  const [formData, setFormData] = useState({
    employeeId: "",
    leaveTypeId: "",
    startDate: "",
    startTime: "",
    endDate: "",
    endTime: "",
    hours: 0,
    reason: "",
    location: "",
    funeralRelationship: "",
    deceasedName: "",
    deceasedDate: "",
    documents: [] as LeaveRequestDocumentInput[],
  });

  const resetForm = () =>
    setFormData({
      employeeId: "",
      leaveTypeId: "",
      startDate: "",
      startTime: "",
      endDate: "",
      endTime: "",
      hours: 0,
      reason: "",
      location: "",
      funeralRelationship: "",
      deceasedName: "",
      deceasedDate: "",
      documents: [],
    });

  useEffect(() => {
    loadData();
  }, [canCreateForEmployees]);

  const loadData = async () => {
    try {
      if (canCreateForEmployees) {
        const employeeResult = await payrollService.getEmployees(1, 500);
        const employeeList = employeeResult.items;

        setEmployees(employeeList);

        const [requestsData, typesData, balancesData] = await Promise.all([
          attendanceService.getAdminLeaveRequests({
            year: dayjs().year(),
          }),
          attendanceService.getAdminLeaveTypes(),
          attendanceService.getAdminLeaveBalances({
            year: dayjs().year(),
          }),
        ]);

        setRequests(requestsData);
        setLeaveTypes(typesData);
        setLeaveBalances(balancesData);
        setEmployeeLinkMissing(false);
        return;
      }

      const [requestsData, typesData, balancesData] = await Promise.all([
        attendanceService.getLeaveRequests(),
        attendanceService.getLeaveTypes(),
        attendanceService.getLeaveBalances(dayjs().year()),
      ]);
      setRequests(requestsData);
      setLeaveTypes(typesData);
      setLeaveBalances(balancesData);
      setEmployeeLinkMissing(false);
    } catch (error) {
      console.error(error);
      const backendMessage =
        typeof error === "object" &&
        error !== null &&
        "response" in error &&
        typeof (error as any).response?.data?.message === "string"
          ? (error as any).response.data.message
          : "";

      if (backendMessage.includes("Employee record not found")) {
        setEmployeeLinkMissing(true);
        setRequests([]);
        setLeaveTypes([]);
        setLeaveBalances([]);
        return;
      }

      message.error("無法載入資料");
    }
  };

  const handleInputChange = (
    e: React.ChangeEvent<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >,
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleDocumentChange = (
    index: number,
    field: keyof LeaveRequestDocumentInput,
    value: string,
  ) => {
    setFormData((prev) => ({
      ...prev,
      documents: prev.documents.map((document, documentIndex) =>
        documentIndex === index ? { ...document, [field]: value } : document,
      ),
    }));
  };

  const addDocument = () => {
    setFormData((prev) => ({
      ...prev,
      documents: [...prev.documents, emptyDocument()],
    }));
  };

  const removeDocument = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      documents: prev.documents.filter(
        (_, documentIndex) => documentIndex !== index,
      ),
    }));
  };

  const updateRequestRow = (
    rowId: string,
    patch: Partial<LeaveRequestDraft>,
  ) => {
    setRequestRows((current) =>
      current.map((row) => (row.id === rowId ? { ...row, ...patch } : row)),
    );
  };

  const addRequestRow = () => {
    setRequestRows((current) => [...current, createLeaveRequestDraft()]);
  };

  const removeRequestRow = (rowId: string) => {
    setRequestRows((current) =>
      current.length <= 1 ? current : current.filter((row) => row.id !== rowId),
    );
  };

  const addRowDocument = (rowId: string) => {
    setRequestRows((current) =>
      current.map((row) =>
        row.id === rowId
          ? { ...row, documents: [...row.documents, emptyDocument()] }
          : row,
      ),
    );
  };

  const updateRowDocument = (
    rowId: string,
    index: number,
    field: keyof LeaveRequestDocumentInput,
    value: string,
  ) => {
    setRequestRows((current) =>
      current.map((row) =>
        row.id === rowId
          ? {
              ...row,
              documents: row.documents.map((document, documentIndex) =>
                documentIndex === index
                  ? { ...document, [field]: value }
                  : document,
              ),
            }
          : row,
      ),
    );
  };

  const removeRowDocument = (rowId: string, index: number) => {
    setRequestRows((current) =>
      current.map((row) =>
        row.id === rowId
          ? {
              ...row,
              documents: row.documents.filter(
                (_, documentIndex) => documentIndex !== index,
              ),
            }
          : row,
      ),
    );
  };

  const buildLeaveRequestPayload = (draft: LeaveRequestDraft) => {
    const leaveType = leaveTypes.find((type) => type.id === draft.leaveTypeId);
    const funeralLeave = isFuneralLeaveType(leaveType);
    const hours = Number(draft.hours);
    const adminStartAt = dayjs(draft.startDate)
      .hour(9)
      .minute(0)
      .second(0)
      .millisecond(0);
    const adminEndAt = adminStartAt.add(
      Math.max(1, Math.round(hours * 60)),
      "minute",
    );
    const startAt = canCreateForEmployees
      ? adminStartAt
      : dayjs(`${draft.startDate} ${draft.startTime}`);
    const endAt = canCreateForEmployees
      ? adminEndAt
      : dayjs(`${draft.endDate} ${draft.endTime}`);

    return {
      employeeId: canCreateForEmployees ? draft.employeeId : undefined,
      leaveTypeId: draft.leaveTypeId,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      hours,
      reason: draft.reason,
      location: draft.location,
      funeralRelationship: funeralLeave ? draft.funeralRelationship : undefined,
      deceasedName: funeralLeave ? draft.deceasedName : undefined,
      deceasedDate: funeralLeave ? draft.deceasedDate : undefined,
      funeralEventKey: funeralLeave
        ? [
            draft.funeralRelationship,
            draft.deceasedName.trim(),
            draft.deceasedDate,
          ].join(":")
        : undefined,
      documents: draft.documents
        .map((document) => ({
          fileName: document.fileName?.trim() || "",
          fileUrl: document.fileUrl?.trim() || undefined,
          docType: document.docType?.trim() || undefined,
        }))
        .filter((document) => document.fileName),
    };
  };

  const handleSubmit = async () => {
    try {
      setLoading(true);

      if (canCreateForEmployees) {
        if (requestRows.length === 0) {
          message.error("請至少新增一筆請假資料");
          return;
        }

        for (let index = 0; index < requestRows.length; index += 1) {
          const row = requestRows[index];
          if (!row.employeeId || !row.leaveTypeId) {
            message.error(`第 ${index + 1} 筆請先選擇員工與假別`);
            return;
          }
          if (!row.startDate) {
            message.error(`第 ${index + 1} 筆請先填寫請假日期`);
            return;
          }
          if (!Number.isFinite(Number(row.hours)) || Number(row.hours) <= 0) {
            message.error(`第 ${index + 1} 筆請假時數必須大於 0`);
            return;
          }
          const rowEmployee = getEmployeeById(row.employeeId);
          if (
            !rowEmployee ||
            !isEmployeeSelectableOnDate(rowEmployee, row.startDate)
          ) {
            message.error(`第 ${index + 1} 筆員工不在該日期的任職期間內`);
            return;
          }

          await attendanceService.createLeaveRequest(
            buildLeaveRequestPayload(row),
          );
        }

        message.success(`已送出 ${requestRows.length} 筆請假申請`);
        setIsModalVisible(false);
        setRequestRows([createLeaveRequestDraft()]);
        void loadData();
        return;
      }

      // Combine date and time
      const startAt = dayjs(
        `${formData.startDate} ${formData.startTime}`,
      ).toISOString();
      const endAt = dayjs(
        `${formData.endDate} ${formData.endTime}`,
      ).toISOString();

      await attendanceService.createLeaveRequest({
        leaveTypeId: formData.leaveTypeId,
        startAt,
        endAt,
        hours: Number(formData.hours),
        reason: formData.reason,
        location: formData.location,
        funeralRelationship: selectedLeaveTypeIsFuneral
          ? formData.funeralRelationship
          : undefined,
        deceasedName: selectedLeaveTypeIsFuneral
          ? formData.deceasedName
          : undefined,
        deceasedDate: selectedLeaveTypeIsFuneral
          ? formData.deceasedDate
          : undefined,
        funeralEventKey: selectedLeaveTypeIsFuneral
          ? [
              formData.funeralRelationship,
              formData.deceasedName.trim(),
              formData.deceasedDate,
            ].join(":")
          : undefined,
        documents: formData.documents
          .map((document) => ({
            fileName: document.fileName?.trim() || "",
            fileUrl: document.fileUrl?.trim() || undefined,
            docType: document.docType?.trim() || undefined,
          }))
          .filter((document) => document.fileName),
      });

      message.success("請假申請已送出");
      setIsModalVisible(false);
      resetForm();
      void loadData();
    } catch (error: any) {
      console.error(error);
      message.error(error?.response?.data?.message || "申請失敗");
    } finally {
      setLoading(false);
    }
  };

  const getStatusTag = (status: LeaveStatus) => {
    const config: Record<string, { color: string; text: string; bg: string }> =
      {
        [LeaveStatus.APPROVED]: {
          color: "text-green-600",
          text: "已核准",
          bg: "bg-green-100/50",
        },
        [LeaveStatus.REJECTED]: {
          color: "text-red-600",
          text: "已駁回",
          bg: "bg-red-100/50",
        },
        [LeaveStatus.SUBMITTED]: {
          color: "text-blue-600",
          text: "簽核中",
          bg: "bg-blue-100/50",
        },
        [LeaveStatus.DRAFT]: {
          color: "text-gray-600",
          text: "草稿",
          bg: "bg-gray-100/50",
        },
      };
    const { color, text, bg } = config[status] || {
      color: "text-gray-600",
      text: status,
      bg: "bg-gray-100/50",
    };

    return (
      <span
        className={`px-3 py-1 rounded-full text-xs font-medium ${color} ${bg} border border-white/20`}
      >
        {text}
      </span>
    );
  };

  const formatHours = (hours?: number) => {
    if (hours === undefined || hours === null) {
      return "--";
    }

    if (Number.isInteger(hours / 8)) {
      return `${hours / 8} 天`;
    }

    return `${hours} 小時`;
  };

  const getEmployeeById = (employeeId: string) =>
    employees.find((employee) => employee.id === employeeId);
  const isEmployeeSelectableOnDate = (employee: Employee, date?: string) => {
    if (!date) {
      return false;
    }

    const selectedDate = dayjs(date).startOf("day");
    if (!selectedDate.isValid()) {
      return false;
    }

    if (employee.hireDate && selectedDate.isBefore(dayjs(employee.hireDate))) {
      return false;
    }

    if (employee.terminateDate) {
      return (
        selectedDate.valueOf() <=
        dayjs(employee.terminateDate).endOf("day").valueOf()
      );
    }

    return employee.isActive !== false;
  };
  const getEmployeeOptionsForDate = (date?: string) =>
    employees
      .filter((employee) => isEmployeeSelectableOnDate(employee, date))
      .map((employee) => ({
        value: employee.id,
        label: `${employee.name} (${employee.employeeNo})`,
      }));
  const getAvailableLeaveTypesForEmployee = (employeeId?: string) => {
    const employee = employeeId ? getEmployeeById(employeeId) : undefined;
    return leaveTypes.filter(
      (type) =>
        type.isActive !== false &&
        (!canCreateForEmployees ||
          employee?.gender === "FEMALE" ||
          !(
            type.code?.trim().toUpperCase() === "MENSTRUAL" ||
            type.name?.trim() === "生理假"
          )),
    );
  };
  const availableLeaveTypes = useMemo(
    () => leaveTypes.filter((type) => type.isActive !== false),
    [leaveTypes],
  );
  const getLeaveBalanceForRow = (row: LeaveRequestDraft) =>
    leaveBalances.find(
      (balance) =>
        balance.leaveType.id === row.leaveTypeId &&
        (!canCreateForEmployees ||
          (balance as any).employee?.id === row.employeeId),
    );
  const annualBalance =
    leaveBalances.find((balance) => balance.leaveType.code === "ANNUAL") ||
    leaveBalances[0];
  const annualRemainingHours = canCreateForEmployees
    ? leaveBalances
        .filter((balance) => balance.leaveType.code === "ANNUAL")
        .reduce((sum, balance) => sum + balance.remainingHours, 0)
    : annualBalance?.remainingHours;
  const usedHours = leaveBalances.reduce(
    (sum, balance) => sum + balance.usedHours,
    0,
  );
  const selectedLeaveType = availableLeaveTypes.find(
    (type) => type.id === formData.leaveTypeId,
  );
  const selectedLeaveBalance = leaveBalances.find(
    (balance) => balance.leaveType.id === formData.leaveTypeId,
  );
  const selectedLeaveTypeIsFuneral = isFuneralLeaveType(selectedLeaveType);
  const selectedFuneralRule = funeralRelationshipOptions.find(
    (option) => option.value === formData.funeralRelationship,
  );

  const compactInputClass =
    "w-full rounded-xl border border-white/30 bg-white/70 px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-blue-300 focus:bg-white";
  const compactSelectClass = `${compactInputClass} appearance-none`;
  const compactLabelClass =
    "mb-1 block text-[11px] font-medium tracking-wide text-slate-500";

  const renderRequestRow = (row: LeaveRequestDraft, index: number) => {
    const rowEmployeeOptions = getEmployeeOptionsForDate(row.startDate);
    const rowLeaveTypes = row.employeeId
      ? getAvailableLeaveTypesForEmployee(row.employeeId)
      : [];
    const rowLeaveType = rowLeaveTypes.find(
      (type) => type.id === row.leaveTypeId,
    );
    const rowLeaveBalance = getLeaveBalanceForRow(row);
    const rowIsFuneral = isFuneralLeaveType(rowLeaveType);
    const rowFuneralRule = funeralRelationshipOptions.find(
      (option) => option.value === row.funeralRelationship,
    );
    const employee = getEmployeeById(row.employeeId);
    const requiresDocument =
      Boolean(rowLeaveType?.requiresDocument) && row.documents.length === 0;

    return (
      <tr
        key={row.id}
        className="border-b border-white/20 align-top transition-colors hover:bg-white/20"
      >
        <td className="w-12 px-3 py-4 text-center text-sm font-semibold text-slate-500">
          {index + 1}
        </td>
        <td className="w-[160px] px-3 py-4">
          <label className={compactLabelClass}>請假日期</label>
          <input
            className={compactInputClass}
            type="date"
            value={row.startDate}
            onChange={(event) => {
              const nextDate = event.target.value;
              const employeeStillSelectable =
                employee && isEmployeeSelectableOnDate(employee, nextDate);
              updateRequestRow(row.id, {
                startDate: nextDate,
                endDate: nextDate,
                employeeId: employeeStillSelectable ? row.employeeId : "",
                leaveTypeId: employeeStillSelectable ? row.leaveTypeId : "",
              });
            }}
          />
          <div className="mt-1 min-h-4 text-xs text-slate-400">
            先選日期再選員工
          </div>
        </td>
        <td className="w-[190px] px-3 py-4">
          <label className={compactLabelClass}>員工</label>
          <select
            className={`${compactSelectClass} disabled:cursor-not-allowed disabled:opacity-60`}
            value={row.employeeId}
            disabled={!row.startDate}
            onChange={(event) =>
              updateRequestRow(row.id, {
                employeeId: event.target.value,
                leaveTypeId: "",
              })
            }
          >
            <option value="">
              {row.startDate ? "請選擇員工" : "請先選日期"}
            </option>
            {rowEmployeeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <div className="mt-1 min-h-4 truncate text-xs text-slate-400">
            {(employee as any)?.department?.name || " "}
          </div>
        </td>
        <td className="w-[170px] px-3 py-4">
          <label className={compactLabelClass}>假別</label>
          <select
            className={`${compactSelectClass} disabled:cursor-not-allowed disabled:opacity-60`}
            value={row.leaveTypeId}
            disabled={!row.employeeId}
            onChange={(event) =>
              updateRequestRow(row.id, { leaveTypeId: event.target.value })
            }
          >
            <option value="">
              {row.employeeId ? "請選擇假別" : "請先選員工"}
            </option>
            {rowLeaveTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </select>
          <div className="mt-1 min-h-4 truncate text-xs text-slate-400">
            {rowLeaveType
              ? rowLeaveBalance
                ? `剩餘 ${formatHours(rowLeaveBalance.remainingHours)}`
                : "不追蹤年度額度"
              : " "}
          </div>
        </td>
        <td className="w-[110px] px-3 py-4">
          <label className={compactLabelClass}>時數</label>
          <input
            className={compactInputClass}
            type="number"
            value={row.hours}
            min={0.5}
            step={0.5}
            onChange={(event) =>
              updateRequestRow(row.id, { hours: Number(event.target.value) })
            }
          />
        </td>
        <td className="w-[210px] px-3 py-4">
          <label className={compactLabelClass}>原因</label>
          <input
            className={compactInputClass}
            value={row.reason}
            placeholder="請假原因"
            onChange={(event) =>
              updateRequestRow(row.id, { reason: event.target.value })
            }
          />
          <input
            className={`${compactInputClass} mt-2`}
            value={row.location}
            placeholder="地點（選填）"
            onChange={(event) =>
              updateRequestRow(row.id, { location: event.target.value })
            }
          />
        </td>
        <td className="w-[230px] px-3 py-4">
          <details className="group rounded-xl border border-white/30 bg-white/40 px-3 py-2 text-sm">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 font-medium text-slate-700">
              <span>附件 / 細節</span>
              <span
                className={
                  requiresDocument
                    ? "rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700"
                    : "rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500"
                }
              >
                {row.documents.length} 件
              </span>
            </summary>

            <div className="mt-3 space-y-3">
              {rowLeaveType ? (
                <div className="rounded-lg bg-white/60 px-3 py-2 text-xs leading-5 text-slate-500">
                  支薪 {rowLeaveType.paidPercentage ?? 100}% / 提前{" "}
                  {rowLeaveType.minNoticeHours ?? 0} 小時
                  {rowLeaveType.requiresDocument ? " / 需附件" : " / 免附件"}
                </div>
              ) : null}

              {requiresDocument ? (
                <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  此列假別送出前需要附件
                </div>
              ) : null}

              {rowIsFuneral ? (
                <div className="space-y-2 rounded-lg bg-amber-50/80 p-3">
                  <select
                    className={compactSelectClass}
                    value={row.funeralRelationship}
                    onChange={(event) =>
                      updateRequestRow(row.id, {
                        funeralRelationship: event.target.value,
                      })
                    }
                  >
                    <option value="">請選擇與亡者關係</option>
                    {funeralRelationshipOptions.map(({ value, label }) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      className={compactInputClass}
                      value={row.deceasedName}
                      placeholder="亡者姓名"
                      onChange={(event) =>
                        updateRequestRow(row.id, {
                          deceasedName: event.target.value,
                        })
                      }
                    />
                    <input
                      className={compactInputClass}
                      type="date"
                      value={row.deceasedDate}
                      onChange={(event) =>
                        updateRequestRow(row.id, {
                          deceasedDate: event.target.value,
                        })
                      }
                    />
                  </div>
                  {rowFuneralRule ? (
                    <div className="text-xs text-amber-800">
                      法定上限：{rowFuneralRule.days} 天（
                      {rowFuneralRule.days * 8} 小時）
                    </div>
                  ) : null}
                </div>
              ) : null}

              {row.documents.map((document, documentIndex) => (
                <div
                  key={`${row.id}-${documentIndex}`}
                  className="space-y-2 rounded-lg border border-white/30 bg-white/40 p-2"
                >
                  <input
                    className={compactInputClass}
                    value={document.fileName || ""}
                    placeholder="附件名稱"
                    onChange={(event) =>
                      updateRowDocument(
                        row.id,
                        documentIndex,
                        "fileName",
                        event.target.value,
                      )
                    }
                  />
                  <div className="grid grid-cols-[1fr_auto] gap-2">
                    <input
                      className={compactInputClass}
                      value={document.fileUrl || ""}
                      placeholder="附件連結（選填）"
                      onChange={(event) =>
                        updateRowDocument(
                          row.id,
                          documentIndex,
                          "fileUrl",
                          event.target.value,
                        )
                      }
                    />
                    <button
                      type="button"
                      className="rounded-xl border border-rose-200 bg-rose-50 px-3 text-rose-600 transition hover:bg-rose-100"
                      onClick={() => removeRowDocument(row.id, documentIndex)}
                    >
                      <DeleteOutlined />
                    </button>
                  </div>
                </div>
              ))}

              <button
                type="button"
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/30 bg-white/60 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-white"
                onClick={() => addRowDocument(row.id)}
              >
                <PaperClipOutlined />
                新增附件
              </button>
            </div>
          </details>
        </td>
        <td className="w-[90px] px-3 py-4 text-center">
          <button
            type="button"
            className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-rose-600 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={requestRows.length <= 1}
            onClick={() => removeRequestRow(row.id)}
            title="移除這列"
          >
            <DeleteOutlined />
          </button>
        </td>
      </tr>
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="space-y-8"
    >
      {/* Header */}
      <div className="flex flex-wrap justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 mb-1">
            請假管理
          </h1>
          <p className="text-slate-500 text-sm">
            {canCreateForEmployees
              ? "替員工建立請假申請，並查看對應假單紀錄與剩餘額度"
              : "查看您的假單紀錄與剩餘額度"}
          </p>
        </div>
        <GlassButton
          onClick={() => {
            resetForm();
            setRequestRows([createLeaveRequestDraft()]);
            setIsModalVisible(true);
          }}
          className="flex items-center gap-2"
          disabled={
            (!canCreateForEmployees && employeeLinkMissing) ||
            (canCreateForEmployees && employees.length === 0)
          }
        >
          <PlusOutlined />
          <span>新增請假申請</span>
        </GlassButton>
      </div>

      {!canCreateForEmployees && employeeLinkMissing ? (
        <Alert
          type="warning"
          showIcon
          message="目前登入帳號尚未綁定員工資料"
          description="請到「考勤後臺 > 員工與部門」將這個登入帳號綁定到對應員工後，才能使用請假額度與請假申請功能。"
        />
      ) : null}

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <GlassCard className="relative overflow-hidden group h-full">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <CalendarOutlined className="text-6xl text-blue-500" />
          </div>
          <div className="text-sm text-slate-500 mb-2 font-medium">
            特休剩餘
          </div>
          <div className="text-3xl font-semibold text-slate-800 mb-1">
            {annualRemainingHours !== undefined
              ? formatHours(annualRemainingHours)
              : "--"}
          </div>
          <div className="text-xs text-slate-400">
            {canCreateForEmployees
              ? "全部員工當年度特休剩餘合計"
              : annualBalance
                ? `有效期至 ${dayjs(annualBalance.periodEnd).format("YYYY/MM/DD")}`
                : "尚未建立年度額度"}
          </div>
        </GlassCard>

        <GlassCard className="relative overflow-hidden group h-full">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <CheckCircleOutlined className="text-6xl text-green-500" />
          </div>
          <div className="text-sm text-slate-500 mb-2 font-medium">
            本年度已休
          </div>
          <div className="text-3xl font-semibold text-slate-800 mb-1">
            {formatHours(usedHours)}
          </div>
          <div className="text-xs text-slate-400">
            依核准後的年度額度即時更新
          </div>
        </GlassCard>

        <GlassCard className="relative overflow-hidden group h-full">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <ClockCircleOutlined className="text-6xl text-orange-500" />
          </div>
          <div className="text-sm text-slate-500 mb-2 font-medium">
            待核准假單
          </div>
          <div className="text-3xl font-semibold text-slate-800 mb-1">
            {requests.filter((r) => r.status === LeaveStatus.SUBMITTED).length}
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
                {canCreateForEmployees ? (
                  <th className="p-4 font-medium">員工</th>
                ) : null}
                <th className="p-4 font-medium">假別</th>
                <th className="p-4 font-medium">期間</th>
                <th className="p-4 font-medium">時數</th>
                <th className="p-4 font-medium">原因</th>
                <th className="p-4 font-medium">狀態</th>
              </tr>
            </thead>
            <tbody className="text-slate-700">
              {requests.map((request) => (
                <tr
                  key={request.id}
                  className="border-b border-white/10 hover:bg-white/10 transition-colors"
                >
                  {canCreateForEmployees ? (
                    <td className="p-4">
                      <div className="font-medium text-slate-800">
                        {(request as any).employee?.name || "-"}
                      </div>
                      <div className="text-xs text-slate-400">
                        {(request as any).employee?.department?.name || ""}
                      </div>
                    </td>
                  ) : null}
                  <td className="p-4">
                    <span className="font-medium text-slate-800">
                      {request.leaveType?.name || "未知"}
                    </span>
                  </td>
                  <td className="p-4">
                    <div className="flex flex-col text-sm">
                      <span>
                        {dayjs(request.startAt).format("YYYY-MM-DD HH:mm")}
                      </span>
                      <span className="text-slate-400 text-xs">至</span>
                      <span>
                        {dayjs(request.endAt).format("YYYY-MM-DD HH:mm")}
                      </span>
                    </div>
                  </td>
                  <td className="p-4 font-mono">{request.hours}</td>
                  <td className="p-4 max-w-xs truncate text-slate-500">
                    {request.reason}
                  </td>
                  <td className="p-4">{getStatusTag(request.status)}</td>
                </tr>
              ))}
              {requests.length === 0 && (
                <tr>
                  <td
                    colSpan={canCreateForEmployees ? 6 : 5}
                    className="p-8 text-center text-slate-400"
                  >
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
        maxWidth={
          canCreateForEmployees
            ? "max-w-[calc(100vw-1.5rem)] 2xl:max-w-[1280px]"
            : undefined
        }
        footer={
          <>
            <GlassButton
              variant="secondary"
              onClick={() => setIsModalVisible(false)}
            >
              取消
            </GlassButton>
            <GlassButton
              variant="primary"
              onClick={handleSubmit}
              isLoading={loading}
            >
              送出申請
            </GlassButton>
          </>
        }
      >
        <div className="space-y-8">
          {canCreateForEmployees ? (
            <div className="space-y-4">
              <div className="rounded-2xl border border-sky-100/70 bg-sky-50/70 px-4 py-3 text-sm leading-6 text-sky-800">
                每一列會建立一張單日假單。請先選日期，系統會依該日期篩出仍在任職期間的員工；請假長度直接填小時即可。
              </div>
              <div className="max-w-full overflow-x-auto rounded-2xl border border-white/20 bg-white/10">
                <table className="min-w-[900px] w-full border-collapse text-left">
                  <thead>
                    <tr className="border-b border-white/20 bg-white/30 text-sm text-slate-500">
                      <th className="px-3 py-3 text-center font-medium">#</th>
                      <th className="px-3 py-3 font-medium">日期</th>
                      <th className="px-3 py-3 font-medium">員工</th>
                      <th className="px-3 py-3 font-medium">假別</th>
                      <th className="px-3 py-3 font-medium">時數</th>
                      <th className="px-3 py-3 font-medium">原因 / 地點</th>
                      <th className="px-3 py-3 font-medium">附件 / 細節</th>
                      <th className="px-3 py-3 text-center font-medium">
                        操作
                      </th>
                    </tr>
                  </thead>
                  <tbody>{requestRows.map(renderRequestRow)}</tbody>
                </table>
              </div>
              <GlassButton
                variant="secondary"
                className="gap-2"
                onClick={addRequestRow}
              >
                <PlusOutlined />
                新增一列
              </GlassButton>
            </div>
          ) : (
            <>
              <GlassSelect
                label="假別"
                name="leaveTypeId"
                value={formData.leaveTypeId}
                onChange={handleInputChange}
                options={[
                  { value: "", label: "請選擇假別" },
                  ...availableLeaveTypes.map((t) => ({
                    value: t.id,
                    label: t.name,
                  })),
                ]}
              />

              {selectedLeaveType && (
                <div className="rounded-2xl border border-white/20 bg-white/20 p-4 text-sm text-slate-600">
                  <div className="font-medium text-slate-800 mb-1">
                    {selectedLeaveType.name}
                  </div>
                  <div>
                    支薪比例：{selectedLeaveType.paidPercentage ?? 100}%
                    {selectedLeaveBalance
                      ? `，剩餘額度：${formatHours(selectedLeaveBalance.remainingHours)}`
                      : "，此假別不追蹤年度額度"}
                  </div>
                  <div className="mt-2 text-xs text-slate-500">
                    最低提前時數：{selectedLeaveType.minNoticeHours ?? 0} 小時
                    {selectedLeaveType.requiresDocument
                      ? "，此假別需附件"
                      : "，此假別免附件"}
                  </div>
                  {selectedLeaveType.documentExamples ? (
                    <div className="mt-1 text-xs text-slate-500">
                      附件參考：{selectedLeaveType.documentExamples}
                    </div>
                  ) : null}
                </div>
              )}

              {selectedLeaveTypeIsFuneral ? (
                <div className="space-y-4 rounded-2xl border border-amber-200/60 bg-amber-50/70 p-4">
                  <div>
                    <div className="text-sm font-semibold text-amber-900">
                      喪假法定額度
                    </div>
                    <div className="mt-1 text-xs leading-5 text-amber-800">
                      請選擇與亡者關係，系統會自動套用 8 / 6 / 3
                      天上限；同一喪亡事件可分次申請，附件可使用訃聞或死亡證明。
                    </div>
                  </div>
                  <GlassSelect
                    label="與亡者關係"
                    name="funeralRelationship"
                    value={formData.funeralRelationship}
                    onChange={handleInputChange}
                    options={[
                      { value: "", label: "請選擇關係" },
                      ...funeralRelationshipOptions.map(({ value, label }) => ({
                        value,
                        label,
                      })),
                    ]}
                  />
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <GlassInput
                      label="亡者姓名"
                      name="deceasedName"
                      value={formData.deceasedName}
                      onChange={handleInputChange}
                      placeholder="用於同一事件分次累計"
                    />
                    <GlassInput
                      label="死亡日期"
                      type="date"
                      name="deceasedDate"
                      value={formData.deceasedDate}
                      onChange={handleInputChange}
                    />
                  </div>
                  {selectedFuneralRule ? (
                    <div className="rounded-xl bg-white/70 px-4 py-3 text-sm text-amber-900">
                      本次事件法定上限：{selectedFuneralRule.days} 天（
                      {selectedFuneralRule.days * 8}{" "}
                      小時）。若分次申請，系統會以「關係 + 亡者姓名 +
                      死亡日期」累計。
                    </div>
                  ) : null}
                </div>
              ) : null}

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

              <div className="space-y-3 rounded-2xl border border-white/20 bg-white/10 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium text-slate-800">
                      附件資料
                    </div>
                    <div className="text-xs text-slate-500">
                      若假別需要附件，至少新增一筆附件名稱；若已有雲端檔案連結，也可以一併填入。
                    </div>
                  </div>
                  <GlassButton
                    variant="secondary"
                    className="flex items-center gap-2 px-4 py-2 text-sm"
                    onClick={addDocument}
                  >
                    <PaperClipOutlined />
                    新增附件
                  </GlassButton>
                </div>

                {selectedLeaveType?.requiresDocument &&
                formData.documents.length === 0 ? (
                  <Alert
                    type="warning"
                    showIcon
                    message="此假別送出前需要附件"
                    description="至少新增一筆附件名稱；若尚未上傳正式檔案，可先填附件名稱與說明連結。"
                  />
                ) : null}

                {formData.documents.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-white/30 px-4 py-6 text-center text-sm text-slate-400">
                    尚未新增附件
                  </div>
                ) : null}

                {formData.documents.map((document, index) => (
                  <div
                    key={`${document.fileName}-${index}`}
                    className="grid grid-cols-1 gap-3 rounded-xl border border-white/20 bg-white/20 p-4"
                  >
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <GlassInput
                        label="附件名稱"
                        value={document.fileName || ""}
                        onChange={(event) =>
                          handleDocumentChange(
                            index,
                            "fileName",
                            event.target.value,
                          )
                        }
                        placeholder="例如：診斷證明、婚假證明"
                      />
                      <GlassInput
                        label="附件類型"
                        value={document.docType || ""}
                        onChange={(event) =>
                          handleDocumentChange(
                            index,
                            "docType",
                            event.target.value,
                          )
                        }
                        placeholder="例如：medical_note"
                      />
                    </div>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto]">
                      <GlassInput
                        label="附件連結（選填）"
                        value={document.fileUrl || ""}
                        onChange={(event) =>
                          handleDocumentChange(
                            index,
                            "fileUrl",
                            event.target.value,
                          )
                        }
                        placeholder="例如：https://drive.google.com/..."
                      />
                      <div className="flex items-end">
                        <GlassButton
                          variant="danger"
                          className="flex items-center gap-2 px-4 py-3 text-sm"
                          onClick={() => removeDocument(index)}
                        >
                          <DeleteOutlined />
                          刪除
                        </GlassButton>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </GlassModal>
    </motion.div>
  );
};

export default LeaveRequestPage;
