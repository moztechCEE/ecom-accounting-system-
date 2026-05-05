import React from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Button, Form, Input, Typography, message } from 'antd'
import { LockOutlined } from '@ant-design/icons'
import { motion } from 'framer-motion'
import BrandMark from '../components/BrandMark'
import { authService } from '../services/auth.service'
import { useAuth } from '../contexts/AuthContext'

const { Title, Text } = Typography

const ForcePasswordChangePage: React.FC = () => {
  const navigate = useNavigate()
  const { refreshCurrentUser, logout } = useAuth()
  const [loading, setLoading] = React.useState(false)
  const [form] = Form.useForm()

  const onFinish = async (values: {
    currentPassword: string
    newPassword: string
    confirmPassword: string
  }) => {
    if (values.newPassword !== values.confirmPassword) {
      message.error('兩次輸入的新密碼不一致')
      return
    }

    setLoading(true)
    try {
      await authService.changePassword({
        currentPassword: values.currentPassword.trim(),
        newPassword: values.newPassword.trim(),
      })
      await refreshCurrentUser()
      message.success('密碼已更新，請重新使用新密碼登入')
      logout()
      navigate('/login', { replace: true })
    } catch (error: any) {
      const errorMsg =
        error?.response?.data?.message ||
        error?.message ||
        '更新密碼失敗，請稍後再試'
      message.error(errorMsg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4 relative overflow-hidden">
      <motion.div
        animate={{ x: [0, 40, -40, 0], y: [0, -30, 30, 0] }}
        transition={{ duration: 18, repeat: Infinity, ease: 'linear' }}
        className="absolute top-[-15%] left-[-10%] w-[55%] h-[55%] rounded-full bg-blue-400/25 blur-[100px] pointer-events-none"
      />
      <motion.div
        animate={{ x: [0, -35, 35, 0], y: [0, 35, -35, 0] }}
        transition={{ duration: 16, repeat: Infinity, ease: 'linear', delay: 1 }}
        className="absolute bottom-[-15%] right-[-10%] w-[55%] h-[55%] rounded-full bg-pink-300/25 blur-[100px] pointer-events-none"
      />

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="glass-card w-full max-w-[460px] p-10 relative z-10"
      >
        <div className="text-center mb-8">
          <div className="w-20 h-20 bg-white/50 rounded-3xl flex items-center justify-center mx-auto mb-6 backdrop-blur-xl border border-white/60 shadow-lg">
            <BrandMark className="w-12 h-12 drop-shadow-sm" alt="System logo" />
          </div>
          <Title level={2} className="!text-gray-800 !mb-2 !font-light tracking-tight">
            首次登入請先修改密碼
          </Title>
          <Text className="text-gray-500 font-light">
            為了帳號安全，請先把臨時密碼換成您自己的新密碼。
          </Text>
        </div>

        <Alert
          type="info"
          showIcon
          className="mb-6"
          message="修改完成後，系統會請您重新登入一次。"
        />

        <Form form={form} layout="vertical" onFinish={onFinish}>
          <Form.Item
            name="currentPassword"
            label="目前密碼"
            rules={[{ required: true, message: '請輸入目前密碼' }]}
          >
            <Input.Password
              prefix={<LockOutlined className="text-gray-400" />}
              placeholder="請輸入目前密碼"
              className="!h-12 !rounded-xl"
            />
          </Form.Item>

          <Form.Item
            name="newPassword"
            label="新密碼"
            rules={[
              { required: true, message: '請輸入新密碼' },
              { min: 8, message: '新密碼至少需要 8 碼' },
            ]}
          >
            <Input.Password
              prefix={<LockOutlined className="text-gray-400" />}
              placeholder="至少 8 碼"
              className="!h-12 !rounded-xl"
            />
          </Form.Item>

          <Form.Item
            name="confirmPassword"
            label="確認新密碼"
            rules={[{ required: true, message: '請再次輸入新密碼' }]}
          >
            <Input.Password
              prefix={<LockOutlined className="text-gray-400" />}
              placeholder="請再次輸入新密碼"
              className="!h-12 !rounded-xl"
            />
          </Form.Item>

          <Button
            type="primary"
            htmlType="submit"
            loading={loading}
            className="w-full !h-12 !rounded-xl !text-lg !font-medium shadow-lg shadow-blue-500/30"
          >
            更新密碼
          </Button>
        </Form>
      </motion.div>
    </div>
  )
}

export default ForcePasswordChangePage
