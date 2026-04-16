import React, { useEffect, useState } from "react";
import {
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
  DatePicker,
} from "antd";
import {
  UserOutlined,
  ApartmentOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
} from "@ant-design/icons";
import { motion } from "framer-motion";
import dayjs from "dayjs";
import { payrollService } from "../services/payroll.service";
import { Employee, Department, PaginatedResult } from "../types";

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

const EmployeesTab = ({ departments }: { departments: Department[] }) => {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(false);
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
      message.error("載入員工失敗");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEmployees();
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
      fetchEmployees();
    } catch (error) {
      if ((error as any)?.errorFields) {
        return;
      }

      message.error(getErrorMessage(error, "員工建立失敗"));
    }
  };

  const handleUpdate = async () => {
    if (!selectedEmployee) return;
    try {
      const values = await form.validateFields();
      await payrollService.updateEmployee(selectedEmployee.id, {
        ...values,
        hireDate: values.hireDate ? values.hireDate.toISOString() : undefined,
      });
      message.success("員工更新成功");
      setEditOpen(false);
      form.resetFields();
      fetchEmployees();
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
      title: "部門",
      dataIndex: "departmentId",
      key: "department",
      render: (deptId: string) =>
        departments.find((d) => d.id === deptId)?.name || "-",
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
      render: (_: any, record: Employee) => (
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

  return (
    <div className="glass-card p-6">
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
        scroll={{ x: 800 }}
      />

      <Modal
        title="新增員工"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={handleCreate}
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
          <Form.Item name="departmentId" label="部門">
            <Select
              options={departments.map((d) => ({ label: d.name, value: d.id }))}
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
            <InputNumber className="w-full" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="編輯員工"
        open={editOpen}
        onCancel={() => setEditOpen(false)}
        onOk={handleUpdate}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="姓名" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="departmentId" label="部門">
            <Select
              options={departments.map((d) => ({ label: d.name, value: d.id }))}
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
            <InputNumber className="w-full" />
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
        onOk={handleCreate}
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

const EmployeesPage: React.FC = () => {
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
    fetchDepartments();
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
        <Text className="text-gray-500">維護組織架構與人員資料</Text>
      </div>

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
        ]}
      />
    </motion.div>
  );
};

export default EmployeesPage;
