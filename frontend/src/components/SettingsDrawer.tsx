import React from "react";
import { Switch, Typography, Space, Select } from "antd";
import { GlassDrawer, GlassDrawerSection } from "./ui/GlassDrawer";
import { useTheme } from "../contexts/ThemeContext";
import { useAI } from "../contexts/AIContext";
import {
  BulbOutlined,
  BulbFilled,
  CheckCircleFilled,
  RobotOutlined,
} from "@ant-design/icons";

const { Text } = Typography;

interface SettingsDrawerProps {
  open: boolean;
  onClose: () => void;
}

const SettingsDrawer: React.FC<SettingsDrawerProps> = ({ open, onClose }) => {
  const { mode, toggleMode, primaryColor, setPrimaryColor } = useTheme();
  const {
    selectedModelId,
    setSelectedModelId,
    availableModels,
    loading: aiLoading,
  } = useAI();
  const selectedMode = availableModels.find(
    (model) => model.id === selectedModelId,
  );

  const colors = [
    { name: "Classic Black", value: "black", hex: "#000000" },
    { name: "Tech Blue", value: "blue", hex: "#1677ff" },
    { name: "Royal Purple", value: "purple", hex: "#722ed1" },
    { name: "Fresh Green", value: "green", hex: "#52c41a" },
    { name: "Warm Orange", value: "orange", hex: "#fa8c16" },
  ];

  return (
    <GlassDrawer
      title="介面設定 (Interface Settings)"
      placement="right"
      onClose={onClose}
      open={open}
      width={380}
    >
      <div className="space-y-4">
        {/* Theme Mode */}
        <GlassDrawerSection>
          <div className="mb-4 font-semibold text-slate-800">
            外觀模式 (Appearance)
          </div>
          <div className="bg-white/40 p-1 rounded-xl flex border border-white/20">
            <button
              onClick={() => mode === "dark" && toggleMode()}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                mode === "light"
                  ? "bg-white shadow-sm text-gray-900"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              <Space>
                <BulbOutlined /> 淺色 Light
              </Space>
            </button>
            <button
              onClick={() => mode === "light" && toggleMode()}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                mode === "dark"
                  ? "bg-gray-700 shadow-sm text-white"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              <Space>
                <BulbFilled /> 深色 Dark
              </Space>
            </button>
          </div>
        </GlassDrawerSection>

        {/* Primary Color */}
        <GlassDrawerSection>
          <div className="mb-4 font-semibold text-slate-800">
            主題色系 (Accent Color)
          </div>
          <div className="grid grid-cols-5 gap-2">
            {colors.map((color) => (
              <button
                key={color.value}
                onClick={() => setPrimaryColor(color.value as any)}
                className="w-10 h-10 rounded-full flex items-center justify-center transition-transform hover:scale-110 relative"
                style={{ backgroundColor: color.hex }}
                title={color.name}
              >
                {primaryColor === color.value && (
                  <CheckCircleFilled className="text-white text-lg drop-shadow-md" />
                )}
              </button>
            ))}
          </div>
          <Text type="secondary" className="block mt-2 text-xs">
            選擇您喜好的系統主色調
          </Text>
        </GlassDrawerSection>

        {/* AI Settings */}
        <GlassDrawerSection>
          <div className="mb-4 font-semibold text-slate-800 flex items-center gap-2">
            <RobotOutlined className="text-sky-600" /> AI 助手
          </div>
          <div className="mb-2 rounded-xl border border-sky-100/80 bg-gradient-to-br from-sky-50/80 to-emerald-50/70 p-4">
            <Text className="block mb-2 text-sm font-medium text-gray-700">
              助手工作模式
            </Text>
            <Text type="secondary" className="block mb-3 text-xs leading-6">
              平常使用建議維持標準模式；真的需要較深入分析時，再切到深度模式即可。
            </Text>
            <Select
              className="w-full"
              size="large"
              loading={aiLoading}
              value={selectedModelId}
              onChange={setSelectedModelId}
              options={availableModels.map((model) => ({
                label: model.name,
                value: model.id,
              }))}
            />
            <Text type="secondary" className="block mt-3 text-xs leading-6">
              目前模式：{selectedMode?.name || "標準模式"}
              {selectedMode?.description ? `，${selectedMode.description}` : ""}
            </Text>
          </div>
          <div className="rounded-xl border border-slate-200/70 bg-white/50 px-4 py-3 text-xs leading-6 text-slate-500">
            這個設定會套用到全系統的 AI
            輔助功能。原則是少即是多，能簡單回答就不把事情複雜化。
          </div>
        </GlassDrawerSection>

        {/* Other Settings Placeholder */}
        <GlassDrawerSection>
          <div className="mb-4 font-semibold text-slate-800">
            顯示設定 (Display)
          </div>
          <div className="flex items-center justify-between mb-4">
            <Text>緊湊模式 (Compact Mode)</Text>
            <Switch size="small" />
          </div>
          <div className="flex items-center justify-between">
            <Text>減少動畫 (Reduce Motion)</Text>
            <Switch size="small" />
          </div>
        </GlassDrawerSection>
      </div>
    </GlassDrawer>
  );
};

export default SettingsDrawer;
