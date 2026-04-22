import React, { useState, useEffect } from "react";
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

const LeaveRequestPage: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [leaveBalances, setLeaveBalances] = useState<LeaveBalance[]>([]);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [employeeLinkMissing, setEmployeeLinkMissing] = useState(false);

  // Form State
  const [formData, setFormData] = useState({
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

  const handleSubmit = async () => {
    try {
      setLoading(true);

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

  const annualBalance =
    leaveBalances.find((balance) => balance.leaveType.code === "ANNUAL") ||
    leaveBalances[0];
  const usedHours = leaveBalances.reduce(
    (sum, balance) => sum + balance.usedHours,
    0,
  );
  const selectedLeaveType = leaveTypes.find(
    (type) => type.id === formData.leaveTypeId,
  );
  const selectedLeaveBalance = leaveBalances.find(
    (balance) => balance.leaveType.id === formData.leaveTypeId,
  );
  const selectedLeaveTypeIsFuneral = isFuneralLeaveType(selectedLeaveType);
  const selectedFuneralRule = funeralRelationshipOptions.find(
    (option) => option.value === formData.funeralRelationship,
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
          <h1 className="text-2xl font-semibold text-slate-900 mb-1">
            請假管理
          </h1>
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

      {employeeLinkMissing ? (
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
            {annualBalance ? formatHours(annualBalance.remainingHours) : "--"}
          </div>
          <div className="text-xs text-slate-400">
            {annualBalance
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
        <div className="space-y-6">
          <GlassSelect
            label="假別"
            name="leaveTypeId"
            value={formData.leaveTypeId}
            onChange={handleInputChange}
            options={[
              { value: "", label: "請選擇假別" },
              ...leaveTypes.map((t) => ({ value: t.id, label: t.name })),
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
                      handleDocumentChange(index, "docType", event.target.value)
                    }
                    placeholder="例如：medical_note"
                  />
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto]">
                  <GlassInput
                    label="附件連結（選填）"
                    value={document.fileUrl || ""}
                    onChange={(event) =>
                      handleDocumentChange(index, "fileUrl", event.target.value)
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
        </div>
      </GlassModal>
    </motion.div>
  );
};

export default LeaveRequestPage;
