import WarehouseIdentityButton from '../components/WarehouseIdentityButton'
import { wmsPortalOrigin } from '../config/wms-portal'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Alert,
  Button,
  Drawer,
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
  EyeInvisibleOutlined,
  EyeOutlined,
  DownOutlined,
  UpOutlined,
} from '@ant-design/icons'
import { motion } from 'framer-motion'
import { useAuth } from '../contexts/AuthContext'
import {
  usersService,
  CreateUserPayload,
  UpdateUserPayload,
} from '../services/users.service'
import {
  rolesService,
  CreateRolePayload,
  UpdateRolePayload,
} from '../services/roles.service'
import { permissionsService } from '../services/permissions.service'
import { Entity, listEntities } from '../services/entities.service'
import {
  ManagedUser,
  PaginatedResult,
  Permission,
  Role,
  RolePermissionLink,
  UserRoleLink,
} from '../types'
import { GlassCard } from '../components/ui/GlassCard'
import { GlassButton } from '../components/ui/GlassButton'
import {
  getResourceName,
  getActionName,
  getRoleName,
} from '../constants/translations'
import { hasPermission, hasRole, isAdminUser } from '../utils/access'
import AccessPreview from '../components/AccessPreview'
import PermissionMatrix from '../components/PermissionMatrix'
import { isPrivilegedRole } from '../utils/access-preview'
import { getAccessControlErrorMessage as getErrorMessage } from '../utils/access-control-errors'

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
const DATA_SCOPE_OPTIONS = [
  { label: '僅自己', value: 'SELF' },
  { label: '部門', value: 'DEPARTMENT' },
  { label: '全公司', value: 'ENTITY' },
]
const DATA_SCOPE_LABEL_MAP = Object.fromEntries(
  DATA_SCOPE_OPTIONS.map((item) => [item.value, item.label]),
)
type DataScopeKey =
  | 'employeeDataScope'
  | 'attendanceDataScope'
  | 'payrollDataScope'
  | 'accountingDataScope'
  | 'inventoryDataScope'
  | 'salesDataScope'
  | 'purchasingDataScope'
  | 'bankingDataScope'

const DATA_SCOPE_FIELDS: Array<{
  key: DataScopeKey
  label: string
  shortLabel: string
  color: string
}> = [
  {
    key: 'employeeDataScope',
    label: '員工資料範圍',
    shortLabel: '員工',
    color: 'blue',
  },
  {
    key: 'attendanceDataScope',
    label: '考勤資料範圍',
    shortLabel: '考勤',
    color: 'gold',
  },
  {
    key: 'payrollDataScope',
    label: '薪資資料範圍',
    shortLabel: '薪資',
    color: 'purple',
  },
  {
    key: 'accountingDataScope',
    label: '會計資料範圍',
    shortLabel: '會計',
    color: 'cyan',
  },
  {
    key: 'inventoryDataScope',
    label: '庫存資料範圍',
    shortLabel: '庫存',
    color: 'green',
  },
  {
    key: 'salesDataScope',
    label: '銷售資料範圍',
    shortLabel: '銷售',
    color: 'magenta',
  },
  {
    key: 'purchasingDataScope',
    label: '採購資料範圍',
    shortLabel: '採購',
    color: 'volcano',
  },
  {
    key: 'bankingDataScope',
    label: '銀行資料範圍',
    shortLabel: '銀行',
    color: 'geekblue',
  },
]

const DEFAULT_DATA_SCOPE_VALUES = DATA_SCOPE_FIELDS.reduce(
  (values, field) => ({
    ...values,
    [field.key]: 'SELF',
  }),
  {} as Record<DataScopeKey, 'SELF'>,
)

const getUserDataScopeValues = (user: ManagedUser) =>
  DATA_SCOPE_FIELDS.reduce(
    (values, field) => ({
      ...values,
      [field.key]: user[field.key] || 'SELF',
    }),
    {} as Record<DataScopeKey, 'SELF' | 'DEPARTMENT' | 'ENTITY'>,
  )

const roleDisplayName = (role: Role) =>
  role.name && role.name !== role.code ? role.name : getRoleName(role.code)

const newRoleCode = () =>
  `CUSTOM_${Array.from(crypto.getRandomValues(new Uint8Array(12)), (value) => String.fromCharCode(65 + value % 26)).join('')}`

const isTestRole = (role: Role) => /^(QA_|DEV_|TEST_)/i.test(role.code)

const SENSITIVE_PERMISSION_LABELS: Record<string, string> = {
  'product_cost:read': '成本',
  'financial_margin:read': '毛利',
  'financial_net_profit:read': '淨利',
  'employee_compensation:read': '同仁薪資',
  'banking:read': '銀行資料',
}
const SENSITIVE_PERMISSION_REQUIREMENTS: Record<string, string[]> = {
  'financial_margin:read': ['product_cost:read', 'financial_margin:read'],
  'financial_net_profit:read': ['product_cost:read', 'financial_margin:read', 'financial_net_profit:read'],
}

const sensitiveLabels = (permissions: string[] = [], fullAccess = false) =>
  Object.entries(SENSITIVE_PERMISSION_LABELS)
    .filter(([key]) => fullAccess || (SENSITIVE_PERMISSION_REQUIREMENTS[key] || [key]).every((required) => permissions.includes(required)))
    .map(([, label]) => label)

const DataScopeFormGrid = () => (
  <details className="mt-5 rounded-xl border border-slate-200 bg-white p-3">
    <summary className="cursor-pointer text-sm font-semibold text-slate-700">進階：各模組資料範圍</summary>
    <Alert className="mt-3" type="info" showIcon message="這些設定只控制已支援資料範圍的作業；薪資、成本與淨利仍由獨立權限控制。" />
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {DATA_SCOPE_FIELDS.map((field) => (
        <Form.Item
          key={field.key}
          name={field.key}
          label={field.label}
          className="mb-0"
        >
          <Select options={DATA_SCOPE_OPTIONS} className="rounded-md" />
        </Form.Item>
      ))}
    </div>
  </details>
)

const CompanyAccessField = ({ entities, required = false }: { entities: Entity[]; required?: boolean }) => (
  <Form.Item name="entityIds" label="可存取公司" className="mb-0" rules={required ? [{ required: true, message: '請選擇至少一家公司' }] : undefined}>
    <Select
      mode="multiple"
      placeholder="選擇公司"
      options={entities.map((entity) => ({
        label: entity.name,
        value: entity.id,
      }))}
      optionFilterProp="label"
      className="rounded-md"
    />
  </Form.Item>
)

type UsersTabProps = {
  canManage: boolean
  availableRoles: Role[]
  canManageDataScopes: boolean
  searchKeyword: string
}

type RolesTabProps = {
  canManage: boolean
  roles: Role[]
  permissions: Permission[]
  loadingRoles: boolean
  loadingPermissions: boolean
  reloadRoles: () => Promise<void>
  reloadPermissions: () => Promise<void>
}

type PermissionsTabProps = {
  canManage: boolean
  permissions: Permission[]
  loading: boolean
  reloadPermissions: () => Promise<void>
  reloadRoles: () => Promise<void>
}

const isManagedUserSuperAdmin = (record: ManagedUser) =>
  Boolean(
    record.roles?.some(
      (link) =>
        link.role?.code === 'SUPER_ADMIN' || link.role?.name === 'SUPER_ADMIN',
    ),
  )

const isManagedUserFullAdmin = (record: ManagedUser) =>
  Boolean(record.roles?.some((link) => isPrivilegedRole(link.role)))

const UsersTab = ({
  canManage,
  availableRoles,
  canManageDataScopes,
  searchKeyword,
}: UsersTabProps) => {
  const { user: currentUser, refreshCurrentUser } = useAuth()
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [systemAdminUsers, setSystemAdminUsers] = useState<ManagedUser[]>([])
  const [meta, setMeta] = useState<PaginatedResult<ManagedUser>['meta']>({
    total: 0,
    page: 1,
    limit: 25,
    totalPages: 1,
  })
  const [loading, setLoading] = useState(false)
  const [loadingSystemAdmins, setLoadingSystemAdmins] = useState(false)
  const [showSystemAdmins, setShowSystemAdmins] = useState(false)
  const [expandedScopeRowKeys, setExpandedScopeRowKeys] = useState<React.Key[]>([])
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const createInFlight = useRef(false)
  const [assignOpen, setAssignOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [selectedUser, setSelectedUser] = useState<ManagedUser | null>(null)
  const [entities, setEntities] = useState<Entity[]>([])
  const [previewUser, setPreviewUser] = useState<ManagedUser | null>(null)
  const [searchTerm, setSearchTerm] = useState(searchKeyword)
  const [searchDraft, setSearchDraft] = useState(searchKeyword)
  const [statusFilter, setStatusFilter] = useState<'active' | 'inactive' | 'all'>('active')
  const [roleFilter, setRoleFilter] = useState<string | undefined>()
  const [entityFilter, setEntityFilter] = useState<string | undefined>()

  const [createForm] = Form.useForm<CreateUserPayload>()
  const [assignForm] = Form.useForm<{ roleIds: string[] }>()
  const [editForm] = Form.useForm<UpdateUserPayload & { password?: string }>()
  const createRoleIds = Form.useWatch('roleIds', createForm) || []
  const createEntityIds = Form.useWatch('entityIds', createForm) || []
  const assignRoleIds = Form.useWatch('roleIds', assignForm) || []
  const assignedPreviewRoles = availableRoles.filter((role) => assignRoleIds.includes(role.id))
  const assignedSensitive = sensitiveLabels(
    assignedPreviewRoles.flatMap((role) => (role.permissions || []).map((link) => `${link.permission.resource}:${link.permission.action}`)),
    assignedPreviewRoles.some(isPrivilegedRole),
  )
  const previousSensitive = sensitiveLabels(selectedUser?.effectivePermissions, selectedUser ? isManagedUserFullAdmin(selectedUser) : false)
  const assignableRoles = useMemo(
    () => availableRoles.filter((role) => role.code !== 'SUPER_ADMIN' && (canManageDataScopes || role.assignableByAccountManager === true)),
    [availableRoles, canManageDataScopes],
  )
  const roleOptions = useMemo(() => {
    const options = (roles: Role[]) => roles.map((role) => ({
      label: roleDisplayName(role),
      value: role.id,
    }))
    return [
      { label: '日常職務', options: options(assignableRoles.filter((role) => !isPrivilegedRole(role) && !isTestRole(role))) },
      { label: '特殊與測試職務（請確認用途）', options: options(assignableRoles.filter((role) => isPrivilegedRole(role) || isTestRole(role))) },
    ].filter((group) => group.options.length > 0)
  }, [assignableRoles])

  useEffect(() => {
    setSearchTerm(searchKeyword)
    setSearchDraft(searchKeyword)
  }, [searchKeyword])

  useEffect(() => {
    if (!canManage) return

    listEntities({ isActive: true })
      .then(setEntities)
      .catch((error) => message.error(getErrorMessage(error)))
  }, [canManage])

  const fetchUsers = useCallback(
    async (page = 1, limit = meta.limit) => {
      setLoading(true)
      try {
        const result = await usersService.list(page, limit, {
          systemAdmins: 'exclude',
          search: searchTerm,
          status: statusFilter,
          roleId: roleFilter,
          entityId: entityFilter,
        })
        setUsers(result.items)
        setMeta(result.meta)
      } catch (error) {
        message.error(getErrorMessage(error))
      } finally {
        setLoading(false)
      }
    },
    [meta.limit, searchTerm, statusFilter, roleFilter, entityFilter],
  )

  useEffect(() => {
    fetchUsers(1)
  }, [fetchUsers])

  const fetchSystemAdmins = useCallback(async () => {
    if (!canManageDataScopes) {
      setSystemAdminUsers([])
      return
    }

    setLoadingSystemAdmins(true)
    try {
      const result = await usersService.list(1, 50, {
        systemAdmins: 'only',
        search: searchTerm,
      })
      setSystemAdminUsers(result.items)
    } catch (error) {
      message.error(getErrorMessage(error))
      setSystemAdminUsers([])
    } finally {
      setLoadingSystemAdmins(false)
    }
  }, [canManageDataScopes, searchTerm])

  useEffect(() => {
    if (showSystemAdmins) {
      fetchSystemAdmins()
    }
  }, [fetchSystemAdmins, showSystemAdmins])

  const handleCreate = async () => {
    if (!canManage) return
    if (createInFlight.current) return
    createInFlight.current = true
    setCreating(true)
    setCreateError(null)
    try {
      const values = await createForm.validateFields()
      const payload = canManageDataScopes
        ? values
        : ({
            email: values.email,
            name: values.name,
            password: values.password,
            roleIds: values.roleIds,
          } satisfies CreateUserPayload)
      await usersService.create(payload)
      message.success('帳號已建立；請確認員工資料綁定與各模組資料範圍，才能開始使用公司資料。', 6)
      setCreateOpen(false)
      createForm.resetFields()
      fetchUsers(1)
    } catch (error) {
      if (error && typeof error === 'object' && 'errorFields' in error) {
        const fields = (error as { errorFields?: { name: string[] }[] }).errorFields
        if (fields?.[0]) createForm.scrollToField(fields[0].name)
        return
      }
      setCreateError(getErrorMessage(error))
    } finally {
      createInFlight.current = false
      setCreating(false)
    }
  }

  const handleAssignRoles = async () => {
    if (!canManage) return
    if (!selectedUser) return
    try {
      const values = await assignForm.validateFields()
      await usersService.setRoles(selectedUser.id, values.roleIds ?? [])
      if (selectedUser.id === currentUser?.id) await refreshCurrentUser()
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
    if (!canManage) return
    if (!selectedUser) return
    try {
      const values = await editForm.validateFields()
      const payload: UpdateUserPayload = {
        name: values.name,
        isActive: values.isActive,
        ...(canManageDataScopes
          ? DATA_SCOPE_FIELDS.reduce(
              (scopes, field) => ({
                ...scopes,
                [field.key]: values[field.key],
              }),
              {} as Pick<UpdateUserPayload, DataScopeKey>,
            )
          : {}),
        ...(canManageDataScopes ? { entityIds: values.entityIds ?? [] } : {}),
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
    if (!canManage) return
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
    ...(canManageDataScopes
      ? [
          {
            title: '公司',
            key: 'entities',
            render: (_value: any, record: ManagedUser) => (
              <Space wrap>
                {record.entityMemberships?.map((membership) => (
                  <Tag key={membership.entityId}>{membership.entity.name}</Tag>
                ))}
              </Space>
            ),
          },
        ]
      : []),
    {
      title: '角色',
      key: 'roles',
      render: (_value: any, record: ManagedUser) => (
        <Space wrap>
          {record.roles?.map((userRole: UserRoleLink) => (
            <Tag key={userRole.roleId} color={isPrivilegedRole(userRole.role) ? 'orange' : 'blue'}>
              {roleDisplayName(userRole.role)}
            </Tag>
          ))}
        </Space>
      ),
    },
    {
      title: '敏感資料',
      key: 'sensitive',
      render: (_value: any, record: ManagedUser) => {
        const labels = sensitiveLabels(record.effectivePermissions, isManagedUserFullAdmin(record))
        return labels.length
          ? <Space wrap>{labels.map((label) => <Tag key={label} color="orange">{label}</Tag>)}</Space>
          : <Text type="secondary">未另行開放</Text>
      },
    },
    {
      title: '部門／職責', key: 'department',
      render: (_: unknown, record: ManagedUser) => record.departmentAccess?.departmentName
        ? <Space direction="vertical" size={2}><span>{record.departmentAccess.departmentName}</span><Tag color={record.departmentAccess.isSupervisor ? 'blue' : 'default'}>{record.departmentAccess.isSupervisor ? '部門主管' : '部門人員'}</Tag></Space> : '尚未綁定員工部門',
    },
    {
      title: '狀態',
      dataIndex: 'isActive',
      key: 'status',
      render: (_value: any, record: ManagedUser) => (
        <Tag color={record.isActive ? 'green' : 'red'}>
          {record.isActive ? '啟用' : '停用'}
        </Tag>
      ),
    },
    ...(canManageDataScopes
      ? [
          {
            title: '資料範圍',
            key: 'scopeToggle',
            render: (_value: any, record: ManagedUser) => {
              const expanded = expandedScopeRowKeys.includes(record.id)
              return (
                <Button
                  type="text"
                  icon={expanded ? <UpOutlined /> : <DownOutlined />}
                  onClick={() => {
                    setExpandedScopeRowKeys((current) =>
                      expanded
                        ? current.filter((key) => key !== record.id)
                        : [...current, record.id],
                    )
                  }}
                >
                  {expanded ? '收合' : '展開'}
                </Button>
              )
            },
          },
        ]
      : []),
    {
      title: '操作',
      key: 'actions',
      render: (_value: any, record: ManagedUser) => (
        <Space size="small">
          <Button type="text" icon={<EyeOutlined />} onClick={() => setPreviewUser(record)}>查看權限</Button>
          {isManagedUserSuperAdmin(record) || (!canManageDataScopes && record.roles?.some(link => isPrivilegedRole(link.role))) ? (
            <Text type="secondary" className="text-xs">
              管理員帳號由最高管理員設定
            </Text>
          ) : canManage ? (
            <>
          {canManageDataScopes && wmsPortalOrigin() && <WarehouseIdentityButton userId={record.id} name={record.name} />}
          <Tooltip title="設定角色">
            <Button
              type="text"
              icon={<SettingOutlined />}
              onClick={() => {
                setSelectedUser(record)
                assignForm.setFieldsValue({
                  roleIds:
                    record.roles?.map((link: UserRoleLink) => link.roleId) ||
                    [],
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
                  entityIds:
                    record.entityMemberships?.map(
                      (membership) => membership.entityId,
                    ) ?? [],
                  ...getUserDataScopeValues(record),
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
            </>
          ) : <Text type="secondary">僅供查看</Text>}
        </Space>
      ),
    },
  ]

  const systemAdminColumns: TableColumn<ManagedUser>[] = [
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
        <Tag color={record.isActive ? 'green' : 'red'}>
          {record.isActive ? '啟用' : '停用'}
        </Tag>
      ),
    },
  ]

  const allUserRowKeys = useMemo(() => users.map((item) => item.id), [users])
  const allScopesExpanded =
    allUserRowKeys.length > 0 &&
    allUserRowKeys.every((key) => expandedScopeRowKeys.includes(key))
  const toggleAllScopes = () => {
    setExpandedScopeRowKeys(allScopesExpanded ? [] : allUserRowKeys)
  }
  const renderDataScopes = (record: ManagedUser) => (
    <div className="rounded-2xl border border-slate-200/70 bg-white/60 px-5 py-4">
      <div className="mb-3 text-sm font-semibold text-slate-700">
        {record.name} 的資料範圍
      </div>
      <Space wrap size={[8, 8]}>
        {DATA_SCOPE_FIELDS.map((field) => (
          <Tag key={field.key} color={field.color} className="!px-3 !py-1">
            {field.shortLabel} {DATA_SCOPE_LABEL_MAP[record[field.key] || 'SELF']}
          </Tag>
        ))}
      </Space>
    </div>
  )

  return (
    <GlassCard className="p-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
        <div>
          <Title level={4} className="!mb-1 !font-light">
            使用者管理
          </Title>
        </div>
        <GlassButton variant="primary" disabled={!canManage || (!canManageDataScopes && entities.length !== 1)} onClick={() => setCreateOpen(true)}>
          <PlusOutlined className="mr-2" />
          新增使用者
        </GlassButton>
      </div>
      {canManage && !canManageDataScopes && entities.length !== 1 &&
        <Alert className="mb-4" type="info" showIcon message="目前帳號對應零或多家公司；請由最高管理員建立帳號並指定可存取公司。" />}

      <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Input.Search
          placeholder="搜尋姓名、Email 或職務"
          value={searchDraft}
          onChange={(event) => setSearchDraft(event.target.value)}
          onSearch={(value) => setSearchTerm(value.trim())}
          allowClear
          enterButton="搜尋"
          aria-label="搜尋使用者"
        />
        <Select
          value={statusFilter}
          onChange={setStatusFilter}
          options={[{ value: 'active', label: '啟用帳號' }, { value: 'inactive', label: '停用帳號' }, { value: 'all', label: '全部帳號' }]}
          aria-label="帳號狀態"
        />
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="篩選職務範本"
          value={roleFilter}
          onChange={setRoleFilter}
          options={availableRoles.map((role) => ({ value: role.id, label: roleDisplayName(role) }))}
          aria-label="篩選職務範本"
        />
        {canManageDataScopes && <Select
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="篩選公司"
          value={entityFilter}
          onChange={setEntityFilter}
          options={entities.map((entity) => ({ value: entity.id, label: entity.name }))}
          aria-label="篩選公司"
        />}
      </div>

      {canManageDataScopes ? (
        <div className="mb-4 rounded-2xl border border-slate-200/70 bg-white/55 p-4">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
            <div className="text-sm font-semibold text-slate-800">
              資料範圍
            </div>
            <Space wrap>
              <Button
                icon={showSystemAdmins ? <EyeInvisibleOutlined /> : <EyeOutlined />}
                onClick={() => setShowSystemAdmins((current) => !current)}
              >
                {showSystemAdmins ? '隱藏最高權限帳號' : '查看最高權限帳號'}
              </Button>
              <Button
                icon={allScopesExpanded ? <UpOutlined /> : <DownOutlined />}
                onClick={toggleAllScopes}
              >
                {allScopesExpanded ? '全部收合資料範圍' : '全員展開資料範圍'}
              </Button>
            </Space>
          </div>

          {showSystemAdmins ? (
            <div className="mt-4">
              <Table
                rowKey="id"
                loading={loadingSystemAdmins}
                columns={systemAdminColumns}
                dataSource={systemAdminUsers}
                pagination={false}
                size="small"
              />
            </div>
          ) : null}
        </div>
      ) : null}

      <Table
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={users}
        scroll={{ x: 800 }}
        expandable={
          canManageDataScopes
            ? {
                expandedRowKeys: expandedScopeRowKeys,
                expandedRowRender: renderDataScopes,
                expandIcon: () => null,
                onExpandedRowsChange: (keys) => setExpandedScopeRowKeys([...keys]),
              }
            : undefined
        }
        pagination={{
          current: meta.page,
          pageSize: meta.limit,
          total: meta.total,
          showSizeChanger: false,
          className: 'p-4',
        }}
        onChange={(pagination: any) => {
          const currentPage = pagination.current ?? 1
          fetchUsers(currentPage)
        }}
        className="custom-table"
      />

      <Drawer title={`${previewUser?.name || ""} · 有效權限`} open={Boolean(previewUser)} onClose={() => setPreviewUser(null)} width={720}>
        {previewUser?.departmentAccess?.departmentName && <Alert message={`${previewUser.departmentAccess.departmentName} · ${previewUser.departmentAccess.isSupervisor ? '部門主管' : '部門人員'}`} description={`部門作業角色：${previewUser.departmentAccess.roleNames.join('、') || '基本自助功能'}`} />}
        <AccessPreview
          roles={previewUser?.roles.map(link => link.role) || []}
          permissions={previewUser?.effectivePermissions}
          actual
          serverAccess={previewUser?.effectiveAccess}
          companyNames={previewUser?.entityMemberships?.map((membership) => membership.entity.name) || []}
          departmentName={previewUser?.departmentAccess?.departmentName}
          scopeSummary={previewUser ? DATA_SCOPE_FIELDS.filter((field) => previewUser[field.key] !== 'SELF').map((field) => `${field.shortLabel}：${DATA_SCOPE_LABEL_MAP[previewUser[field.key] || 'SELF']}`) : []}
        />
      </Drawer>

      <Drawer
        title="建立帳號 · 選擇職務與資料範圍"
        open={createOpen}
        onClose={() => { if (!createInFlight.current) setCreateOpen(false) }}
        afterOpenChange={(open) => { if (open) setCreateError(null) }}
        closable={!creating}
        maskClosable={!creating}
        keyboard={!creating}
        footer={<div className="space-y-3">
            {createError && <Alert type="error" showIcon message={createError} role="alert" style={{ marginBottom: 12, textAlign: 'left' }} />}
            <div className="flex justify-end gap-2">
              <Button disabled={creating} onClick={() => setCreateOpen(false)}>取消</Button>
              <Button type="primary" loading={creating} onClick={handleCreate}>建立帳號</Button>
            </div>
          </div>}
        width={820}
      >
        <Form
          layout="vertical"
          form={createForm}
          initialValues={{
            roleIds: [],
            entityIds: [],
            ...(canManageDataScopes ? DEFAULT_DATA_SCOPE_VALUES : {}),
          }}
          className="pt-4"
        >
          <div className="bg-gray-50 p-4 rounded-lg mb-4 border border-gray-100">
            <Text strong>1. 基本資料</Text>
            <Form.Item
              name="name"
              label="姓名"
              rules={[{ required: true, message: '請輸入姓名' }]}
            >
              <Input placeholder="輸入使用者姓名" className="rounded-md" />
            </Form.Item>
            <Form.Item
              name="email"
              label="電子郵件"
              rules={[
                { required: true, message: '請輸入電子郵件' },
                { type: 'email', message: '電子郵件格式不正確' },
              ]}
            >
              <Input
                placeholder="例如 user@example.com"
                className="rounded-md"
              />
            </Form.Item>
            <Form.Item
              name="password"
              label="初始密碼"
              rules={[
                { required: true, message: '請輸入密碼' },
                { min: 8, message: '密碼至少 8 碼' },
              ]}
            >
              <Input.Password
                placeholder="至少 8 碼"
                autoComplete="new-password"
                className="rounded-md"
              />
            </Form.Item>
          </div>
          <div className="bg-gray-50 p-4 rounded-lg border border-gray-100">
            <Text strong>2. 職務與公司</Text>
            <Form.Item name="roleIds" label="職務範本" extra="建議先選一項；兼任時才增加職務。多項職務的權限會合併。" className="mb-0 mt-3" rules={[{ required: true, message: '請至少選擇一個職務範本' }]}>
              <Select
                mode="multiple"
                placeholder="選擇工作職務"
                options={roleOptions}
                allowClear
                className="rounded-md"
              />
            </Form.Item>
            {canManageDataScopes ? (
              <div className="mt-4">
                <CompanyAccessField entities={entities} required />
              </div>
            ) : <div className="mt-3 text-sm text-slate-600">公司：{entities[0]?.name || '尚未確認'}（由系統指定）</div>}
            <Alert className="mt-3" type="info" showIcon message="建立帳號後，請確認員工資料是否已綁定；僅有職務範本不代表已取得公司資料範圍。" />
            {canManageDataScopes ? <DataScopeFormGrid /> : null}
            <div className="mt-4 text-sm font-semibold text-slate-700">3. 儲存前確認</div>
            <AccessPreview
              roles={availableRoles.filter(role => createRoleIds.includes(role.id))}
              companyNames={canManageDataScopes ? entities.filter(entity => createEntityIds.includes(entity.id)).map(entity => entity.name) : entities.slice(0, 1).map(entity => entity.name)}
            />
          </div>
        </Form>
      </Drawer>

      <Drawer
        title="調整職務與可見資料"
        open={assignOpen}
        onClose={() => setAssignOpen(false)}
        footer={<div className="flex justify-end gap-2"><Button onClick={() => setAssignOpen(false)}>取消</Button><Button type="primary" onClick={handleAssignRoles}>儲存</Button></div>}
        width={720}
      >
        <Form form={assignForm} layout="vertical" className="pt-4">
          <div className="bg-gray-50 p-4 rounded-lg border border-gray-100">
            <Form.Item name="roleIds" label="職務範本" extra="多項職務的權限會合併；敏感資料請使用經核准的專用範本。" className="mb-0">
              <Select
                mode="multiple"
                placeholder="選擇工作職務"
                options={roleOptions}
                className="rounded-md"
              />
            </Form.Item>
            <Alert
              type={assignedSensitive.some((label) => !previousSensitive.includes(label)) ? 'warning' : 'info'}
              showIcon
              className="mt-4"
              message={`敏感資料變化：${assignedSensitive.filter((label) => !previousSensitive.includes(label)).map((label) => `新增 ${label}`).concat(previousSensitive.filter((label) => !assignedSensitive.includes(label)).map((label) => `移除 ${label}`)).join('、') || '沒有變化'}`}
            />
            <AccessPreview roles={assignedPreviewRoles} companyNames={selectedUser?.entityMemberships?.map((link) => link.entity.name) || []} />
          </div>
        </Form>
      </Drawer>

      <Drawer
        title="編輯使用者"
        open={editOpen}
        onClose={() => setEditOpen(false)}
        footer={<div className="flex justify-end gap-2"><Button onClick={() => setEditOpen(false)}>取消</Button><Button type="primary" onClick={handleEditUser}>儲存</Button></div>}
        width={820}
      >
        <Form form={editForm} layout="vertical" className="pt-4">
          <div className="bg-gray-50 p-4 rounded-lg mb-4 border border-gray-100">
            <Form.Item
              name="name"
              label="姓名"
              rules={[{ required: true, message: '請輸入姓名' }]}
            >
              <Input className="rounded-md" />
            </Form.Item>
            <Form.Item
              name="isActive"
              label="帳號狀態"
              valuePropName="checked"
              className="mb-0"
            >
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
              <Input.Password
                autoComplete="new-password"
                className="rounded-md"
              />
            </Form.Item>
            {canManageDataScopes ? (
              <div className="mt-4">
                <CompanyAccessField entities={entities} />
              </div>
            ) : null}
            {canManageDataScopes ? <DataScopeFormGrid /> : null}
          </div>
        </Form>
      </Drawer>
    </GlassCard>
  )
}

const RolesTab = ({
  canManage,
  roles,
  permissions,
  loadingRoles,
  loadingPermissions,
  reloadRoles,
  reloadPermissions,
}: RolesTabProps) => {
  const { refreshCurrentUser } = useAuth()
  const [createOpen, setCreateOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [permissionOpen, setPermissionOpen] = useState(false)
  const [showTestRoles, setShowTestRoles] = useState(false)
  const [selectedRole, setSelectedRole] = useState<Role | null>(null)

  const [createForm] = Form.useForm<CreateRolePayload>()
  const [editForm] = Form.useForm<UpdateRolePayload>()
  const [permissionsForm] = Form.useForm<{ permissionIds: string[] }>()

  const handleCreate = async () => {
    if (!canManage) return
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
    if (!canManage) return
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
    if (!canManage || role.deletionReason || role.code === 'SUPER_ADMIN') return
    try {
      await rolesService.remove(role.id)
      message.success('角色已刪除')
      await reloadRoles()
    } catch (error) {
      message.error(getErrorMessage(error))
    }
  }

  const handleSetPermissions = async () => {
    if (!canManage) return
    if (!selectedRole) return
    try {
      const values = await permissionsForm.validateFields()
      const selectedKeys = new Set(permissions.filter((permission) => values.permissionIds?.includes(permission.id))
        .map((permission) => `${permission.resource}:${permission.action}`))
      if (selectedKeys.has('financial_margin:read') && !selectedKeys.has('product_cost:read')) {
        message.error('開放毛利時，也要開放產品成本讀取。')
        return
      }
      if (selectedKeys.has('financial_net_profit:read') &&
        (!selectedKeys.has('financial_margin:read') || !selectedKeys.has('product_cost:read'))) {
        message.error('開放淨利時，也要開放產品成本與毛利讀取。')
        return
      }
      await rolesService.setPermissions(
        selectedRole.id,
        values.permissionIds ?? [],
      )
      await refreshCurrentUser()
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

  const selectedPermissionIds = Form.useWatch('permissionIds', permissionsForm) || []
  const selectedTemplateId = Form.useWatch('templateRoleId', createForm)
  const rolePreview = selectedRole ? { ...selectedRole, permissions: permissions.filter(p => selectedPermissionIds.includes(p.id)).map(permission => ({ roleId: selectedRole.id, permissionId: permission.id, permission })) } : null

  const columns: TableColumn<Role>[] = [
    {
      title: '職務範本',
      dataIndex: 'name',
      key: 'name',
      render: (value: string, record: Role) => (
        <Space direction="vertical" size={0}><span className="font-medium">{roleDisplayName(record)}</span>
          {record.description && <Text type="secondary" className="text-xs">{record.description}</Text>}</Space>
      ),
    },
    {
      title: '敏感資料', key: 'sensitive',
      render: (_value: any, record: Role) => {
        const labels = sensitiveLabels((record.permissions || []).map((link) => `${link.permission.resource}:${link.permission.action}`), isPrivilegedRole(record))
        return labels.length ? <Space wrap>{labels.map((label) => <Tag key={label} color="orange">{label}</Tag>)}</Space> : <Text type="secondary">未另行開放</Text>
      },
    },
    { title: '使用帳號', key: 'assignedUserCount', render: (_value: any, record: Role) => <Text>{record.assignedUserCount ?? 0} 個帳號</Text> },
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
            <Button
              type="link"
              disabled={!canManage || isPrivilegedRole(record)}
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
            >編輯</Button>
            <Button
              type="link"
              disabled={!canManage || isPrivilegedRole(record)}
              onClick={() => {
                setSelectedRole(record)
                permissionsForm.setFieldsValue({
                  permissionIds:
                    record.permissions?.map(
                      (item: RolePermissionLink) => item.permissionId,
                    ) || [],
                })
                setPermissionOpen(true)
              }}
            >設定可用功能</Button>
          <Popconfirm
            title="確認刪除此角色？"
            onConfirm={() => handleDelete(record)}
            disabled={!canManage || Boolean(record.deletionReason) || record.code === 'SUPER_ADMIN'}
          >
            <Tooltip title={record.deletionReason || "刪除"}>
              <Button
                type="text"
                danger
                disabled={!canManage || Boolean(record.deletionReason) || record.code === 'SUPER_ADMIN'}
                icon={<DeleteOutlined />}
              />
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
            職務範本
          </Title>
          <Text type="secondary">先用現有職務，少數例外再建立新範本；修改範本會影響所有已指派帳號。</Text>
        </div>
        <GlassButton variant="primary" disabled={!canManage} onClick={() => {
          createForm.setFieldsValue({ code: newRoleCode(), hierarchyLevel: 3 })
          setCreateOpen(true)
        }}>
          <PlusOutlined className="mr-2" />
          新增職務範本
        </GlassButton>
      </div>
      <div className="mb-4"><Button type="link" onClick={() => setShowTestRoles((value) => !value)}>
        {showTestRoles ? '隱藏測試職務' : `顯示測試職務（${roles.filter(isTestRole).length}）`}
      </Button></div>

      <Table
        rowKey="id"
        columns={columns}
        dataSource={showTestRoles ? roles : roles.filter((role) => !isTestRole(role))}
        loading={loadingRoles}
        expandable={{ expandedRowRender: (role) => <Space wrap><Text code>{role.code}</Text><Tag>階層 {role.hierarchyLevel}</Tag><Text type="secondary">{role.deletionReason || '可刪除'}</Text></Space> }}
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
          <Form.Item name="templateRoleId" label="沿用現有角色的權限" extra="建立獨立角色；日後修改不會影響原角色。">
            <Select allowClear placeholder="從空白建立，或選擇角色範本" options={roles.filter(role => !isPrivilegedRole(role)).map(role => ({ label: role.name, value: role.id }))} />
          </Form.Item>
          {selectedTemplateId && <AccessPreview roles={roles.filter(role => role.id === selectedTemplateId)} />}

          <div className="bg-gray-50 p-4 rounded-lg mb-4 border border-gray-100">
            <Form.Item
              name="name"
              label="職務名稱"
              rules={[{ required: true, message: '請輸入職務名稱' }, { min: 3, message: '至少 3 個字' }]}
            >
              <Input placeholder="例如 倉庫主管" className="rounded-md" />
            </Form.Item>
          </div>
          <div className="bg-gray-50 p-4 rounded-lg border border-gray-100">
            <Form.Item name="description" label="適用工作與說明">
              <Input.TextArea
                rows={3}
                placeholder="簡短說明"
                className="rounded-md"
              />
            </Form.Item>
            <details>
              <summary className="cursor-pointer text-sm text-slate-600">進階：內部代碼與階層</summary>
              <Form.Item name="code" label="內部代碼" rules={[{ required: true }, { pattern: /^[A-Z_]+$/, message: '僅允許大寫英文字與底線' }]} className="mt-3">
                <Input className="rounded-md" />
              </Form.Item>
              <Form.Item name="hierarchyLevel" label="階層（數字越小權限越高）" className="mb-0">
                <InputNumber min={1} style={{ width: '100%' }} className="rounded-md" />
              </Form.Item>
            </details>
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
              rules={[
                { required: true, message: '請輸入角色代碼' },
                { pattern: /^[A-Z_]+$/, message: '僅允許大寫英文字與底線' },
              ]}
            >
              <Input disabled className="rounded-md" />
            </Form.Item>
            <Form.Item
              name="name"
              label="角色名稱"
              rules={[{ required: true, message: '請輸入角色名稱' }]}
            >
              <Input className="rounded-md" />
            </Form.Item>
          </div>
          <div className="bg-gray-50 p-4 rounded-lg border border-gray-100">
            <Form.Item name="description" label="描述">
              <Input.TextArea rows={3} className="rounded-md" />
            </Form.Item>
            <Form.Item name="hierarchyLevel" label="階層" className="mb-0">
              <InputNumber
                min={1}
                style={{ width: '100%' }}
                placeholder="預設為 3"
                className="rounded-md"
              />
            </Form.Item>
          </div>
        </Form>
      </Modal>

      <Modal
        title={`設定角色權限 · ${selectedRole?.name || ""}`}
        open={permissionOpen}
        onCancel={() => setPermissionOpen(false)}
        onOk={handleSetPermissions}
        okText="儲存"
        confirmLoading={loadingPermissions}
        width={860}
      >
        <Alert type="warning" showIcon message={`儲存後會立即影響 ${selectedRole?.assignedUserCount ?? 0} 個已指派帳號。請先確認成本、淨利與薪資等敏感資料。`} />
        <Alert className="mt-3" type="info" showIcon message="毛利需同時開放產品成本；淨利需同時開放產品成本與毛利。" />
        <Form form={permissionsForm} layout="vertical" className="pt-4">
          <div className="bg-gray-50 p-4 rounded-lg border border-gray-100">
            <Form.Item name="permissionIds" label="依功能模組開放操作" className="mb-0">
              <PermissionMatrix permissions={permissions} disabled={!canManage} />
            </Form.Item>
            {rolePreview && <AccessPreview roles={[rolePreview]} />}
          </div>
        </Form>
      </Modal>
    </GlassCard>
  )
}

const PermissionsTab = ({
  canManage,
  permissions,
  loading,
  reloadPermissions,
  reloadRoles,
}: PermissionsTabProps) => {
  const [createOpen, setCreateOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [selectedPermission, setSelectedPermission] =
    useState<Permission | null>(null)

  const [createForm] = Form.useForm<{
    resource: string
    action: string
    description?: string
  }>()
  const [editForm] = Form.useForm<{
    resource?: string
    action?: string
    description?: string
  }>()

  const handleCreate = async () => {
    if (!canManage) return
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
    if (!canManage) return
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
    if (!canManage) return
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
          <Text type="secondary" className="text-xs">
            ({value})
          </Text>
        </Space>
      ),
    },
    {
      title: '操作',
      dataIndex: 'action',
      key: 'action',
      render: (value: string) => <Tag color="blue">{getActionName(value)}</Tag>,
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
              disabled={!canManage} icon={<EditOutlined />}
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
          <Popconfirm
            title="確認刪除此權限？"
            onConfirm={() => handleDelete(record)}
          >
            <Tooltip title="刪除">
              <Button type="text" danger disabled={!canManage} icon={<DeleteOutlined />} />
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
        </div>
        <GlassButton variant="primary" disabled={!canManage} onClick={() => setCreateOpen(true)}>
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
            <Form.Item
              name="resource"
              label="資源"
              rules={[{ required: true, message: '請輸入資源名稱' }]}
            >
              <Input placeholder="例如 users" className="rounded-md" />
            </Form.Item>
            <Form.Item
              name="action"
              label="操作"
              rules={[{ required: true, message: '請輸入操作名稱' }]}
            >
              <Input placeholder="例如 create" className="rounded-md" />
            </Form.Item>
          </div>
          <div className="bg-gray-50 p-4 rounded-lg border border-gray-100">
            <Form.Item name="description" label="描述" className="mb-0">
              <Input.TextArea
                rows={3}
                placeholder="可選"
                className="rounded-md"
              />
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
            <Form.Item
              name="resource"
              label="資源"
              rules={[{ required: true, message: '請輸入資源名稱' }]}
            >
              <Input className="rounded-md" />
            </Form.Item>
            <Form.Item
              name="action"
              label="操作"
              rules={[{ required: true, message: '請輸入操作名稱' }]}
            >
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
  const [searchParams] = useSearchParams()
  const searchKeyword = searchParams.get('q')?.trim() ?? ''
  const canAccessControl =
    isAdminUser(user) ||
    hasPermission(user, 'access_control:read') ||
    hasPermission(user, 'access_control:update')
  const canManage = hasPermission(user, 'access_control:update')
  const canManageDataScopes = hasRole(user, 'SUPER_ADMIN')

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
        <Title level={2} className="!mb-1 !font-light">
          帳號與權限管理
        </Title>
      </div>

      <Alert type="info" showIcon className="mb-4" message="先選人員、指派角色，再確認可見介面。角色可重複使用，多角色權限會合併。" description={!canManage ? "目前為唯讀模式；如需調整請洽權限管理員。" : "公司與資料範圍由最高管理員設定；一般管理員不可指派管理員角色。"} />
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
            children: (
              <UsersTab
                canManage={canManage}
                availableRoles={roles}
                canManageDataScopes={canManageDataScopes}
                searchKeyword={searchKeyword}
              />
            ),
          },
          {
            key: 'roles',
            label: (
              <span>
                <SafetyCertificateOutlined />
                職務範本
              </span>
            ),
            children: (
              <RolesTab
                canManage={canManageDataScopes}
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
                進階權限定義
              </span>
            ),
            children: (
              <PermissionsTab
                canManage={canManageDataScopes}
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
