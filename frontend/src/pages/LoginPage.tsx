import React from 'react'
import { useNavigate } from 'react-router-dom'
import { Form, Input, Button, message, Typography, Checkbox, Modal, Select } from 'antd'
import { ApartmentOutlined, UserOutlined, LockOutlined } from '@ant-design/icons'
import { motion, useReducedMotion } from 'framer-motion'
import { useAuth } from '../contexts/AuthContext'
import { authService } from '../services/auth.service'
import { LoginRequest } from '../types'
import BrandMark from '../components/BrandMark'
import { loginDestination } from '../utils/login-destination'
import { PRODUCT } from '../config/product'

const { Title, Text } = Typography
const PLATFORM_ADMIN_LOGIN_IDS = new Set([
  'moztecheason@gmail.com',
  's7896629@gmail.com',
  'forever200656@gmail.com',
])

const LoginPage: React.FC = () => {
  const navigate = useNavigate()
  const { login } = useAuth()
  const [needsTwoFactor, setNeedsTwoFactor] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const reducedMotion = useReducedMotion()
  const [forgotOpen, setForgotOpen] = React.useState(false)
  const [forgotLoading, setForgotLoading] = React.useState(false)
  const [loginEntities, setLoginEntities] = React.useState<Array<{ id: string; loginCode: string }>>([])
  const [forgotForm] = Form.useForm<{ email: string }>()

  React.useEffect(() => {
    authService.getLoginEntities()
      .then((entities) => {
        setLoginEntities(entities)
      })
      .catch(() => {
        setLoginEntities([])
      })
  }, [])

  const onFinish = async (values: LoginRequest & { loginId?: string }) => {
    setLoading(true)
    const loginId = values.loginId?.trim() || values.email?.trim() || ''
    const normalizedLoginId = loginId.toLowerCase()
    const isPlatformAdminLogin = PLATFORM_ADMIN_LOGIN_IDS.has(normalizedLoginId)
    const cleanValues = {
      ...(isPlatformAdminLogin
        ? { platformLoginId: normalizedLoginId }
        : loginId.includes('@')
        ? { email: loginId.toLowerCase() }
        : {
            entityId: values.entityId?.trim(),
            employeeNo: loginId,
          }),
      password: values.password,
      ...(needsTwoFactor ? { twoFactorToken: values.twoFactorToken } : {})
    }
    try {
      const currentUser = await login(cleanValues)
      message.success('登入成功')
      navigate(loginDestination(currentUser))
    } catch (error: any) {
      if (error.response?.data?.code === 'TWO_FACTOR_REQUIRED') setNeedsTwoFactor(true)
      let errorMsg = '登入失敗'
      
      if (error.response) {
        errorMsg = error.response.data?.message || `伺服器錯誤 (${error.response.status})`
      } else if (error.request) {
        errorMsg = '無法連接到伺服器，請檢查網路或後端狀態'
      } else {
        errorMsg = error.message
      }
      
      message.error(errorMsg)
    } finally {
      setLoading(false)
    }
  }

  const handleForgotPassword = async () => {
    try {
      const values = await forgotForm.validateFields()
      setForgotLoading(true)
      await authService.requestPasswordReset(values.email.trim())
      message.success('若該帳號存在，系統會寄出重設密碼通知。若未收到信，請洽管理員確認郵件設定。')
      setForgotOpen(false)
      forgotForm.resetFields()
    } catch (error: any) {
      if (error?.errorFields) {
        return
      }
      const errorMsg =
        error?.response?.data?.message ||
        error?.message ||
        '送出忘記密碼申請失敗'
      message.error(errorMsg)
    } finally {
      setForgotLoading(false)
    }
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4 relative overflow-hidden">
      <motion.div 
        initial={reducedMotion ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="glass-card w-full max-w-[420px] p-10 relative z-10"
      >
        <div className="text-center mb-10">
          <motion.div 
            whileHover={reducedMotion ? undefined : { scale: 1.03 }}
            className="w-20 h-20 bg-white/50 rounded-3xl flex items-center justify-center mx-auto mb-6 backdrop-blur-xl border border-white/60 shadow-lg cursor-pointer transition-all"
          >
            <BrandMark className="w-12 h-12 drop-shadow-sm" alt="Corely AI" />
          </motion.div>
          <Title level={2} className="!text-gray-800 !mb-2 !font-medium tracking-tight">{PRODUCT.name}</Title>
          <Text className="text-gray-500">{PRODUCT.brand}</Text>
        </div>

        <Form
          name="login"
          method="post"
          onFinish={onFinish}
          autoComplete="off"
          layout="vertical"
          size="large"
          className="space-y-4"
          initialValues={{
            remember: true,
            entityId:
              localStorage.getItem('entityId') ||
              window.__APP_CONFIG__?.defaultEntityId ||
              import.meta.env.VITE_DEFAULT_ENTITY_ID ||
              'tw-entity-001',
          }}
        >
          <Form.Item
            name="entityId"
            className="mb-4"
          >
            <Select
              suffixIcon={<ApartmentOutlined className="text-gray-400 text-lg" />}
              placeholder="事業代號，例如 900324"
              showSearch
              optionFilterProp="label"
              className="!h-12 !rounded-xl hover:!border-blue-400 focus:!border-blue-500 transition-colors"
              options={loginEntities.map((entity) => ({
                label: entity.loginCode,
                value: entity.id,
              }))}
            />
          </Form.Item>

          <Form.Item
            name="loginId"
            rules={[{ required: true, message: '請輸入員工代碼' }]}
            className="mb-4"
          >
            <Input 
              prefix={<UserOutlined className="text-gray-400 text-lg" />} 
              placeholder="員工代碼 / 最高權限帳號"
              className="!h-12 !rounded-xl hover:!border-blue-400 focus:!border-blue-500 transition-colors"
            />
          </Form.Item>

          <Form.Item 
            name="password" 
            rules={[{ required: true, message: '請輸入密碼' }]}
            className="mb-2"
          >
            <Input.Password 
              prefix={<LockOutlined className="text-gray-400 text-lg" />} 
              placeholder="密碼" 
              className="!h-12 !rounded-xl hover:!border-blue-400 focus:!border-blue-500 transition-colors"
              autoComplete="current-password"
            />
          </Form.Item>

          <div className="flex justify-between items-center mb-6">
            <Form.Item name="remember" valuePropName="checked" noStyle>
              <Checkbox className="text-gray-500">記住我</Checkbox>
            </Form.Item>
            <a
              className="text-blue-500 hover:text-blue-600 text-sm font-medium"
              href="#"
              onClick={(event) => {
                event.preventDefault()
                setForgotOpen(true)
              }}
            >
              忘記密碼？
            </a>
          </div>

          {needsTwoFactor && <Form.Item name="twoFactorToken" label="驗證器驗證碼" rules={[{ required: true, pattern: /^\d{6}$/, message: '請輸入六位數驗證碼' }]}><Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="六位數驗證碼" /></Form.Item>}
          <Form.Item className="mb-6">
            <Button 
              type="primary" 
              htmlType="submit" 
              loading={loading}
              className="w-full !h-12 !rounded-xl !text-lg !font-medium hover:!scale-[1.02] active:!scale-[0.98] transition-transform shadow-lg shadow-blue-500/30"
            >
              登入系統
            </Button>
          </Form.Item>

          <div className="text-center">
            <Text className="text-gray-400 text-xs">
              © {new Date().getFullYear()} Corely AI
            </Text>
          </div>
        </Form>
      </motion.div>

      <Modal
        title="忘記密碼"
        open={forgotOpen}
        onCancel={() => setForgotOpen(false)}
        onOk={() => void handleForgotPassword()}
        confirmLoading={forgotLoading}
        okText="寄送重設通知"
      >
        <Form form={forgotForm} layout="vertical">
          <Form.Item
            name="email"
            label="電子郵件"
            rules={[
              { required: true, message: '請輸入電子郵件' },
              { type: 'email', message: '請輸入有效的電子郵件' },
            ]}
          >
            <Input placeholder="請輸入登入用電子郵件" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default LoginPage
