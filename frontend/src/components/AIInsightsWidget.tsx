import React, { useEffect, useState } from "react";
import { Button, Card, Skeleton, Typography } from "antd";
import { ReloadOutlined, RobotOutlined } from "@ant-design/icons";
import { motion } from "framer-motion";
import { aiService } from "../services/ai.service";
import { useAI } from "../contexts/AIContext";

const { Text } = Typography;

const AIInsightsWidget: React.FC = () => {
  const [insight, setInsight] = useState("");
  const [loading, setLoading] = useState(true);
  const { selectedModelId } = useAI();
  const entityId = import.meta.env.VITE_DEFAULT_ENTITY_ID || "tw-entity-001";

  const fetchInsight = async () => {
    setLoading(true);
    try {
      const data = await aiService.getDailyBriefing(entityId, selectedModelId);
      setInsight(data.insight);
    } catch (error: any) {
      if (error.response?.status !== 401) {
        console.error("Failed to fetch AI insight", error);
        setInsight("暫時無法整理昨日重點，請稍後再試。");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInsight();
  }, [selectedModelId]);

  return (
    <motion.div
      initial={{ opacity: 0, y: -16 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-6"
    >
      <Card
        className="overflow-hidden !rounded-3xl border border-slate-200 bg-white/90 shadow-sm"
        bodyStyle={{ padding: 0 }}
      >
        <div className="bg-[linear-gradient(135deg,rgba(239,246,255,0.95),rgba(236,253,245,0.95))] px-6 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-sky-200 bg-white text-sky-700 shadow-sm">
                <RobotOutlined />
              </div>
              <div>
                <div className="text-sm font-semibold tracking-wide text-slate-900">
                  昨日重點
                </div>
                <div className="mt-1 text-xs leading-6 text-slate-500">
                  AI 依昨天的銷售與支出資料，幫你先整理出一個最重要的訊號。
                </div>
              </div>
            </div>
            <Button
              type="text"
              icon={<ReloadOutlined />}
              onClick={fetchInsight}
              loading={loading}
              className="hover:!bg-white/70"
            />
          </div>
        </div>

        <div className="px-6 py-5">
          <Skeleton
            active
            loading={loading}
            paragraph={{ rows: 1 }}
            title={false}
          >
            <Text className="text-[15px] leading-8 text-slate-700">
              {insight}
            </Text>
          </Skeleton>
        </div>
      </Card>
    </motion.div>
  );
};

export default AIInsightsWidget;
