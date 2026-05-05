import React from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Alert, Button, Form, Input, Typography, message } from 'antd'
import { LockOutlined } from '@ant-design/icons'
import { motion } from 'framer-motion'
import BrandMark from '../components/BrandMark'
import { authService } from '../services/auth.service'

const { Title, Text } = Typography

const ResetPasswordPage: React.FC = () => {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [loading, setLoading] = React.useState(false)
  const token = searchParams.get('token')?.trim() || ''
  const [form] = Form.useForm()

  const onFinish = async (values: {
    newPassword: string
    confirmPassword: string
  }) => {
    if (!token) {
      message.error('缺少重設密碼 token，請重新從信件連結進入')
      return
    }

    if (values.newPassword !== values.confirmPassword) {
      message.error('兩次輸入的新密碼不一致')
      return
    }

    setLoading(true)
    try {
      await authService.confirmPasswordReset({
        token,
        newPassword: values.newPassword.trim(),
      })
      message.success('密碼已重設，請重新登入')
      navigate('/login', { replace: true })
    } catch (error: any) {
      const errorMsg =
        error?.response?.data?.message ||
        error?.message ||
        '重設密碼失敗，請重新申請'
      message.error(errorMsg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4 relative overflow-hidden">
      <motion.div
        animate={{ x: [0, 35, -35, 0], y: [0, -35, 35, 0] }}
        transition={{ duration: 18, repeat: Infinity, ease: 'linear' }}
        className="absolute top-[-15%] left-[-10%] w-[55%] h-[55%] rounded-full bg-sky-400/25 blur-[100px] pointer-events-none"
      />
      <motion.div
        animate={{ x: [0, -30, 30, 0], y: [0, 30, -30, 0] }}
        transition={{ duration: 16, repeat: Infinity, ease: 'linear', delay: 1 }}
        className="absolute bottom-[-15%] right-[-10%] w-[55%] h-[55%] rounded-full bg-violet-300/25 blur-[100px] pointer-events-none"
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
            重新設定密碼
          </Title>
          <Text className="text-gray-500 font-light">
            請輸入新的登入密碼，完成後即可回到登入頁。
          </Text>
        </div>

        {!token ? (
          <Alert
            type="error"
            showIcon
            message="此重設連結無效"
            description="請重新從忘記密碼流程取得新的信件連結。"
          />
        ) : (
          <Form form={form} layout="vertical" onFinish={onFinish}>
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
              設定新密碼
            </Button>
          </Form>
        )}
      </motion.div>
    </div>
  )
}

export default ResetPasswordPage
