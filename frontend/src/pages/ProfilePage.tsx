import React, { useState, useEffect } from 'react'
import { Card, Typography, Button, Steps, QRCode, Input, message, Divider, Tag, Form, Upload, Alert, Space } from 'antd'
import { motion } from 'framer-motion'
import { SafetyCertificateOutlined, CheckCircleOutlined, LockOutlined, UploadOutlined, DownloadOutlined } from '@ant-design/icons'
import { authService } from '../services/auth.service'
import { payrollService } from '../services/payroll.service'
import type { Employee, EmployeeOnboardingDocument } from '../types'

const { Title, Text } = Typography
const { Step } = Steps

const ProfilePage: React.FC = () => {
  const [loading, setLoading] = useState(false)
  const [setupData, setSetupData] = useState<{ secret: string; otpauthUrl: string } | null>(null)
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
      // Check if user has 2FA enabled based on backend data (if available in user object)
      // Currently backend mapManagedUserToUser doesn't mapping is_two_factor_enabled
      // but let's assume valid setup flow is available.
    } catch (error) {
       // ignore
    }
  }

  const fetchEmployeeProfile = async () => {
    setProfileLoading(true)
    try {
      const profile = await payrollService.getMyEmployeeProfile()
      setEmployeeProfile(profile)
      profileForm.setFieldsValue({
        nationalId: profile.nationalId || '',
        mailingAddress: profile.mailingAddress || '',
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
    setLoading(true)
    try {
      const data = await authService.get2FASetup()
      setSetupData(data)
      setCurrentStep(1)
    } catch (error) {
      message.error('Failed to initiate 2FA setup')
    } finally {
      setLoading(false)
    }
  }

  const handleVerify = async () => {
    if (!setupData || !token) return
    setLoading(true)
    try {
      await authService.enable2FA(token, setupData.secret)
      message.success('Two-Factor Authentication Enabled Successfully!')
      setCurrentStep(2)
    } catch (error) {
      message.error('Invalid Verification Code')
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
                  } as EmployeeOnboardingDocument)
                const statusMeta = onboardingStatusMeta[document.status]

                return (
                  <div key={docType} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="font-medium text-slate-800">{label}</div>
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
      
      <Card title={<span><SafetyCertificateOutlined /> Security Settings</span>}>
        <div className="max-w-xl mx-auto">
          <Title level={4}>Two-Factor Authentication (2FA)</Title>
          <Text type="secondary">
            Protect your account with an extra layer of security.
          </Text>
          
          <Divider />

          {currentStep === 2 ? (
             <div className="text-center py-8">
                <CheckCircleOutlined className="text-6xl text-green-500 mb-4" />
                <Title level={3}>2FA is Active</Title>
                <Text>Your account is now secured.</Text>
             </div>
          ) : (
            <>
              <Steps current={currentStep} className="mb-8">
                <Step title="Start" description="Initiate Setup" />
                <Step title="Scan" description="Scan QR Code" />
                <Step title="Verify" description="Enter Code" />
              </Steps>

              {currentStep === 0 && (
                <div className="text-center">
                   <LockOutlined className="text-6xl text-blue-500 mb-4" />
                   <div className="mb-4">
                     <Text>Click the button below to set up 2FA using Google Authenticator or similar apps.</Text>
                   </div>
                   <Button type="primary" onClick={handleStartSetup} loading={loading}>
                     Setup 2FA
                   </Button>
                </div>
              )}

              {currentStep === 1 && setupData && (
                <div className="flex flex-col items-center space-y-6">
                  <div className="p-4 border rounded bg-white">
                    <QRCode value={setupData.otpauthUrl} size={200} />
                  </div>
                  <div className="text-center">
                    <Text strong>Scan this QR Code with your Authenticator App</Text>
                    <br />
                    <Text type="secondary" copyable>{setupData.secret}</Text>
                  </div>
                  
                  <div className="w-full max-w-xs">
                    <Input.OTP 
                      length={6} 
                      value={token} 
                      onChange={(val) => setToken(val)} 
                      size="large"
                    />
                    <Button 
                      type="primary" 
                      block 
                      className="mt-4" 
                      onClick={handleVerify} 
                      loading={loading}
                      disabled={token.length !== 6}
                    >
                      Verify & Enable
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </Card>
    </motion.div>
  )
}

export default ProfilePage
