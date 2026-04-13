import React from "react";
import {
  Alert,
  Switch,
  Slider,
  InputNumber,
  Button,
  Typography,
  Divider,
  Form,
  message,
  Select,
} from "antd";
import { motion } from "framer-motion";
import {
  SettingOutlined,
  BellOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons";

const { Title, Text } = Typography;
const { Option } = Select;

const SystemSettingsPage: React.FC = () => {
  const [form] = Form.useForm();

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      console.log("Settings saved:", values);
      message.success("系統參數已更新");
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="space-y-6"
    >
      <div className="flex justify-between items-center">
        <div>
          <Title level={2} className="!mb-1 !font-light">
            系統參數設定
          </Title>
          <Text type="secondary">管理通知、安全與 AI 協作方式</Text>
        </div>
        <Button
          type="primary"
          icon={<SettingOutlined />}
          onClick={handleSave}
          size="large"
        >
          儲存變更
        </Button>
      </div>

      <Alert
        type="info"
        showIcon
        message="少即是多，大道至簡"
        description="AI 的工作是理解問題、找資料、整理答案；高風險決策仍應由制度、權限與人工複核來把關。"
        className="!rounded-2xl !border-sky-200 !bg-sky-50/80"
      />

      <Form
        form={form}
        layout="vertical"
        initialValues={{
          emailNotifications: true,
          pushNotifications: true,
          aiConfidenceThreshold: 80,
          aiAutoFillSuggestions: true,
          sessionTimeout: 30,
          passwordExpiry: 90,
          language: "zh-TW",
        }}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Notification Settings */}
          <div className="glass-panel p-6">
            <div className="flex items-center gap-3 mb-6">
              <BellOutlined className="text-2xl text-blue-500" />
              <Title level={4} className="!m-0">
                通知設定
              </Title>
            </div>

            <Form.Item
              label="電子郵件通知"
              name="emailNotifications"
              valuePropName="checked"
              extra="當有重要待辦事項或審核結果時發送 Email"
            >
              <Switch />
            </Form.Item>

            <Divider />

            <Form.Item
              label="系統推播通知"
              name="pushNotifications"
              valuePropName="checked"
              extra="在瀏覽器中顯示即時推播通知"
            >
              <Switch />
            </Form.Item>
          </div>

          {/* AI Settings */}
          <div className="glass-panel p-6">
            <div className="flex items-center gap-3 mb-6">
              <RobotOutlined className="text-2xl text-sky-600" />
              <Title level={4} className="!m-0">
                AI 協作方式
              </Title>
            </div>

            <div className="mb-5 rounded-2xl border border-slate-200 bg-white/50 px-4 py-3 text-xs leading-6 text-slate-500">
              原則很簡單：AI
              先幫你縮小範圍、整理答案；真的需要拍板的地方，再交回人工確認。
            </div>

            <Form.Item
              label="低信心轉人工複核門檻 (%)"
              name="aiConfidenceThreshold"
              extra="低於此門檻時，系統只提供建議，不幫你直接下判斷。"
            >
              <Slider
                marks={{ 0: "0%", 50: "50%", 80: "80%", 100: "100%" }}
                step={5}
              />
            </Form.Item>

            <Form.Item
              label="自動帶入 AI 建議欄位"
              name="aiAutoFillSuggestions"
              valuePropName="checked"
              extra="例如自動帶入推薦項目、預估金額或摘要，但不直接替你核准。"
            >
              <Switch />
            </Form.Item>
          </div>

          {/* Security Settings */}
          <div className="glass-panel p-6">
            <div className="flex items-center gap-3 mb-6">
              <SafetyCertificateOutlined className="text-2xl text-green-500" />
              <Title level={4} className="!m-0">
                安全性設定
              </Title>
            </div>

            <Form.Item
              label="閒置登出時間 (分鐘)"
              name="sessionTimeout"
              rules={[{ required: true, type: "number", min: 5, max: 120 }]}
            >
              <InputNumber className="w-full" />
            </Form.Item>

            <Form.Item
              label="密碼強制更換週期 (天)"
              name="passwordExpiry"
              rules={[{ required: true, type: "number", min: 30, max: 365 }]}
            >
              <InputNumber className="w-full" />
            </Form.Item>
          </div>

          {/* General Settings */}
          <div className="glass-panel p-6">
            <div className="flex items-center gap-3 mb-6">
              <SettingOutlined className="text-2xl text-gray-500" />
              <Title level={4} className="!m-0">
                一般設定
              </Title>
            </div>

            <Form.Item label="系統預設語言" name="language">
              <Select>
                <Option value="zh-TW">繁體中文 (Traditional Chinese)</Option>
                <Option value="en-US">English (US)</Option>
              </Select>
            </Form.Item>
          </div>
        </div>
      </Form>
    </motion.div>
  );
};

export default SystemSettingsPage;
