import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from "antd";
import {
  ApartmentOutlined,
  CalendarOutlined,
  EditOutlined,
  PlusOutlined,
  SettingOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { motion } from "framer-motion";
import dayjs from "dayjs";
import { useNavigate } from "react-router-dom";
import { attendanceService } from "../services/attendance.service";
import { payrollService } from "../services/payroll.service";
import { usersService } from "../services/users.service";
import { useAuth } from "../contexts/AuthContext";
import { Department, Employee, ManagedUser } from "../types";
import { AdminLeaveBalance, LeaveType } from "../types/attendance";

const { Title, Text } = Typography;

const getErrorMessage = (error: unknown, fallback: string) => {
  const messageFromResponse =
    typeof error === "object" &&
    error !== null &&
    "response" in error &&
    typeof (error as any).response?.data?.message === "string"
      ? (error as any).response.data.message
      : Array.isArray((error as any)?.response?.data?.message)
        ? (error as any).response.data.message.join(" ")
        : null;

  const messageFromError =
    error instanceof Error && error.message ? error.message : null;

  return messageFromResponse || messageFromError || fallback;
};

const formatHoursAsDays = (hours?: number) => {
  if (hours === undefined || hours === null) {
    return "-";
  }

  if (hours % 8 === 0) {
    return `${hours / 8} 天`;
  }

  return `${hours} 小時`;
};

const EmployeesTab = ({ departments }: { departments: Department[] }) => {
  const { user } = useAuth();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [usersLoading, setUsersLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(
    null,
  );
  const [form] = Form.useForm();

  const fetchEmployees = async () => {
    setLoading(true);
    try {
      const result = await payrollService.getEmployees();
      setEmployees(result.items);
    } catch (error) {
      message.error(getErrorMessage(error, "載入員工失敗"));
    } finally {
      setLoading(false);
    }
  };

  const fetchUsers = async () => {
    setUsersLoading(true);
    try {
      const result = await usersService.list(1, 100);
      setUsers(result.items.filter((item) => item.isActive));
    } catch (error) {
      setUsers([]);
      message.error(getErrorMessage(error, "載入使用者失敗"));
    } finally {
      setUsersLoading(false);
    }
  };

  useEffect(() => {
    void fetchEmployees();
    void fetchUsers();
  }, []);

  const handleCreate = async () => {
    try {
      const values = await form.validateFields();
      await payrollService.createEmployee({
        ...values,
        hireDate: values.hireDate.toISOString(),
      });
      message.success("員工建立成功");
      setCreateOpen(false);
      form.resetFields();
      void fetchEmployees();
    } catch (error) {
      if ((error as any)?.errorFields) {
        return;
      }

      message.error(getErrorMessage(error, "員工建立失敗"));
    }
  };

  const handleUpdate = async () => {
    if (!selectedEmployee) {
      return;
    }

    try {
      const values = await form.validateFields();
      await payrollService.updateEmployee(selectedEmployee.id, {
        ...values,
        hireDate: values.hireDate ? values.hireDate.toISOString() : undefined,
        terminateDate: values.terminateDate
          ? values.terminateDate.toISOString()
          : null,
      });
      message.success("員工更新成功");
      setEditOpen(false);
      form.resetFields();
      void fetchEmployees();
    } catch (error) {
      if ((error as any)?.errorFields) {
        return;
      }

      message.error(getErrorMessage(error, "員工更新失敗"));
    }
  };

  const columns = [
    { title: "員工編號", dataIndex: "employeeNo", key: "employeeNo" },
    { title: "姓名", dataIndex: "name", key: "name" },
    {
      title: "登入帳號",
      dataIndex: "user",
      key: "user",
      render: (linkedUser: Employee["user"]) =>
        linkedUser ? (
          <div className="flex flex-col">
            <span>{linkedUser.name}</span>
            <span className="text-xs text-gray-400">
              {linkedUser.email || "-"}
            </span>
          </div>
        ) : (
          <Tag color="default">未綁定</Tag>
        ),
    },
    {
      title: "部門",
      dataIndex: "departmentId",
      key: "department",
      render: (deptId: string) =>
        departments.find((department) => department.id === deptId)?.name || "-",
    },
    {
      title: "本薪",
      dataIndex: "salaryBaseOriginal",
      key: "salaryBaseOriginal",
      render: (salary: number) => salary.toLocaleString(),
    },
    {
      title: "到職日",
      dataIndex: "hireDate",
      key: "hireDate",
      render: (date: string) => dayjs(date).format("YYYY-MM-DD"),
    },
    {
      title: "狀態",
      dataIndex: "isActive",
      key: "isActive",
      render: (isActive: boolean) => (
        <Tag color={isActive ? "green" : "red"}>
          {isActive ? "在職" : "離職"}
        </Tag>
      ),
    },
    {
      title: "操作",
      key: "actions",
      render: (_: unknown, record: Employee) => (
        <Space size="small">
          <Button
            type="text"
            icon={<EditOutlined />}
            onClick={() => {
              setSelectedEmployee(record);
              form.setFieldsValue({
                ...record,
                hireDate: dayjs(record.hireDate),
              });
              setEditOpen(true);
            }}
          >
            編輯
          </Button>
        </Space>
      ),
    },
  ];

  const currentUserEmployee = user
    ? employees.find((employee) => employee.userId === user.id)
    : null;

  const availableUserOptions = users.map((item) => ({
    label: `${item.name} (${item.email})`,
    value: item.id,
  }));

  return (
    <div className="glass-card p-6">
      {!currentUserEmployee && user ? (
        <Alert
          type="warning"
          showIcon
          className="mb-6"
          message="目前登入帳號尚未綁定員工資料"
          description="這會讓「我的請假」、「我的薪資單」、「打卡儀表板」等員工頁面看起來像沒功能。請在員工資料中把對應使用者綁上去。"
        />
      ) : null}

      <div className="flex justify-between items-center mb-6">
        <Title level={4} className="!mb-0 !font-light">
          員工名單
        </Title>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => {
            form.resetFields();
            setCreateOpen(true);
          }}
        >
          新增員工
        </Button>
      </div>

      <Table
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={employees}
        scroll={{ x: 1000 }}
      />

      <Modal
        title="新增員工"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => void handleCreate()}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="employeeNo"
            label="員工編號"
            rules={[{ required: true }]}
          >
            <Input />
          </Form.Item>
          <Form.Item name="name" label="姓名" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="userId" label="綁定登入帳號">
            <Select
              allowClear
              loading={usersLoading}
              showSearch
              optionFilterProp="label"
              options={availableUserOptions}
              placeholder="選擇要綁定的使用者"
            />
          </Form.Item>
          <Form.Item name="departmentId" label="部門">
            <Select
              allowClear
              options={departments.map((department) => ({
                label: department.name,
                value: department.id,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="hireDate"
            label="到職日"
            rules={[{ required: true }]}
          >
            <DatePicker className="w-full" />
          </Form.Item>
          <Form.Item
            name="salaryBaseOriginal"
            label="本薪"
            rules={[{ required: true }]}
          >
            <InputNumber className="w-full" min={0} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="編輯員工"
        open={editOpen}
        onCancel={() => setEditOpen(false)}
        onOk={() => void handleUpdate()}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="姓名" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="userId" label="綁定登入帳號">
            <Select
              allowClear
              loading={usersLoading}
              showSearch
              optionFilterProp="label"
              options={availableUserOptions}
              placeholder="選擇要綁定的使用者"
            />
          </Form.Item>
          <Form.Item name="departmentId" label="部門">
            <Select
              allowClear
              options={departments.map((department) => ({
                label: department.name,
                value: department.id,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="hireDate"
            label="到職日"
            rules={[{ required: true }]}
          >
            <DatePicker className="w-full" />
          </Form.Item>
          <Form.Item
            name="salaryBaseOriginal"
            label="本薪"
            rules={[{ required: true }]}
          >
            <InputNumber className="w-full" min={0} />
          </Form.Item>
          <Form.Item name="isActive" label="狀態" valuePropName="checked">
            <Switch checkedChildren="在職" unCheckedChildren="離職" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

const DepartmentsTab = ({
  departments,
  reload,
}: {
  departments: Department[];
  reload: () => void;
}) => {
  const [createOpen, setCreateOpen] = useState(false);
  const [form] = Form.useForm();

  const handleCreate = async () => {
    try {
      const values = await form.validateFields();
      await payrollService.createDepartment(values);
      message.success("部門建立成功");
      setCreateOpen(false);
      form.resetFields();
      reload();
    } catch (error) {
      if ((error as any)?.errorFields) {
        return;
      }

      message.error(getErrorMessage(error, "部門建立失敗"));
    }
  };

  const columns = [
    { title: "部門名稱", dataIndex: "name", key: "name" },
    { title: "成本中心代碼", dataIndex: "costCenterId", key: "costCenterId" },
    {
      title: "狀態",
      dataIndex: "isActive",
      key: "isActive",
      render: (isActive: boolean) => (
        <Tag color={isActive ? "green" : "red"}>
          {isActive ? "啟用" : "停用"}
        </Tag>
      ),
    },
  ];

  return (
    <div className="glass-card p-6">
      <div className="flex justify-between items-center mb-6">
        <Title level={4} className="!mb-0 !font-light">
          部門管理
        </Title>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setCreateOpen(true)}
        >
          新增部門
        </Button>
      </div>

      <Table
        rowKey="id"
        columns={columns}
        dataSource={departments}
        scroll={{ x: 800 }}
      />

      <Modal
        title="新增部門"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => void handleCreate()}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="部門名稱" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="costCenterId" label="成本中心代碼">
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

const LeaveTypesTab = () => {
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingLeaveType, setEditingLeaveType] = useState<LeaveType | null>(
    null,
  );
  const [form] = Form.useForm();

  const fetchLeaveTypes = async () => {
    setLoading(true);
    try {
      const data = await attendanceService.getAdminLeaveTypes();
      setLeaveTypes(data);
    } catch (error) {
      message.error(getErrorMessage(error, "載入假別規則失敗"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchLeaveTypes();
  }, []);

  const openCreate = () => {
    setEditingLeaveType(null);
    form.resetFields();
    form.setFieldsValue({
      balanceResetPolicy: "CALENDAR_YEAR",
      paidPercentage: 100,
      minNoticeHours: 0,
      requiresDocument: false,
      allowCarryOver: false,
      carryOverLimitHours: 0,
    });
    setModalOpen(true);
  };

  const openEdit = (leaveType: LeaveType) => {
    setEditingLeaveType(leaveType);
    form.setFieldsValue({
      ...leaveType,
      maxDaysPerYear: leaveType.maxDaysPerYear ?? null,
      paidPercentage: leaveType.paidPercentage ?? 100,
      minNoticeHours: leaveType.minNoticeHours ?? 0,
      requiresDocument: Boolean(leaveType.requiresDocument),
      allowCarryOver: Boolean(leaveType.allowCarryOver),
      carryOverLimitHours: leaveType.carryOverLimitHours ?? 0,
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      const payload = {
        code: values.code,
        name: values.name,
        balanceResetPolicy: values.balanceResetPolicy,
        maxDaysPerYear:
          values.maxDaysPerYear === null || values.maxDaysPerYear === undefined
            ? undefined
            : Number(values.maxDaysPerYear),
        paidPercentage:
          values.paidPercentage === null || values.paidPercentage === undefined
            ? undefined
            : Number(values.paidPercentage),
        minNoticeHours:
          values.minNoticeHours === null || values.minNoticeHours === undefined
            ? undefined
            : Number(values.minNoticeHours),
        requiresDocument: Boolean(values.requiresDocument),
        allowCarryOver: Boolean(values.allowCarryOver),
        carryOverLimitHours:
          values.carryOverLimitHours === null ||
          values.carryOverLimitHours === undefined
            ? undefined
            : Number(values.carryOverLimitHours),
      };

      if (editingLeaveType) {
        await attendanceService.updateLeaveType(editingLeaveType.id, payload);
        message.success("假別規則更新成功");
      } else {
        await attendanceService.createLeaveType(payload);
        message.success("假別規則建立成功");
      }

      setModalOpen(false);
      form.resetFields();
      void fetchLeaveTypes();
    } catch (error) {
      if ((error as any)?.errorFields) {
        return;
      }

      message.error(getErrorMessage(error, "儲存假別規則失敗"));
    }
  };

  const columns = [
    {
      title: "假別",
      key: "name",
      render: (_: unknown, record: LeaveType) => (
        <div className="flex flex-col">
          <span className="font-medium">{record.name}</span>
          <span className="text-xs text-gray-400">{record.code}</span>
        </div>
      ),
    },
    {
      title: "重算方式",
      dataIndex: "balanceResetPolicy",
      key: "balanceResetPolicy",
      render: (value?: string) => {
        const mapping: Record<string, string> = {
          CALENDAR_YEAR: "曆年制",
          HIRE_ANNIVERSARY: "到職週年制",
          NONE: "不建年度額度",
        };
        return mapping[value || "CALENDAR_YEAR"] || value || "-";
      },
    },
    {
      title: "年度額度",
      dataIndex: "maxDaysPerYear",
      key: "maxDaysPerYear",
      render: (value?: number) => (value !== undefined ? `${value} 天` : "依規則"),
    },
    {
      title: "支薪比例",
      dataIndex: "paidPercentage",
      key: "paidPercentage",
      render: (value?: number) => `${value ?? 100}%`,
    },
    {
      title: "附件 / 結轉",
      key: "settings",
      render: (_: unknown, record: LeaveType) => (
        <Space wrap>
          <Tag color={record.requiresDocument ? "gold" : "default"}>
            {record.requiresDocument ? "需附件" : "免附件"}
          </Tag>
          <Tag color={record.allowCarryOver ? "blue" : "default"}>
            {record.allowCarryOver
              ? `可結轉 ${record.carryOverLimitHours ?? 0} 小時`
              : "不結轉"}
          </Tag>
        </Space>
      ),
    },
    {
      title: "操作",
      key: "actions",
      render: (_: unknown, record: LeaveType) => (
        <Button
          type="text"
          icon={<EditOutlined />}
          onClick={() => openEdit(record)}
        >
          編輯
        </Button>
      ),
    },
  ];

  return (
    <div className="glass-card p-6">
      <Alert
        type="info"
        showIcon
        className="mb-6"
        message="假別規則會直接影響請假申請與薪資扣款"
        description="你現在可以直接在這裡新增假別，例如特休、病假、事假，並設定年度額度、支薪比例、附件與結轉規則。"
      />

      <div className="flex justify-between items-center mb-6">
        <Title level={4} className="!mb-0 !font-light">
          假別規則
        </Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          新增假別
        </Button>
      </div>

      <Table
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={leaveTypes}
        scroll={{ x: 1100 }}
      />

      <Modal
        title={editingLeaveType ? "編輯假別規則" : "新增假別規則"}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => void handleSave()}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="code"
            label="假別代碼"
            rules={[{ required: true, message: "請輸入假別代碼" }]}
          >
            <Input placeholder="例如 ANNUAL / SICK / PERSONAL" />
          </Form.Item>
          <Form.Item
            name="name"
            label="假別名稱"
            rules={[{ required: true, message: "請輸入假別名稱" }]}
          >
            <Input placeholder="例如 特休 / 病假 / 事假" />
          </Form.Item>
          <Form.Item
            name="balanceResetPolicy"
            label="年度重算方式"
            rules={[{ required: true }]}
          >
            <Select
              options={[
                { label: "曆年制", value: "CALENDAR_YEAR" },
                { label: "到職週年制", value: "HIRE_ANNIVERSARY" },
                { label: "不建年度額度", value: "NONE" },
              ]}
            />
          </Form.Item>
          <Form.Item name="maxDaysPerYear" label="年度額度（天）">
            <InputNumber className="w-full" min={0} />
          </Form.Item>
          <Form.Item name="paidPercentage" label="支薪比例（%）">
            <InputNumber className="w-full" min={0} max={100} />
          </Form.Item>
          <Form.Item name="minNoticeHours" label="最低提前時數">
            <InputNumber className="w-full" min={0} />
          </Form.Item>
          <Form.Item
            name="carryOverLimitHours"
            label="結轉上限（小時）"
          >
            <InputNumber className="w-full" min={0} />
          </Form.Item>
          <Form.Item
            name="requiresDocument"
            label="是否需要附件"
            valuePropName="checked"
          >
            <Switch checkedChildren="需要" unCheckedChildren="不需要" />
          </Form.Item>
          <Form.Item
            name="allowCarryOver"
            label="是否可結轉"
            valuePropName="checked"
          >
            <Switch checkedChildren="可結轉" unCheckedChildren="不可結轉" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

const LeaveBalancesTab = () => {
  const [balances, setBalances] = useState<AdminLeaveBalance[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedYear, setSelectedYear] = useState(dayjs().year());
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>();
  const [selectedLeaveTypeId, setSelectedLeaveTypeId] = useState<string>();
  const [editingBalance, setEditingBalance] =
    useState<AdminLeaveBalance | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [form] = Form.useForm();

  const loadReferenceData = async () => {
    try {
      const [employeeResult, leaveTypeResult] = await Promise.all([
        payrollService.getEmployees(),
        attendanceService.getAdminLeaveTypes(),
      ]);
      setEmployees(employeeResult.items);
      setLeaveTypes(leaveTypeResult);
    } catch (error) {
      message.error(getErrorMessage(error, "載入額度參考資料失敗"));
    }
  };

  const loadBalances = async () => {
    setLoading(true);
    try {
      const result = await attendanceService.getAdminLeaveBalances({
        year: selectedYear,
        employeeId: selectedEmployeeId || undefined,
        leaveTypeId: selectedLeaveTypeId || undefined,
      });
      setBalances(result);
    } catch (error) {
      message.error(getErrorMessage(error, "載入年度額度失敗"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadReferenceData();
  }, []);

  useEffect(() => {
    void loadBalances();
  }, [selectedYear, selectedEmployeeId, selectedLeaveTypeId]);

  const employeeOptions = useMemo(
    () =>
      employees.map((employee) => ({
        label: `${employee.name} (${employee.employeeNo})`,
        value: employee.id,
      })),
    [employees],
  );

  const leaveTypeOptions = useMemo(
    () =>
      leaveTypes.map((leaveType) => ({
        label: `${leaveType.name} (${leaveType.code})`,
        value: leaveType.id,
      })),
    [leaveTypes],
  );

  const openEditor = (balance: AdminLeaveBalance) => {
    setEditingBalance(balance);
    form.setFieldsValue({
      accruedHours: balance.accruedHours,
      carryOverHours: balance.carryOverHours,
      manualAdjustmentHours: balance.manualAdjustmentHours,
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!editingBalance) {
      return;
    }

    try {
      const values = await form.validateFields();
      await attendanceService.adjustLeaveBalance(editingBalance.id, {
        accruedHours: Number(values.accruedHours),
        carryOverHours: Number(values.carryOverHours),
        manualAdjustmentHours: Number(values.manualAdjustmentHours),
      });
      message.success("年度額度更新成功");
      setModalOpen(false);
      void loadBalances();
    } catch (error) {
      if ((error as any)?.errorFields) {
        return;
      }

      message.error(getErrorMessage(error, "更新年度額度失敗"));
    }
  };

  const columns = [
    {
      title: "員工",
      key: "employee",
      render: (_: unknown, record: AdminLeaveBalance) => (
        <div className="flex flex-col">
          <span className="font-medium">{record.employee.name}</span>
          <span className="text-xs text-gray-400">
            {record.employee.department?.name || "未分配部門"}
          </span>
        </div>
      ),
    },
    {
      title: "假別",
      key: "leaveType",
      render: (_: unknown, record: AdminLeaveBalance) => (
        <div className="flex flex-col">
          <span>{record.leaveType.name}</span>
          <span className="text-xs text-gray-400">{record.leaveType.code}</span>
        </div>
      ),
    },
    {
      title: "週期",
      key: "period",
      render: (_: unknown, record: AdminLeaveBalance) =>
        `${dayjs(record.periodStart).format("YYYY-MM-DD")} ~ ${dayjs(record.periodEnd).format("YYYY-MM-DD")}`,
    },
    {
      title: "應得",
      dataIndex: "accruedHours",
      key: "accruedHours",
      render: (value: number) => formatHoursAsDays(value),
    },
    {
      title: "已用",
      dataIndex: "usedHours",
      key: "usedHours",
      render: (value: number) => formatHoursAsDays(value),
    },
    {
      title: "待核",
      dataIndex: "pendingHours",
      key: "pendingHours",
      render: (value: number) => formatHoursAsDays(value),
    },
    {
      title: "剩餘",
      dataIndex: "remainingHours",
      key: "remainingHours",
      render: (value: number) => (
        <span className="font-medium">{formatHoursAsDays(value)}</span>
      ),
    },
    {
      title: "操作",
      key: "actions",
      render: (_: unknown, record: AdminLeaveBalance) => (
        <Button
          type="text"
          icon={<EditOutlined />}
          onClick={() => openEditor(record)}
        >
          調整額度
        </Button>
      ),
    },
  ];

  return (
    <div className="glass-card p-6">
      <Alert
        type="info"
        showIcon
        className="mb-6"
        message="年度額度會在薪資計算時參與請假扣款邏輯"
        description="新增員工後，如果要立即補發特休、補登結轉或人工修正額度，現在可以直接在這個頁籤完成。"
      />

      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <Title level={4} className="!mb-0 !font-light">
          年度額度管理
        </Title>

        <Space wrap>
          <InputNumber
            min={2020}
            max={2100}
            value={selectedYear}
            onChange={(value) => setSelectedYear(Number(value || dayjs().year()))}
            placeholder="年度"
          />
          <Select
            allowClear
            className="min-w-[220px]"
            placeholder="篩選員工"
            options={employeeOptions}
            value={selectedEmployeeId}
            onChange={(value) => setSelectedEmployeeId(value)}
          />
          <Select
            allowClear
            className="min-w-[220px]"
            placeholder="篩選假別"
            options={leaveTypeOptions}
            value={selectedLeaveTypeId}
            onChange={(value) => setSelectedLeaveTypeId(value)}
          />
        </Space>
      </div>

      <Table
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={balances}
        scroll={{ x: 1200 }}
      />

      <Modal
        title="調整年度額度"
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => void handleSave()}
      >
        {editingBalance ? (
          <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
            <div className="font-medium text-slate-900">
              {editingBalance.employee.name} / {editingBalance.leaveType.name}
            </div>
            <div className="mt-1">
              週期 {dayjs(editingBalance.periodStart).format("YYYY-MM-DD")} ~{" "}
              {dayjs(editingBalance.periodEnd).format("YYYY-MM-DD")}
            </div>
          </div>
        ) : null}

        <Form form={form} layout="vertical">
          <Form.Item
            name="accruedHours"
            label="應得額度（小時）"
            rules={[{ required: true }]}
          >
            <InputNumber className="w-full" min={0} />
          </Form.Item>
          <Form.Item
            name="carryOverHours"
            label="結轉額度（小時）"
            rules={[{ required: true }]}
          >
            <InputNumber className="w-full" min={0} />
          </Form.Item>
          <Form.Item
            name="manualAdjustmentHours"
            label="人工補正（小時）"
            rules={[{ required: true }]}
          >
            <InputNumber className="w-full" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

const EmployeesPage: React.FC = () => {
  const navigate = useNavigate();
  const [departments, setDepartments] = useState<Department[]>([]);

  const fetchDepartments = async () => {
    try {
      const data = await payrollService.getDepartments();
      setDepartments(data);
    } catch (error) {
      setDepartments([]);
      message.error(getErrorMessage(error, "載入部門失敗"));
    }
  };

  useEffect(() => {
    void fetchDepartments();
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="space-y-6"
    >
      <div>
        <Title level={2} className="!mb-1 !font-light">
          員工與部門管理
        </Title>
        <Text className="text-gray-500">
          現在這一頁已經整合員工、部門、假別規則與年度額度，不用再分散到不同頁面才能接著管理。
        </Text>
      </div>

      <Alert
        type="info"
        showIcon
        message="建議操作順序：先建立部門，再新增員工並綁定登入帳號，接著設定假別規則與年度額度。"
        action={
          <Button size="small" onClick={() => navigate("/attendance/admin")}>
            開啟完整考勤後台
          </Button>
        }
      />

      <Tabs
        defaultActiveKey="employees"
        type="card"
        className="custom-tabs"
        items={[
          {
            key: "employees",
            label: (
              <span>
                <UserOutlined />
                員工名單
              </span>
            ),
            children: <EmployeesTab departments={departments} />,
          },
          {
            key: "departments",
            label: (
              <span>
                <ApartmentOutlined />
                部門管理
              </span>
            ),
            children: (
              <DepartmentsTab
                departments={departments}
                reload={fetchDepartments}
              />
            ),
          },
          {
            key: "leave-types",
            label: (
              <span>
                <SettingOutlined />
                假別規則
              </span>
            ),
            children: <LeaveTypesTab />,
          },
          {
            key: "leave-balances",
            label: (
              <span>
                <CalendarOutlined />
                年度額度
              </span>
            ),
            children: <LeaveBalancesTab />,
          },
        ]}
      />
    </motion.div>
  );
};

export default EmployeesPage;
