import React, { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { getRoleName } from '../constants/translations'
import { Card, Collapse, Typography, Button, QRCode, Input, message, Divider, Tag, Form, Upload, Alert, Space } from 'antd'
import { motion } from 'framer-motion'
import { UploadOutlined, DownloadOutlined } from '@ant-design/icons'
import { authService } from '../services/auth.service'
import { payrollService } from '../services/payroll.service'
import type { Employee, EmployeeOnboardingDocument } from '../types'

const { Title, Text } = Typography

const ProfilePage: React.FC = () => {
  const { refreshCurrentUser } = useAuth()
  const [accountForm] = Form.useForm()
  const [accountLoading, setAccountLoading] = useState(true)
  const [accountResult, setAccountResult] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [accountSaving, setAccountSaving] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [securityError, setSecurityError] = useState('')
  const [loading, setLoading] = useState(false)
  const [setupData, setSetupData] = useState<{ secret: string; otpauthUrl: string; setupToken: string } | null>(null)
  const [token, setToken] = useState('')
  const [currentStep, setCurrentStep] = useState(0)
  const [user, setUser] = useState<any>(null)
  const [employeeProfile, setEmployeeProfile] = useState<Employee | null>(null)
  const [profileLoading, setProfileLoading] = useState(false)
  const [profileSaving, setProfileSaving] = useState(false)
  const [documentLoading, setDocumentLoading] = useState<string | null>(null)
  const [profileForm] = Form.useForm()

  const onboardingDocDefinitions: Array<{
    docType: EmployeeOnboardingDocument['docType']
    label: string
  }> = [
    { docType: 'ID_FRONT', label: '身分證正面' },
    { docType: 'ID_BACK', label: '身分證反面' },
    { docType: 'HEALTH_CHECK', label: '體檢單' },
  ]

  const onboardingStatusMeta: Record<
    EmployeeOnboardingDocument['status'],
    { color: string; label: string }
  > = {
    PENDING: { color: 'default', label: '未上傳' },
    UPLOADED: { color: 'blue', label: '已上傳，待管理者核實' },
    VERIFIED: { color: 'green', label: '已核實' },
  }

  useEffect(() => {
    fetchUser()
    void fetchEmployeeProfile()
  }, [])

  const fetchUser = async () => {
    try {
      const userData = await authService.getCurrentUser()
      setUser(userData)
      accountForm.setFieldsValue({ name: userData.name })
      if (userData.isTwoFactorEnabled) setCurrentStep(2)
    } catch (error) {
      setAccountResult({ type: 'error', text: '無法載入帳號資料，請重新整理' })
    } finally { setAccountLoading(false) }
  }

  const fetchEmployeeProfile = async () => {
    setProfileLoading(true)
    try {
      const profile = await payrollService.getMyEmployeeProfile()
      setEmployeeProfile(profile)
      profileForm.setFieldsValue({
        nationalId: profile.nationalId || '',
        mailingAddress: profile.mailingAddress || '',
        emergencyContactName: profile.emergencyContactName || '',
        emergencyContactPhone: profile.emergencyContactPhone || '',
      })
    } catch (error: any) {
      setEmployeeProfile(null)
    } finally {
      setProfileLoading(false)
    }
  }

  const handleSaveProfile = async () => {
    try {
      const values = await profileForm.validateFields()
      setProfileSaving(true)
      const profile = await payrollService.updateMyEmployeeProfile(values)
      setEmployeeProfile(profile)
      message.success('入職資料已更新')
    } catch (error: any) {
      if (error?.errorFields) {
        return
      }
      message.error(error?.response?.data?.message || '更新入職資料失敗')
    } finally {
      setProfileSaving(false)
    }
  }

  const handleUploadDocument = async (
    docType: EmployeeOnboardingDocument['docType'],
    file: File,
  ) => {
    try {
      setDocumentLoading(docType)
      await payrollService.uploadMyOnboardingDocument(docType, file)
      await fetchEmployeeProfile()
      message.success('文件上傳成功，已送管理者核實')
    } catch (error: any) {
      message.error(error?.response?.data?.message || '文件上傳失敗')
    } finally {
      setDocumentLoading(null)
    }

    return false
  }

  const handleDownloadDocument = async (
    docType: EmployeeOnboardingDocument['docType'],
  ) => {
    try {
      setDocumentLoading(docType)
      await payrollService.downloadMyOnboardingDocument(docType)
    } catch (error: any) {
      message.error(error?.response?.data?.message || '下載文件失敗')
    } finally {
      setDocumentLoading(null)
    }
  }

  const handleStartSetup = async () => {
    setLoading(true); setSecurityError('')
    try {
      const data = await authService.get2FASetup()
      setSetupData(data)
      setCurrentStep(1)
    } catch (error: any) {
      setSecurityError(error.response?.data?.message || '無法開始設定，請重試')
    } finally {
      setLoading(false)
    }
  }

  const handleVerify = async () => {
    if (!setupData || !token) return
    setLoading(true); setSecurityError('')
    try {
      await authService.enable2FA(token, setupData.setupToken, currentPassword)
      setSetupData(null); setToken(''); setCurrentPassword('')
      await fetchUser(); await refreshCurrentUser()
      message.success('兩步驟驗證已啟用')
      setCurrentStep(2)
    } catch (error: any) {
      setSecurityError(error.response?.data?.message || '驗證失敗，請重試')
    } finally {
      setLoading(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="space-y-8"
    >
      <Title level={2} className="!mb-1 !font-light">
        個人資料
      </Title>

      <Card title="帳號資料">
        <Form form={accountForm} layout="vertical" disabled={accountLoading || !user} onValuesChange={() => setAccountResult(null)} onFinish={async values => {
          setAccountSaving(true); setAccountResult(null)
          try { await authService.updateProfile(values.name); await fetchUser(); await refreshCurrentUser(); setAccountResult({ type: 'success', text: '個人資料已更新' }) }
          catch (error: any) { setAccountResult({ type: 'error', text: error.response?.data?.message || '儲存失敗' }) }
          finally { setAccountSaving(false) }
        }}>
          <Form.Item name="name" label="姓名" rules={[{ required: true, whitespace: true, max: 100, message: '請輸入姓名（最多 100 字）' }]}><Input /></Form.Item>
          <Typography.Paragraph>登入帳號：{user?.email || '載入中'}</Typography.Paragraph>
          <Typography.Paragraph>角色：{user?.roles?.map((role: string) => getRoleName(role)).join('、') || '—'}</Typography.Paragraph>
          {accountResult && <Alert type={accountResult.type} showIcon message={accountResult.text} style={{ marginBottom: 16 }} />}
          <Button type="primary" htmlType="submit" loading={accountSaving}>儲存個人資料</Button>
        </Form>
      </Card>
      <Card title="入職資料與文件">
        {employeeProfile ? (
          <div className="space-y-6">
            <Alert
              type="info"
              showIcon
              message="這裡提供員工自行補上入職資料與必要文件"
              description="身分證正反面與體檢單上傳後，會由管理者核實；核實前狀態會顯示為已上傳。"
            />

            <Form form={profileForm} layout="vertical">
              <Form.Item name="nationalId" label="身分證字號">
                <Input placeholder="例如 A123456789" />
              </Form.Item>
              <Form.Item name="mailingAddress" label="通訊地址">
                <Input.TextArea rows={3} placeholder="請輸入通訊地址" />
              </Form.Item>
              <div className="grid gap-4 md:grid-cols-2">
                <Form.Item name="emergencyContactName" label="緊急聯絡人">
                  <Input placeholder="請輸入緊急聯絡人姓名" />
                </Form.Item>
                <Form.Item name="emergencyContactPhone" label="緊急聯絡人電話">
                  <Input placeholder="請輸入緊急聯絡人電話" />
                </Form.Item>
              </div>
              <Button type="primary" loading={profileSaving} onClick={handleSaveProfile}>
                儲存入職資料
              </Button>
            </Form>

            <Divider />

            <div className="space-y-3">
              {onboardingDocDefinitions.map(({ docType, label }) => {
                const document =
                  employeeProfile.onboardingDocuments?.find((item) => item.docType === docType) ||
                  ({
                    id: `${employeeProfile.id}:${docType}`,
                    docType,
                    status: 'PENDING',
                    isRequired: false,
                  } as EmployeeOnboardingDocument)
                const statusMeta = onboardingStatusMeta[document.status]

                return (
                  <div key={docType} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2 font-medium text-slate-800">
                          <span>{label}</span>
                          {document.isRequired ? <Tag color="red">必填</Tag> : null}
                        </div>
                        <div className="text-xs text-slate-500">{document.fileName || '尚未上傳'}</div>
                      </div>
                      <Tag color={statusMeta.color}>{statusMeta.label}</Tag>
                    </div>
                    <Space className="mt-3" wrap>
                      <Upload
                        showUploadList={false}
                        beforeUpload={(file) => handleUploadDocument(docType, file)}
                      >
                        <Button icon={<UploadOutlined />} loading={documentLoading === docType}>
                          上傳文件
                        </Button>
                      </Upload>
                      <Button
                        icon={<DownloadOutlined />}
                        disabled={!document.fileName}
                        loading={documentLoading === docType}
                        onClick={() => void handleDownloadDocument(docType)}
                      >
                        下載
                      </Button>
                    </Space>
                  </div>
                )
              })}
            </div>
          </div>
        ) : profileLoading ? (
          <div className="py-10 text-center text-slate-400">載入中...</div>
        ) : (
          <Alert
            type="warning"
            showIcon
            message="目前帳號尚未綁定員工資料"
            description="請請管理者先在員工與部門裡將你的登入帳號綁定到對應員工。"
          />
        )}
      </Card>
      
      <Collapse items={[{ key: 'security', label: `帳號安全 · 兩步驟驗證${currentStep === 2 ? '已啟用' : '未啟用'}`, children: <div style={{ maxWidth: 560 }}>
        <Typography.Paragraph type="secondary">兩步驟驗證是額外的登入保護，不影響編輯個人資料。</Typography.Paragraph>
        {securityError && <Alert type="error" showIcon message={securityError} style={{ marginBottom: 16 }} />}
        {currentStep === 2 ? <Alert type="success" message="已啟用兩步驟驗證" description="下次登入需輸入密碼及手機驗證器的六位數驗證碼。" /> : currentStep === 0 ? <Button onClick={handleStartSetup} loading={loading}>設定兩步驟驗證</Button> : setupData && <Space direction="vertical" size="middle">
          <Typography.Text>用手機驗證器掃描 QR Code，並保存設定金鑰供更換手機時使用。設定十分鐘內有效。</Typography.Text>
          <QRCode value={setupData.otpauthUrl} size={200} />
          <Typography.Text copyable>{setupData.secret}</Typography.Text>
          <Input.Password aria-label="目前密碼" placeholder="目前登入密碼" autoComplete="current-password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} />
          <Input aria-label="驗證器驗證碼" placeholder="驗證器的六位數驗證碼" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={token} onChange={event => setToken(event.target.value.replace(/\D/g, ''))} />
          <Space><Button type="primary" onClick={handleVerify} loading={loading} disabled={token.length !== 6 || !currentPassword}>驗證並啟用</Button><Button onClick={() => { setSetupData(null); setCurrentPassword(''); setToken(''); setSecurityError(''); setCurrentStep(0) }}>取消</Button></Space>
        </Space>}
      </div> }]} />
    </motion.div>
  )
}

export default ProfilePage
