import React, { useState, useEffect, useCallback } from 'react'
import { Popover, Badge, List, Button, Typography, Empty, Tag, message } from 'antd'
import { 
  BellOutlined, 
  CheckCircleOutlined, 
  WarningOutlined, 
  InfoCircleOutlined,
  CloseCircleOutlined
} from '@ant-design/icons'
import { motion, AnimatePresence } from 'framer-motion'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/zh-tw'
import { notificationService, Notification } from '../services/notification.service'
import { webSocketService } from '../services/websocket.service'
import { useNavigate } from 'react-router-dom'

dayjs.extend(relativeTime)
dayjs.locale('zh-tw')

const { Text, Title } = Typography

const NotificationCenter: React.FC = () => {
  const [open, setOpen] = useState(false)
  const [activeTab, setActiveTab] = useState('all')
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  const fetchNotifications = useCallback(async () => {
    try {
      setLoading(true)
      const data = await notificationService.getNotifications()
      setNotifications(data)
    } catch (error) {
      console.error('Failed to fetch notifications', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) {
      fetchNotifications()
    }
  }, [open, fetchNotifications])

  // Initial fetch and WebSocket subscription
  useEffect(() => {
    fetchNotifications()
    
    // Subscribe to real-time notifications
    const unsubscribe = webSocketService.subscribe((newNotification) => {
      setNotifications(prev => [newNotification, ...prev])
      message.info(`新通知: ${newNotification.title}`)
    })

    // Poll every minute as fallback
    const interval = setInterval(fetchNotifications, 60000)
    
    return () => {
      clearInterval(interval)
      unsubscribe()
    }
  }, [fetchNotifications])

  const unreadCount = notifications.filter(n => !n.read).length

  const handleMarkAllRead = async () => {
    try {
      await notificationService.markAllAsRead()
      setNotifications(prev => prev.map(n => ({ ...n, read: true })))
      message.success('已全部標示為已讀')
    } catch (error) {
      message.error('操作失敗')
    }
  }

  const handleMarkAsRead = async (id: string) => {
    try {
      await notificationService.markAsRead(id)
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n))
    } catch (error) {
      console.error(error)
    }
  }

  const handleNotificationClick = async (item: Notification) => {
    if (!item.read) {
      await handleMarkAsRead(item.id)
    }

    setOpen(false)

    if (item.category === 'expense' && item.data?.requestId) {
      navigate(`/ap/expenses?requestId=${item.data.requestId}`)
      return
    }

    if (item.data?.targetPath) {
      navigate(item.data.targetPath)
      return
    }

    message.info('此通知已標記為已讀')
  }

  const getIcon = (type: string) => {
    switch (type) {
      case 'warning': return <WarningOutlined className="text-orange-500" />
      case 'success': return <CheckCircleOutlined className="text-green-500" />
      case 'error': return <CloseCircleOutlined className="text-red-500" />
      default: return <InfoCircleOutlined className="text-blue-500" />
    }
  }

  const filteredNotifications = activeTab === 'all' 
    ? notifications 
    : activeTab === 'unread' 
      ? notifications.filter(n => !n.read)
      : notifications.filter(n => n.category === activeTab)

  const content = (
    <div className="w-[380px]">
      <div className="flex justify-between items-center px-4 py-3 border-b border-gray-100">
        <Title level={5} className="!mb-0">通知中心</Title>
        <Button type="link" size="small" onClick={handleMarkAllRead} disabled={unreadCount === 0}>
          全部標為已讀
        </Button>
      </div>
      
      <div className="px-4 py-2 border-b border-gray-100 flex gap-2 overflow-x-auto">
         {['all', 'unread', 'expense', 'system'].map(tab => (
            <Button 
              key={tab}
              size="small" 
              type={activeTab === tab ? 'primary' : 'text'} 
              onClick={() => setActiveTab(tab)}
              className={activeTab === tab ? 'bg-blue-50 text-blue-600' : 'text-gray-500'}
            >
              {tab === 'all' ? '全部' : 
               tab === 'unread' ? `未讀 (${unreadCount})` :
               tab === 'expense' ? '費用' :
               tab === 'system' ? '系統' : tab}
            </Button>
         ))}
      </div>

      <div className="max-h-[400px] overflow-y-auto">
        <AnimatePresence mode='popLayout'>
          {filteredNotifications.length > 0 ? (
            <List
              itemLayout="horizontal"
              dataSource={filteredNotifications}
              loading={loading}
              renderItem={(item) => (
                <motion.div
                  layout
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  className={`px-4 py-3 hover:bg-gray-50 cursor-pointer transition-colors border-b border-gray-50 ${!item.read ? 'bg-blue-50/30' : ''}`}
                  onClick={() => { void handleNotificationClick(item) }}
                >
                  <div className="flex gap-3">
                    <div className={`mt-1 w-8 h-8 rounded-full flex items-center justify-center bg-white shadow-sm border border-gray-100`}>
                      {getIcon(item.type)}
                    </div>
                    <div className="flex-1">
                      <div className="flex justify-between items-start mb-1">
                        <Text strong className="text-gray-800">{item.title}</Text>
                        <Text type="secondary" className="text-xs whitespace-nowrap ml-2">
                          {dayjs(item.createdAt).fromNow()}
                        </Text>
                      </div>
                      <Text type="secondary" className="text-sm line-clamp-2 mb-2 block">
                        {item.message}
                      </Text>
                      <div className="flex gap-2">
                        {item.category === 'expense' && (
                          <Tag color="gold" className="rounded-full text-xs px-2">費用</Tag>
                        )}
                        {item.category === 'system' && (
                          <Tag color="blue" className="rounded-full text-xs px-2">系統</Tag>
                        )}
                      </div>
                    </div>
                    {!item.read && (
                      <div className="w-2 h-2 rounded-full bg-blue-500 mt-2" />
                    )}
                  </div>
                </motion.div>
              )}
            />
          ) : (
            <div className="py-12 text-center">
              <Empty description="暫無通知" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            </div>
          )}
        </AnimatePresence>
      </div>
      
      <div className="p-2 border-t border-gray-100 text-center">
        <Button type="text" block size="small" className="text-gray-500">
          查看所有歷史通知
        </Button>
      </div>
    </div>
  )

  return (
    <Popover 
      content={content} 
      trigger="click" 
      placement="bottomRight" 
      open={open} 
      onOpenChange={setOpen}
      overlayClassName="notification-popover"
      arrow={false}
    >
      <button type="button" aria-label="通知中心" className="w-9 h-9 border-0 bg-transparent rounded-lg hover:bg-black/5 flex items-center justify-center cursor-pointer transition-colors relative">
        <Badge count={unreadCount} offset={[-2, 5]} size="small" color="#ef4444">
          <BellOutlined className="text-lg text-[var(--text-primary)]" />
        </Badge>
      </button>
    </Popover>
  )
}

export default NotificationCenter
