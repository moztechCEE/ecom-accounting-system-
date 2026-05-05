import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Result,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
  Tooltip,
} from 'antd'
import { 
  UserOutlined, 
  SafetyCertificateOutlined, 
  KeyOutlined, 
  PlusOutlined, 
  EditOutlined, 
  DeleteOutlined,
  SettingOutlined,
  SearchOutlined
} from '@ant-design/icons'
import { motion } from 'framer-motion'
import { useAuth } from '../contexts/AuthContext'
import { usersService, CreateUserPayload, UpdateUserPayload } from '../services/users.service'
import { rolesService, CreateRolePayload, UpdateRolePayload } from '../services/roles.service'
import { permissionsService } from '../services/permissions.service'
import { ManagedUser, PaginatedResult, Permission, Role, RolePermissionLink, UserRoleLink } from '../types'
import { GlassCard } from '../components/ui/GlassCard'
import { GlassButton } from '../components/ui/GlassButton'
import { getResourceName, getActionName, getRoleName } from '../constants/translations'
import { hasPermission, isAdminUser } from '../utils/access'

type TableColumn<T> = {
  title: React.ReactNode
  dataIndex?: string
  key: string
  render?: (value: any, record: T) => React.ReactNode
  width?: string | number
  align?: 'left' | 'center' | 'right'
}

type SimplePagination = {
  current?: number
}

const { Title, Text } = Typography

type UsersTabProps = {
  availableRoles: Role[]
}

type RolesTabProps = {
  roles: Role[]
  permissions: Permission[]
  loadingRoles: boolean
  loadingPermissions: boolean
  reloadRoles: () => Promise<void>
  reloadPermissions: () => Promise<void>
}

type PermissionsTabProps = {
  permissions: Permission[]
  loading: boolean
  reloadPermissions: () => Promise<void>
  reloadRoles: () => Promise<void>
}

const getErrorMessage = (error: unknown): string => {
  if (error && typeof error === 'object') {
    const withResponse = error as { response?: { data?: { message?: string } } }
    const responseMessage = withResponse.response?.data?.message
    if (typeof responseMessage === 'string' && responseMessage.trim()) {
      return responseMessage
    }

    const withMessage = error as { message?: string }
    if (typeof withMessage.message === 'string' && withMessage.message.trim()) {
      return withMessage.message
    }
  }

  return '操作失敗，請稍後再試'
}

const UsersTab = ({ availableRoles }: UsersTabProps) => {
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [meta, setMeta] = useState<PaginatedResult<ManagedUser>['meta']>({
    total: 0,
    page: 1,
    limit: 25,
    totalPages: 1,
  })
  const [loading, setLoading] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [assignOpen, setAssignOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [selectedUser, setSelectedUser] = useState<ManagedUser | null>(null)

  const [createForm] = Form.useForm<CreateUserPayload>()
  const [assignForm] = Form.useForm<{ roleIds: string[] }>()
  const [editForm] = Form.useForm<UpdateUserPayload & { password?: string }>()

  const fetchUsers = useCallback(
    async (page = 1, limit = meta.limit) => {
      setLoading(true)
      try {
        const result = await usersService.list(page, limit)
        setUsers(result.items)
        setMeta(result.meta)
      } catch (error) {
        message.error(getErrorMessage(error))
      } finally {
        setLoading(false)
      }
    },
    [meta.limit],
  )

  useEffect(() => {
    fetchUsers()
  }, [fetchUsers])

  const handleCreate = async () => {
    try {
      const values = await createForm.validateFields()
      await usersService.create(values)
      message.success('使用者建立成功')
      setCreateOpen(false)
      createForm.resetFields()
      fetchUsers(meta.page)
    } catch (error) {
      if (error instanceof Error && 'errorFields' in error) {
        return
      }
      message.error(getErrorMessage(error))
    }
  }

  const handleAssignRoles = async () => {
    if (!selectedUser) return
    try {
      const values = await assignForm.validateFields()
      await usersService.setRoles(selectedUser.id, values.roleIds ?? [])
      message.success('角色已更新')
      setAssignOpen(false)
      fetchUsers(meta.page)
    } catch (error) {
      if (error instanceof Error && 'errorFields' in error) {
        return
      }
      message.error(getErrorMessage(error))
    }
  }

  const handleEditUser = async () => {
    if (!selectedUser) return
    try {
      const values = await editForm.validateFields()
      const payload: UpdateUserPayload = {
        name: values.name,
        isActive: values.isActive,
      }

      if (values.password) {
        payload.password = values.password
      }

      await usersService.update(selectedUser.id, payload)
      message.success('使用者資料已更新')
      setEditOpen(false)
      fetchUsers(meta.page)
    } catch (error) {
      if (error instanceof Error && 'errorFields' in error) {
        return
      }
      message.error(getErrorMessage(error))
    }
  }

  const toggleActive = async (record: ManagedUser, isActive: boolean) => {
    try {
      await usersService.update(record.id, { isActive })
      message.success(isActive ? '使用者已啟用' : '使用者已停用')
      fetchUsers(meta.page)
    } catch (error) {
      message.error(getErrorMessage(error))
    }
  }

  const columns: TableColumn<ManagedUser>[] = [
    { title: '姓名', dataIndex: 'name', key: 'name' },
    { title: '電子郵件', dataIndex: 'email', key: 'email' },
    {
      title: '角色',
      key: 'roles',
      render: (_value: any, record: ManagedUser) => (
        <Space wrap>
          {record.roles?.map((userRole: UserRoleLink) => (
            <Tag key={userRole.roleId} color="blue">
              {userRole.role?.name || getRoleName(userRole.role?.code || '')}
            </Tag>
          ))}
        </Space>
      ),
    },
    {
      title: '狀態',
      dataIndex: 'isActive',
      key: 'status',
      render: (_value: any, record: ManagedUser) => (
        <Tag color={record.isActive ? 'green' : 'red'}>{record.isActive ? '啟用' : '停用'}</Tag>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      render: (_value: any, record: ManagedUser) => (
        <Space size="small">
          <Tooltip title="設定角色">
            <Button
              type="text"
              icon={<SettingOutlined />}
              onClick={() => {
                setSelectedUser(record)
                assignForm.setFieldsValue({
                  roleIds: record.roles?.map((link: UserRoleLink) => link.roleId) || [],
                })
                setAssignOpen(true)
              }}
            />
          </Tooltip>
          <Tooltip title="編輯">
            <Button
              type="text"
              icon={<EditOutlined />}
              onClick={() => {
                setSelectedUser(record)
                editForm.setFieldsValue({
                  name: record.name,
                  isActive: record.isActive,
                  password: undefined,
                })
                setEditOpen(true)
              }}
            />
          </Tooltip>
          {record.isActive ? (
            <Popconfirm
              title="確認停用此使用者？"
              onConfirm={() => toggleActive(record, false)}
            >
              <Tooltip title="停用">
                <Button type="text" danger icon={<DeleteOutlined />} />
              </Tooltip>
            </Popconfirm>
          ) : (
            <Button type="text" onClick={() => toggleActive(record, true)}>
              啟用
            </Button>
          )}
        </Space>
      ),
    },
  ]

  return (
    <GlassCard className="p-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
        <div>
          <Title level={4} className="!mb-1 !font-light">
            使用者管理
          </Title>
          <Text className="text-gray-500">新增、停用或調整使用者角色</Text>
        </div>
        <GlassButton variant="primary" onClick={() => setCreateOpen(true)}>
          <PlusOutlined className="mr-2" />
          新增使用者
        </GlassButton>
      </div>

      <Table
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={users}
        scroll={{ x: 800 }}
        pagination={{
          current: meta.page,
          pageSize: meta.limit,
          total: meta.total,
          showSizeChanger: false,
          className: 'p-4'
        }}
        onChange={(pagination: any) => {
          const currentPage = pagination.current ?? 1
          fetchUsers(currentPage)
        }}
        className="custom-table"
      />

      <Modal
        title="新增使用者"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={handleCreate}
        destroyOnClose
        okText="建立"
        width={500}
      >
        <Form layout="vertical" form={createForm} initialValues={{ roleIds: [] }} className="pt-4">
          <div className="bg-gray-50 p-4 rounded-lg mb-4 border border-gray-100">
            <Form.Item name="name" label="姓名" rules={[{ required: true, message: '請輸入姓名' }]}>
              <Input placeholder="輸入使用者姓名" className="rounded-md" />
            </Form.Item>
            <Form.Item
              name="email"
              label="電子郵件"
              rules={[{ required: true, message: '請輸入電子郵件' }, { type: 'email', message: '電子郵件格式不正確' }]}
            >
              <Input placeholder="例如 user@example.com" className="rounded-md" />
            </Form.Item>
            <Form.Item
              name="password"
              label="初始密碼"
              rules={[{ required: true, message: '請輸入密碼' }, { min: 8, message: '密碼至少 8 碼' }]}
            >
              <Input.Password placeholder="至少 8 碼" autoComplete="new-password" className="rounded-md" />
            </Form.Item>
          </div>
          <div className="bg-gray-50 p-4 rounded-lg border border-gray-100">
            <Form.Item name="roleIds" label="指派角色" className="mb-0">
              <Select
                mode="multiple"
                placeholder="選擇角色"
                options={availableRoles.map((role: Role) => ({
                  label: role.name || getRoleName(role.code),
                  value: role.id,
                }))}
                allowClear
                className="rounded-md"
              />
            </Form.Item>
          </div>
        </Form>
      </Modal>

      <Modal
        title="設定角色"
        open={assignOpen}
        onCancel={() => setAssignOpen(false)}
        onOk={handleAssignRoles}
        okText="儲存"
        width={500}
      >
        <Form form={assignForm} layout="vertical" className="pt-4">
          <div className="bg-gray-50 p-4 rounded-lg border border-gray-100">
            <Form.Item name="roleIds" label="角色" className="mb-0">
              <Select
                mode="multiple"
                placeholder="選擇角色"
                options={availableRoles.map((role: Role) => ({
                  label: role.name || getRoleName(role.code),
                  value: role.id,
                }))}
                className="rounded-md"
              />
            </Form.Item>
          </div>
        </Form>
      </Modal>

      <Modal
        title="編輯使用者"
        open={editOpen}
        onCancel={() => setEditOpen(false)}
        onOk={handleEditUser}
        okText="儲存"
        width={500}
      >
        <Form form={editForm} layout="vertical" className="pt-4">
          <div className="bg-gray-50 p-4 rounded-lg mb-4 border border-gray-100">
            <Form.Item name="name" label="姓名" rules={[{ required: true, message: '請輸入姓名' }]}>
              <Input className="rounded-md" />
            </Form.Item>
            <Form.Item name="isActive" label="帳號狀態" valuePropName="checked" className="mb-0">
              <Switch checkedChildren="啟用" unCheckedChildren="停用" />
            </Form.Item>
          </div>
          <div className="bg-gray-50 p-4 rounded-lg border border-gray-100">
            <Form.Item
              name="password"
              label="重設密碼"
              rules={[{ min: 8, message: '密碼至少 8 碼' }]}
              extra="若不需變更密碼，請留白"
              className="mb-0"
            >
              <Input.Password autoComplete="new-password" className="rounded-md" />
            </Form.Item>
          </div>
        </Form>
      </Modal>
    </GlassCard>
  )
}

const RolesTab = ({
  roles,
  permissions,
  loadingRoles,
  loadingPermissions,
  reloadRoles,
  reloadPermissions,
}: RolesTabProps) => {
  const [createOpen, setCreateOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [permissionOpen, setPermissionOpen] = useState(false)
  const [selectedRole, setSelectedRole] = useState<Role | null>(null)

  const [createForm] = Form.useForm<CreateRolePayload>()
  const [editForm] = Form.useForm<UpdateRolePayload>()
  const [permissionsForm] = Form.useForm<{ permissionIds: string[] }>()

  const handleCreate = async () => {
    try {
      const values = await createForm.validateFields()
      await rolesService.create(values)
      message.success('角色建立成功')
      setCreateOpen(false)
      createForm.resetFields()
      await reloadRoles()
    } catch (error) {
      if (error instanceof Error && 'errorFields' in error) {
        return
      }
      message.error(getErrorMessage(error))
    }
  }

  const handleUpdate = async () => {
    if (!selectedRole) return
    try {
      const values = await editForm.validateFields()
      await rolesService.update(selectedRole.id, values)
      message.success('角色已更新')
      setEditOpen(false)
      await reloadRoles()
    } catch (error) {
      if (error instanceof Error && 'errorFields' in error) {
        return
      }
      message.error(getErrorMessage(error))
    }
  }

  const handleDelete = async (role: Role) => {
    try {
      await rolesService.remove(role.id)
      message.success('角色已刪除')
      await reloadRoles()
    } catch (error) {
      message.error(getErrorMessage(error))
    }
  }

  const handleSetPermissions = async () => {
    if (!selectedRole) return
    try {
      const values = await permissionsForm.validateFields()
      await rolesService.setPermissions(selectedRole.id, values.permissionIds ?? [])
      message.success('角色權限已更新')
      setPermissionOpen(false)
      await reloadRoles()
    } catch (error) {
      if (error instanceof Error && 'errorFields' in error) {
        return
      }
      message.error(getErrorMessage(error))
    }
  }

  const permissionOptions = useMemo(
    () =>
      permissions.map((permission: Permission) => ({
        label: `${getResourceName(permission.resource)} : ${getActionName(permission.action)}`,
        value: permission.id,
      })),
    [permissions],
  )

  const columns: TableColumn<Role>[] = [
    { 
      title: '代碼', 
      dataIndex: 'code', 
      key: 'code',
      render: (value: string) => <Text code>{value}</Text>
    },
    { 
      title: '名稱', 
      dataIndex: 'name', 
      key: 'name',
      render: (value: string, record: Role) => (
        <span className="font-medium">{value || getRoleName(record.code)}</span>
      )
    },
    {
      title: '階層',
      dataIndex: 'hierarchyLevel',
      key: 'hierarchyLevel',
      render: (value: any) => (typeof value === 'number' ? <Tag>{value}</Tag> : '—'),
    },
    {
      title: '權限數量',
      key: 'permissionCount',
      render: (_value: any, record: Role) => (
        <Tag color="blue">{record.permissions?.length ?? 0}</Tag>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      render: (_value: any, record: Role) => (
        <Space size="small">
          <Tooltip title="編輯">
            <Button
              type="text"
              icon={<EditOutlined />}
              onClick={() => {
                setSelectedRole(record)
                editForm.setFieldsValue({
                  code: record.code,
                  name: record.name,
                  description: record.description,
                  hierarchyLevel: record.hierarchyLevel,
                })
                setEditOpen(true)
              }}
            />
          </Tooltip>
          <Tooltip title="設定權限">
            <Button
              type="text"
              icon={<SettingOutlined />}
              onClick={() => {
                setSelectedRole(record)
                permissionsForm.setFieldsValue({
                  permissionIds:
                    record.permissions?.map((item: RolePermissionLink) => item.permissionId) || [],
                })
                setPermissionOpen(true)
              }}
            />
          </Tooltip>
          <Popconfirm
            title="確認刪除此角色？"
            onConfirm={() => handleDelete(record)
            }
            disabled={record.code === 'SUPER_ADMIN'}
          >
            <Tooltip title="刪除">
              <Button type="text" danger disabled={record.code === 'SUPER_ADMIN'} icon={<DeleteOutlined />} />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <GlassCard className="p-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
        <div>
          <Title level={4} className="!mb-1 !font-light">
            角色管理
          </Title>
          <Text className="text-gray-500">建立角色並維護對應權限</Text>
        </div>
        <GlassButton variant="primary" onClick={() => setCreateOpen(true)}>
          <PlusOutlined className="mr-2" />
          新增角色
        </GlassButton>
      </div>

      <Table
        rowKey="id"
        columns={columns}
        dataSource={roles}
        loading={loadingRoles}
        scroll={{ x: 800 }}
        pagination={false}
        className="custom-table"
      />

      <Modal
        title="新增角色"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={handleCreate}
        okText="建立"
        width={500}
      >
        <Form layout="vertical" form={createForm} className="pt-4">
          <div className="bg-gray-50 p-4 rounded-lg mb-4 border border-gray-100">
            <Form.Item
              name="code"
              label="角色代碼"
              rules={[{ required: true, message: '請輸入角色代碼' }, { pattern: /^[A-Z_]+$/, message: '僅允許大寫英文字與底線' }]}
            >
              <Input placeholder="例如 FINANCE_ADMIN" className="rounded-md" />
            </Form.Item>
            <Form.Item name="name" label="角色名稱" rules={[{ required: true, message: '請輸入角色名稱' }]}>
              <Input placeholder="顯示名稱" className="rounded-md" />
            </Form.Item>
          </div>
          <div className="bg-gray-50 p-4 rounded-lg border border-gray-100">
            <Form.Item name="description" label="描述">
              <Input.TextArea rows={3} placeholder="簡短說明" className="rounded-md" />
            </Form.Item>
            <Form.Item name="hierarchyLevel" label="階層 (數字愈小代表權限愈高)" className="mb-0">
              <InputNumber min={1} style={{ width: '100%' }} placeholder="預設為 3" className="rounded-md" />
            </Form.Item>
          </div>
        </Form>
      </Modal>

      <Modal
        title="編輯角色"
        open={editOpen}
        onCancel={() => setEditOpen(false)}
        onOk={handleUpdate}
        okText="儲存"
        width={500}
      >
        <Form layout="vertical" form={editForm} className="pt-4">
          <div className="bg-gray-50 p-4 rounded-lg mb-4 border border-gray-100">
            <Form.Item
              name="code"
              label="角色代碼"
              rules={[{ required: true, message: '請輸入角色代碼' }, { pattern: /^[A-Z_]+$/, message: '僅允許大寫英文字與底線' }]}
            >
              <Input className="rounded-md" />
            </Form.Item>
            <Form.Item name="name" label="角色名稱" rules={[{ required: true, message: '請輸入角色名稱' }]}>
              <Input className="rounded-md" />
            </Form.Item>
          </div>
          <div className="bg-gray-50 p-4 rounded-lg border border-gray-100">
            <Form.Item name="description" label="描述">
              <Input.TextArea rows={3} className="rounded-md" />
            </Form.Item>
            <Form.Item name="hierarchyLevel" label="階層" className="mb-0">
              <InputNumber min={1} style={{ width: '100%' }} placeholder="預設為 3" className="rounded-md" />
            </Form.Item>
          </div>
        </Form>
      </Modal>

      <Modal
        title="設定角色權限"
        open={permissionOpen}
        onCancel={() => setPermissionOpen(false)}
        onOk={handleSetPermissions}
        okText="儲存"
        confirmLoading={loadingPermissions}
        width={600}
      >
        <Form form={permissionsForm} layout="vertical" className="pt-4">
          <div className="bg-gray-50 p-4 rounded-lg border border-gray-100">
            <Form.Item name="permissionIds" label="權限列表" className="mb-0">
              <Select
                mode="multiple"
                placeholder="選擇權限"
                options={permissionOptions}
                loading={loadingPermissions}
                className="rounded-md"
                style={{ width: '100%' }}
              />
            </Form.Item>
          </div>
        </Form>
      </Modal>
    </GlassCard>
  )
}

const PermissionsTab = ({
  permissions,
  loading,
  reloadPermissions,
  reloadRoles,
}: PermissionsTabProps) => {
  const [createOpen, setCreateOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [selectedPermission, setSelectedPermission] = useState<Permission | null>(null)

  const [createForm] = Form.useForm<{ resource: string; action: string; description?: string }>()
  const [editForm] = Form.useForm<{ resource?: string; action?: string; description?: string }>()

  const handleCreate = async () => {
    try {
      const values = await createForm.validateFields()
      await permissionsService.create(values)
      message.success('權限建立成功')
      setCreateOpen(false)
      createForm.resetFields()
      await reloadPermissions()
      await reloadRoles()
    } catch (error) {
      if (error instanceof Error && 'errorFields' in error) {
        return
      }
      message.error(getErrorMessage(error))
    }
  }

  const handleUpdate = async () => {
    if (!selectedPermission) return
    try {
      const values = await editForm.validateFields()
      await permissionsService.update(selectedPermission.id, values)
      message.success('權限已更新')
      setEditOpen(false)
      await reloadPermissions()
      await reloadRoles()
    } catch (error) {
      if (error instanceof Error && 'errorFields' in error) {
        return
      }
      message.error(getErrorMessage(error))
    }
  }

  const handleDelete = async (record: Permission) => {
    try {
      await permissionsService.remove(record.id)
      message.success('權限已刪除')
      await reloadPermissions()
      await reloadRoles()
    } catch (error) {
      message.error(getErrorMessage(error))
    }
  }

  const columns: TableColumn<Permission>[] = [
    { 
      title: '資源', 
      dataIndex: 'resource', 
      key: 'resource',
      render: (value: string) => (
        <Space>
          <span className="font-medium">{getResourceName(value)}</span>
          <Text type="secondary" className="text-xs">({value})</Text>
        </Space>
      )
    },
    { 
      title: '操作', 
      dataIndex: 'action', 
      key: 'action',
      render: (value: string) => (
        <Tag color="blue">{getActionName(value)}</Tag>
      )
    },
    { title: '描述', dataIndex: 'description', key: 'description' },
    {
      title: '操作',
      key: 'actions',
      render: (_value: any, record: Permission) => (
        <Space size="small">
          <Tooltip title="編輯">
            <Button
              type="text"
              icon={<EditOutlined />}
              onClick={() => {
                setSelectedPermission(record)
                editForm.setFieldsValue({
                  resource: record.resource,
                  action: record.action,
                  description: record.description,
                })
                setEditOpen(true)
              }}
            />
          </Tooltip>
          <Popconfirm title="確認刪除此權限？" onConfirm={() => handleDelete(record)}>
            <Tooltip title="刪除">
              <Button type="text" danger icon={<DeleteOutlined />} />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <GlassCard className="p-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
        <div>
          <Title level={4} className="!mb-1 !font-light">
            權限管理
          </Title>
          <Text className="text-gray-500">維護資源／操作清單</Text>
        </div>
        <GlassButton variant="primary" onClick={() => setCreateOpen(true)}>
          <PlusOutlined className="mr-2" />
          新增權限
        </GlassButton>
      </div>
      <Table
        rowKey="id"
        columns={columns}
        dataSource={permissions}
        loading={loading}
        scroll={{ x: 800 }}
        pagination={false}
        className="custom-table"
      />

      <Modal
        title="新增權限"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={handleCreate}
        okText="建立"
        width={500}
      >
        <Form layout="vertical" form={createForm} className="pt-4">
          <div className="bg-gray-50 p-4 rounded-lg mb-4 border border-gray-100">
            <Form.Item name="resource" label="資源" rules={[{ required: true, message: '請輸入資源名稱' }]}>
              <Input placeholder="例如 users" className="rounded-md" />
            </Form.Item>
            <Form.Item name="action" label="操作" rules={[{ required: true, message: '請輸入操作名稱' }]}>
              <Input placeholder="例如 create" className="rounded-md" />
            </Form.Item>
          </div>
          <div className="bg-gray-50 p-4 rounded-lg border border-gray-100">
            <Form.Item name="description" label="描述" className="mb-0">
              <Input.TextArea rows={3} placeholder="可選" className="rounded-md" />
            </Form.Item>
          </div>
        </Form>
      </Modal>

      <Modal
        title="編輯權限"
        open={editOpen}
        onCancel={() => setEditOpen(false)}
        onOk={handleUpdate}
        okText="儲存"
        width={500}
      >
        <Form layout="vertical" form={editForm} className="pt-4">
          <div className="bg-gray-50 p-4 rounded-lg mb-4 border border-gray-100">
            <Form.Item name="resource" label="資源" rules={[{ required: true, message: '請輸入資源名稱' }]}>
              <Input className="rounded-md" />
            </Form.Item>
            <Form.Item name="action" label="操作" rules={[{ required: true, message: '請輸入操作名稱' }]}>
              <Input className="rounded-md" />
            </Form.Item>
          </div>
          <div className="bg-gray-50 p-4 rounded-lg border border-gray-100">
            <Form.Item name="description" label="描述" className="mb-0">
              <Input.TextArea rows={3} className="rounded-md" />
            </Form.Item>
          </div>
        </Form>
      </Modal>
    </GlassCard>
  )
}

const AccessControlPage: React.FC = () => {
  const { user } = useAuth()
  const canAccessControl =
    isAdminUser(user) ||
    hasPermission(user, 'access_control:read') ||
    hasPermission(user, 'access_control:update')

  const [roles, setRoles] = useState<Role[]>([])
  const [permissions, setPermissions] = useState<Permission[]>([])
  const [loadingRoles, setLoadingRoles] = useState(false)
  const [loadingPermissions, setLoadingPermissions] = useState(false)

  const loadRoles = useCallback(async () => {
    setLoadingRoles(true)
    try {
      const data = await rolesService.list()
      setRoles(data)
    } catch (error) {
      message.error(getErrorMessage(error))
    } finally {
      setLoadingRoles(false)
    }
  }, [])

  const loadPermissions = useCallback(async () => {
    setLoadingPermissions(true)
    try {
      const data = await permissionsService.list()
      setPermissions(data)
    } catch (error) {
      message.error(getErrorMessage(error))
    } finally {
      setLoadingPermissions(false)
    }
  }, [])

  useEffect(() => {
    if (canAccessControl) {
      loadRoles()
      loadPermissions()
    }
  }, [canAccessControl, loadRoles, loadPermissions])

  if (!canAccessControl) {
    return (
      <Result
        status="403"
        title="沒有權限"
        subTitle="請聯絡系統管理員以取得帳號／權限。"
      />
    )
  }

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="space-y-8"
    >
      <div>
        <Title level={2} className="!mb-1 !font-light">帳號與權限管理</Title>
        <Text className="text-gray-500">管理系統使用者、角色與權限設定</Text>
      </div>

      <Tabs
        defaultActiveKey="users"
        type="card"
        className="custom-tabs"
        items={[
          {
            key: 'users',
            label: (
              <span>
                <UserOutlined />
                使用者
              </span>
            ),
            children: <UsersTab availableRoles={roles} />,
          },
          {
            key: 'roles',
            label: (
              <span>
                <SafetyCertificateOutlined />
                角色
              </span>
            ),
            children: (
              <RolesTab
                roles={roles}
                permissions={permissions}
                loadingRoles={loadingRoles}
                loadingPermissions={loadingPermissions}
                reloadRoles={loadRoles}
                reloadPermissions={loadPermissions}
              />
            ),
          },
          {
            key: 'permissions',
            label: (
              <span>
                <KeyOutlined />
                權限
              </span>
            ),
            children: (
              <PermissionsTab
                permissions={permissions}
                loading={loadingPermissions}
                reloadPermissions={loadPermissions}
                reloadRoles={loadRoles}
              />
            ),
          },
        ]}
      />
    </motion.div>
  )
}

export default AccessControlPage
