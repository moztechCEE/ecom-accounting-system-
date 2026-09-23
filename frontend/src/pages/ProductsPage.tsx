import React, { useState, useEffect } from 'react'
import { Card, Typography, Table, Button, Tag, Space, Modal, Form, Input, Select, InputNumber, message, Checkbox, Divider, Row, Col, Upload, Alert } from 'antd'
import { PlusOutlined, BarcodeOutlined, ReloadOutlined, MinusCircleOutlined, UploadOutlined, DownloadOutlined } from '@ant-design/icons'
import { motion } from 'framer-motion'
import { productService, Product } from '../services/product.service'
import { errorText } from '../features/sn-labels/api'
import { useAuth } from '../contexts/AuthContext'
import { inventoryService } from '../services/inventory.service'
import { resolveEntityId } from '../services/entities.service'

const { Title } = Typography
const { Option } = Select

interface InventoryImportPreview {
  dryRun?: boolean
  file?: string
  sheet?: string
  rawRows?: number
  rows?: number
  skippedRows?: number
  createdWarehouses?: number
  createdProducts?: number
  updatedProducts?: number
  inventoryLines?: number
  serialNumbers?: number
  message?: string
}

const inventoryImportTemplateRows = [
  ['品項編碼', '品項名稱', '倉庫代碼', '倉庫名稱', '庫存數量', '序號'],
  ['4710000000000', 'MOZTECH 範例商品', 'MAIN', '主要倉庫', '10', ''],
  ['4710000000001', 'BONSON 序號商品', 'MAIN', '主要倉庫', '1', 'SN-EXAMPLE-001'],
]

const csvEscape = (value: string | number | null | undefined) => {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

const downloadCsv = (filename: string, rows: Array<Array<string | number>>) => {
  const content = rows.map((row) => row.map(csvEscape).join(',')).join('\n')
  const blob = new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

const ProductsPage: React.FC = () => {
  const { user } = useAuth()
  const canWrite = !!user && (user.roles.some(r => ['ADMIN', 'SUPER_ADMIN'].includes(r)) || user.permissions.includes('inventory:update'))
  const [editing, setEditing] = useState<Product | null>(null)
  const [saving, setSaving] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(false)
  const [isModalVisible, setIsModalVisible] = useState(false)
  const [importing, setImporting] = useState(false)
  const [previewingImport, setPreviewingImport] = useState(false)
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null)
  const [pendingImportEntityId, setPendingImportEntityId] = useState<string | null>(null)
  const [importPreview, setImportPreview] = useState<InventoryImportPreview | null>(null)
  const [importModalOpen, setImportModalOpen] = useState(false)
  const [form] = Form.useForm()

  const fetchProducts = async () => {
    setLoading(true)
    try {
      const data = await productService.findAll()
      setProducts(data)
    } catch (error) {
      message.error('無法載入產品列表')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchProducts()
  }, [])

  const editProduct = (product: Product | null) => {
    setEditing(product)
    setSubmitError(null)
    form.resetFields()
    if (product) {
      const attrs = product.attributes || {}
      const values: Record<string, unknown> = { ...product, snLabels: attrs.snLabels || {}, attributesList: Object.entries(attrs).filter(([k,v]) => k !== 'snLabels' && typeof v === 'string').map(([key,value]) => ({key,value})) }
      for (const k of ['packageLength','packageWidth','packageHeight','weight','grossWeight','netWeight']) values[k] = product[k as keyof Product] == null ? null : Number(product[k as keyof Product])
      form.setFieldsValue(values)
    } else form.setFieldsValue({ type: 'SIMPLE', hasSerialNumbers: false })
    setIsModalVisible(true)
  }
  const handleCreate = async (values: any) => {
    if (saving) return
    setSubmitError(null)
    setSaving(true)
    try {
      const { attributesList, snLabels, ...rest } = values
      const attributes = attributesList?.reduce((acc: any, curr: any) => {
        if (curr.key) acc[curr.key] = curr.value
        return acc
      }, {})

      const data = { ...rest, name: rest.name.trim(), barcode: rest.barcode.trim(), modelNumber: rest.modelNumber?.trim(), attributes: { ...attributes, snLabels } }
      if (editing) {
        delete data.sku
        await productService.update(editing.id, data)
      } else await productService.create({ ...data, sku: rest.sku.trim() })
      message.success(editing ? '產品已更新，下次選取會帶入儲存的 SN 建檔資料' : '產品建立成功')
      setIsModalVisible(false)
      form.resetFields()
      fetchProducts()
    } catch (error) {
      const detail = errorText(error)
      setSubmitError(detail)
      message.error(detail)
    } finally { setSaving(false) }
  }

  const handleDownloadTemplate = () => {
    downloadCsv('inventory-master-import-template.csv', inventoryImportTemplateRows)
  }

  const handlePreviewImport = async (file: File) => {
    setPreviewingImport(true)
    try {
      const entityId = await resolveEntityId()
      const result = await inventoryService.importErpInventory(file, { entityId, dryRun: true })
      setPendingImportFile(file)
      setPendingImportEntityId(entityId)
      setImportPreview(result)
      setImportModalOpen(true)
      message.success(`已預覽 ${result.rows ?? 0} 筆可匯入資料`)
    } catch (error: any) {
      const msg = error?.response?.data?.message || '批次匯入失敗'
      message.error(Array.isArray(msg) ? msg.join(', ') : msg)
    } finally {
      setPreviewingImport(false)
    }
  }

  const handleConfirmImport = async () => {
    if (!pendingImportFile || !pendingImportEntityId || !importPreview) {
      message.warning('請先選擇檔案並完成預覽')
      return
    }

    setImporting(true)
    try {
      if (await resolveEntityId() !== pendingImportEntityId) {
        message.warning('公司已切換，請重新選擇檔案並預覽後再匯入')
        setImportModalOpen(false)
        setPendingImportFile(null)
        setPendingImportEntityId(null)
        setImportPreview(null)
        return
      }
      await inventoryService.importErpInventory(pendingImportFile, { entityId: pendingImportEntityId })
      message.success('批次匯入完成')
      setImportModalOpen(false)
      setPendingImportFile(null)
      setPendingImportEntityId(null)
      setImportPreview(null)
      fetchProducts()
    } catch (error: any) {
      const msg = error?.response?.data?.message || '批次匯入失敗'
      message.error(Array.isArray(msg) ? msg.join(', ') : msg)
    } finally {
      setImporting(false)
    }
  }

  const columns = [
    { title: '操作', key: 'actions', render: (_: unknown, p: Product) => <Button disabled={!canWrite} onClick={() => editProduct(p)}>編輯</Button> },
    { title: 'SKU', dataIndex: 'sku', key: 'sku' },
    { title: '國際條碼', dataIndex: 'barcode', key: 'barcode' },
    { title: '原廠型號', dataIndex: 'modelNumber', key: 'modelNumber' },
    { title: '名稱', dataIndex: 'name', key: 'name' },
    { 
      title: '類型', 
      dataIndex: 'type', 
      key: 'type',
      render: (type: string, record: Product) => (
        <Space>
          <Tag>{type}</Tag>
          {record.hasSerialNumbers && <Tag color="blue">SN追蹤</Tag>}
        </Space>
      )
    },
    { title: '單位', dataIndex: 'unit', key: 'unit' },
    { 
      title: '移動平均成本', 
      dataIndex: 'movingAverageCost', 
      key: 'movingAverageCost',
      render: (val: number) => `$${Number(val).toFixed(2)}`
    },
    { 
      title: '最新進價', 
      dataIndex: 'latestPurchasePrice', 
      key: 'latestPurchasePrice',
      render: (val: number) => `$${Number(val).toFixed(2)}`
    },
  ]

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="px-2 py-4 sm:p-6"
    >
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <Title level={2} className="!mb-0 !text-2xl sm:!text-3xl">產品與庫存管理</Title>
        </div>
        <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2 lg:w-auto lg:flex lg:flex-wrap lg:justify-end">
          <Button className="w-full lg:w-auto" icon={<ReloadOutlined />} onClick={fetchProducts}>重新整理</Button>
          <Button className="w-full lg:w-auto" icon={<DownloadOutlined />} onClick={handleDownloadTemplate}>
            下載匯入範本
          </Button>
          <Upload
            className="w-full lg:w-auto"
            accept=".xlsx,.xls,.csv"
            showUploadList={false}
            beforeUpload={(file) => {
              const lower = file.name.toLowerCase()
              const ok = lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.csv')
              if (!ok) message.error('請上傳 .xlsx / .xls / .csv 檔案')
              return ok || Upload.LIST_IGNORE
            }}
            customRequest={async (options) => {
              try {
                await handlePreviewImport(options.file as File)
                options.onSuccess?.({}, new XMLHttpRequest())
              } catch (e) {
                options.onError?.(e as any)
              }
            }}
          >
            <Button className="w-full lg:w-auto" icon={<UploadOutlined />} loading={previewingImport} disabled={importing || previewingImport}>
              預覽匯入 Excel/CSV
            </Button>
          </Upload>
          <Button className="w-full lg:w-auto" type="primary" icon={<PlusOutlined />} size="large" disabled={!canWrite} onClick={() => editProduct(null)}>
            新增產品
          </Button>
        </div>
      </div>

      <Card className="overflow-hidden shadow-sm rounded-xl border-0">
        {!loading && !products.length && (
          <Alert
            className="mb-4"
            type="warning"
            showIcon
            message="尚未建立產品主檔"
            description="請先新增產品，或下載匯入範本整理 SKU、條碼、倉庫與初始庫存。批次匯入會先預覽，不會在確認前寫入產品或庫存。"
          />
        )}
        <Input.Search className="mb-4" aria-label="搜尋產品" placeholder="搜尋名稱、SKU、國際條碼或型號" value={search} onChange={e => setSearch(e.target.value)} />
        <Table 
          columns={columns} 
          dataSource={products.filter(p => [p.name,p.sku,p.barcode,p.modelNumber].some(v => v?.toLowerCase().includes(search.trim().toLowerCase())))}
          rowKey="id" 
          loading={loading}
          scroll={{ x: 980 }}
        />
      </Card>

      <Modal
        title="預覽庫存 / 產品匯入"
        open={importModalOpen}
        onCancel={() => setImportModalOpen(false)}
        onOk={handleConfirmImport}
        okText="確認匯入"
        cancelText="取消"
        okButtonProps={{
          disabled: !importPreview || !pendingImportFile || !pendingImportEntityId || importing || previewingImport,
          loading: importing,
        }}
      >
        <div className="space-y-4">
          <Alert
            type={(importPreview?.skippedRows ?? 0) > 0 ? 'warning' : 'success'}
            showIcon
            message={`可匯入 ${importPreview?.rows ?? 0} 筆，略過 ${importPreview?.skippedRows ?? 0} 筆`}
            description="這只是 dry-run 預覽。確認筆數、倉庫與產品建立數量正確後，再按「確認匯入」寫入正式資料。"
          />
          <Row gutter={[12, 12]}>
            <Col span={12}>
              <Card size="small">
                <Typography.Text type="secondary">新建倉庫</Typography.Text>
                <div className="text-xl font-semibold">{importPreview?.createdWarehouses ?? 0}</div>
              </Card>
            </Col>
            <Col span={12}>
              <Card size="small">
                <Typography.Text type="secondary">新建產品</Typography.Text>
                <div className="text-xl font-semibold">{importPreview?.createdProducts ?? 0}</div>
              </Card>
            </Col>
            <Col span={12}>
              <Card size="small">
                <Typography.Text type="secondary">更新產品</Typography.Text>
                <div className="text-xl font-semibold">{importPreview?.updatedProducts ?? 0}</div>
              </Card>
            </Col>
            <Col span={12}>
              <Card size="small">
                <Typography.Text type="secondary">庫存行數</Typography.Text>
                <div className="text-xl font-semibold">{importPreview?.inventoryLines ?? 0}</div>
              </Card>
            </Col>
          </Row>
          {importPreview?.message && (
            <Alert type="info" showIcon message={importPreview.message} />
          )}
        </div>
      </Modal>

      <Modal
        title={editing ? "編輯產品" : "新增產品"}
        open={isModalVisible}
        confirmLoading={saving}
        okText="儲存"
        cancelText="取消"
        styles={{ body: { maxHeight: 'min(70vh, 700px)', overflowY: 'auto' } }}
        onCancel={() => setIsModalVisible(false)}
        onOk={() => form.submit()}
      >
        {submitError && <Alert className="sticky top-0 z-10 mb-4" type="error" showIcon message="無法儲存產品" description={submitError} />}
        <Form
          form={form}
          layout="vertical"
          onFinish={handleCreate}
          onFinishFailed={({ errorFields }) => {
            const details = errorFields.slice(0, 3).map(field => field.errors[0]).filter(Boolean).join('；')
            setSubmitError(`請修正 ${errorFields.length} 個欄位${details ? `：${details}` : ''}`)
          }}
          onValuesChange={() => setSubmitError(null)}
          scrollToFirstError={{ block: 'center', behavior: 'smooth' }}
        >
          <Form.Item name="sku" label="SKU" rules={[{ required: true, whitespace: true, message: '請填寫 SKU' }]}>
            <Input disabled={!!editing} placeholder="例如: PB-001" />
          </Form.Item>
          <Form.Item name="barcode" label="國際條碼" rules={[{ required: true, message: '國際條碼為必填' }, { pattern: /^\d{8,14}$/, message: '請填寫 8～14 碼數字，保留開頭的 0' }]}>
            <Input placeholder="例如: 4710000000000" prefix={<BarcodeOutlined />} />
          </Form.Item>
          <Form.Item name="modelNumber" label="原廠型號 (Model No.)">
            <Input placeholder="例如: A2890" />
          </Form.Item>
          <Divider>SN 建檔資料</Divider>
          <Row gutter={12}>{[['style', '款式'], ['color', '顏色'], ['modelCode', '型號代碼'], ['styleCode', '款式代碼（選填）'], ['colorCode', '顏色代碼']].map(([key, label]) => <Col span={12} key={key}><Form.Item name={['snLabels', key]} label={label} extra={key === 'modelCode' ? '無SN.產品，請填入NSI' : undefined}><Input maxLength={key.endsWith('Code') ? 6 : 50} /></Form.Item></Col>)}</Row>
          <Form.Item name="hasSerialNumbers" valuePropName="checked">
            <Checkbox>啟用單品序號追蹤</Checkbox>
          </Form.Item>
          <Form.Item name="name" label="產品名稱" rules={[{ required: true, whitespace: true, message: '請填寫產品名稱' }]}>
            <Input placeholder="例如: Power Bank 10000mAh" />
          </Form.Item>
          <Form.Item name="type" label="類型" rules={[{ required: true, message: '請選擇產品類型' }]}>
            <Select>
              <Option value="SIMPLE">一般產品</Option>
              <Option value="BUNDLE">組合產品</Option>
              <Option value="MANUFACTURED">製造產品</Option>
              <Option value="SERVICE">服務</Option>
            </Select>
          </Form.Item>

          <Divider orientation="left">物流與包裝資訊</Divider>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="packageLength" label="包裝長度 (CM)">
                <InputNumber className="w-full" min={0} placeholder="長" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="packageWidth" label="包裝寬度 (CM)">
                <InputNumber className="w-full" min={0} placeholder="寬" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="packageHeight" label="包裝高度 (CM)">
                <InputNumber className="w-full" min={0} placeholder="高" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="weight" label="重量 (KG)">
                <InputNumber className="w-full" min={0} step={0.001} placeholder="產品重量（可與淨重不同）" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="grossWeight" label="毛重 (KG)">
                <InputNumber className="w-full" min={0} step={0.001} placeholder="含包裝重量" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="netWeight" label="淨重 (KG)">
                <InputNumber className="w-full" min={0} step={0.001} placeholder="產品本體重量" />
              </Form.Item>
            </Col>
          </Row>

          <Divider orientation="left">報關資訊</Divider>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="hsCode" label="HS Code (海關編碼)">
                <Input placeholder="例如: 8504.40.90" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="countryOfOrigin" label="原產地">
                <Input placeholder="例如: TW, CN" />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item name="parentId" label="主產品 (若為變體)">
            <Select allowClear showSearch optionFilterProp="children">
              {products.map(p => (
                <Option key={p.id} value={p.id}>{p.name} ({p.sku})</Option>
              ))}
            </Select>
          </Form.Item>
          
          <Typography.Text strong>變體屬性 (例如: Color: Red)</Typography.Text>
          <Form.List name="attributesList">
            {(fields, { add, remove }) => (
              <>
                {fields.map(({ key, name, ...restField }) => (
                  <Space key={key} style={{ display: 'flex', marginBottom: 8 }} align="baseline">
                    <Form.Item
                      {...restField}
                      name={[name, 'key']}
                      rules={[{ required: true, whitespace: true, message: '請填寫屬性名稱' }]}
                    >
                      <Input placeholder="屬性 (如: Color)" />
                    </Form.Item>
                    <Form.Item
                      {...restField}
                      name={[name, 'value']}
                      rules={[{ required: true, whitespace: true, message: '請填寫屬性值' }]}
                    >
                      <Input placeholder="值 (如: Red)" />
                    </Form.Item>
                    <MinusCircleOutlined onClick={() => remove(name)} />
                  </Space>
                ))}
                <Form.Item>
                  <Button type="dashed" onClick={() => add()} block icon={<PlusOutlined />}>
                    新增屬性
                  </Button>
                </Form.Item>
              </>
            )}
          </Form.List>
        </Form>
      </Modal>
    </motion.div>
  )
}

export default ProductsPage
