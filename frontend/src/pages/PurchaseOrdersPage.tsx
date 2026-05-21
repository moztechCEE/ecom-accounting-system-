import React, { useState, useEffect } from 'react'
import { Card, Typography, Table, Button, Tag, Space, message, Modal, Form, Input } from 'antd'
import { FileTextOutlined, PlusOutlined, ReloadOutlined, ScanOutlined } from '@ant-design/icons'
import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { purchaseService, PurchaseOrder } from '../services/purchase.service'

const { Title } = Typography

const PurchaseOrdersPage: React.FC = () => {
  const navigate = useNavigate()
  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [loading, setLoading] = useState(false)
  const [receiveModalVisible, setReceiveModalVisible] = useState(false)
  const [selectedOrder, setSelectedOrder] = useState<PurchaseOrder | null>(null)
  const [snForm] = Form.useForm()

  const fetchOrders = async () => {
    setLoading(true)
    try {
      const data = await purchaseService.findAll()
      setOrders(data)
    } catch (error) {
      message.error('無法載入採購訂單')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchOrders()
  }, [])

  const onReceiveClick = async (order: PurchaseOrder) => {
    try {
      const fullOrder = await purchaseService.findOne(order.id)
      setSelectedOrder(fullOrder)
      setReceiveModalVisible(true)
      snForm.resetFields()
    } catch (error) {
      message.error('無法載入訂單詳情')
    }
  }

  const handleReceiveSubmit = async () => {
    try {
      const values = await snForm.validateFields()
      const serialNumbers = Object.keys(values).map(key => ({
        productId: key,
        serialNumbers: values[key]
      }))

      if (selectedOrder) {
        await purchaseService.receive(selectedOrder.id, 'default-warehouse', serialNumbers)
        message.success('收貨成功')
        setReceiveModalVisible(false)
        fetchOrders()
      }
    } catch (error) {
      console.error(error)
      message.error('收貨失敗')
    }
  }

  const columns = [
    { title: '採購單號', dataIndex: 'id', key: 'id', render: (id: string) => id.slice(0, 8) },
    { 
      title: '供應商', 
      dataIndex: ['vendor', 'name'], 
      key: 'vendor' 
    },
    { 
      title: '日期', 
      dataIndex: 'orderDate', 
      key: 'orderDate',
      render: (date: string) => new Date(date).toLocaleDateString()
    },
    { 
      title: '狀態', 
      dataIndex: 'status', 
      key: 'status',
      render: (status: string) => {
        const colors: Record<string, string> = {
          'pending': 'blue',
          'received': 'green',
          'completed': 'green',
          'cancelled': 'red'
        }
        return <Tag color={colors[status] || 'default'}>{status.toUpperCase()}</Tag>
      }
    },
    { 
      title: '總金額', 
      dataIndex: 'totalAmountOriginal', 
      key: 'totalAmountOriginal',
      render: (val: number) => `$${Number(val).toFixed(2)}`
    },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: PurchaseOrder) => (
        <Space>
          {record.status === 'pending' && (
             <Button type="primary" size="small" icon={<ScanOutlined />} onClick={() => onReceiveClick(record)}>收貨</Button>
          )}
        </Space>
      )
    }
  ]

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="p-6"
    >
      <div className="flex justify-between items-center mb-6">
        <div>
          <Title level={2} className="!mb-0">採購訂單 (PO)</Title>
          <p className="text-gray-500 mt-1">管理向供應商的採購流程與進貨驗收</p>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={fetchOrders}>重新整理</Button>
          <Button icon={<FileTextOutlined />} onClick={() => navigate('/sales/quotations')}>
            客戶報價單
          </Button>
          <Button type="primary" icon={<PlusOutlined />} size="large">
            建立採購單
          </Button>
        </Space>
      </div>

      <Card className="shadow-sm rounded-xl border-0">
        <Table 
          columns={columns} 
          dataSource={orders} 
          rowKey="id"
          loading={loading}
        />
      </Card>

      <Modal
        title="採購收貨 (Inbound Receive)"
        open={receiveModalVisible}
        onCancel={() => setReceiveModalVisible(false)}
        onOk={handleReceiveSubmit}
        width={600}
        okText="確認收貨"
        cancelText="取消"
      >
        <Form form={snForm} layout="vertical">
          {selectedOrder?.items.map(item => {
            if (!item.product?.hasSerialNumbers) return null;
            
            return (
              <div key={item.id} className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
                <div className="mb-3">
                  <Typography.Text strong className="text-lg">{item.product.name}</Typography.Text>
                  <br />
                  <Typography.Text type="secondary">SKU: {item.product.sku} | 需輸入 {Number(item.qty)} 個序號</Typography.Text>
                </div>
                
                <Form.List name={item.productId} initialValue={Array(Number(item.qty)).fill('')}>
                  {(fields) => (
                    <div className="grid grid-cols-1 gap-2">
                      {fields.map((field, index) => (
                        <Form.Item
                          {...field}
                          key={field.key}
                          rules={[{ required: true, message: '請輸入序號' }]}
                          label={`序號 ${index + 1}`}
                          className="!mb-2"
                        >
                          <Input placeholder="掃描或輸入 SN" prefix={<ScanOutlined />} autoFocus={index === 0} />
                        </Form.Item>
                      ))}
                    </div>
                  )}
                </Form.List>
              </div>
            )
          })}
          {selectedOrder && !selectedOrder.items.some(i => i.product.hasSerialNumbers) && (
            <div className="text-center py-8">
              <Typography.Title level={4}>確認收貨？</Typography.Title>
              <p className="text-gray-500">此訂單商品無須輸入序號，點擊確認即可完成入庫。</p>
            </div>
          )}
        </Form>
      </Modal>
    </motion.div>
  )
}

export default PurchaseOrdersPage
