import React, { useEffect, useRef, useState } from "react";
import { Button, Card, Input, Typography } from "antd";
import {
  BarChartOutlined,
  BulbOutlined,
  CloseOutlined,
  DollarOutlined,
  RobotOutlined,
  SendOutlined,
} from "@ant-design/icons";
import { AnimatePresence, motion } from "framer-motion";
import { aiService } from "../services/ai.service";
import { useAI } from "../contexts/AIContext";

const { Text } = Typography;

interface Message {
  id: string;
  type: "user" | "ai";
  content: React.ReactNode;
  timestamp: Date;
}

const SUGGESTED_PROMPTS = [
  { icon: <BarChartOutlined />, text: "本月銷售總額是多少？" },
  { icon: <BulbOutlined />, text: "昨天支出大概多少？" },
  { icon: <DollarOutlined />, text: "Power Bank 的成本與庫存" },
  { icon: <RobotOutlined />, text: "本月薪資成本是多少？" },
];

const AssistantBadge: React.FC<{ muted?: boolean }> = ({ muted = false }) => (
  <div
    className={`flex h-9 w-9 items-center justify-center rounded-2xl border ${
      muted
        ? "border-slate-200 bg-white text-slate-500"
        : "border-sky-200 bg-sky-50 text-sky-700"
    }`}
  >
    <RobotOutlined />
  </div>
);

const AICopilotWidget: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      type: "ai",
      content:
        "你好，我是 AI 助手。我會先理解你的問題，再用目前系統裡最相關的資料，給你一個直接、簡單的答案。",
      timestamp: new Date(),
    },
  ]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { selectedModelId } = useAI();
  const entityId = import.meta.env.VITE_DEFAULT_ENTITY_ID || "tw-entity-001";

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  const handleSend = async (text: string = inputValue) => {
    if (!text.trim()) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      type: "user",
      content: text,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputValue("");
    setIsTyping(true);

    try {
      const response = await aiService.chat(text, entityId, selectedModelId);
      const aiMsg: Message = {
        id: (Date.now() + 1).toString(),
        type: "ai",
        content: response.reply,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, aiMsg]);
    } catch (error: any) {
      if (error.response?.status !== 401) {
        console.error("AI Chat Error", error);
        setMessages((prev) => [
          ...prev,
          {
            id: (Date.now() + 1).toString(),
            type: "ai",
            content: "抱歉，我現在暫時無法整理資料回覆你，請稍後再試一次。",
            timestamp: new Date(),
          },
        ]);
      }
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <>
      <motion.div
        className="fixed bottom-8 right-8 z-50"
        whileHover={{ scale: 1.04 }}
        whileTap={{ scale: 0.98 }}
      >
        <Button
          type="primary"
          shape="circle"
          size="large"
          className="!h-14 !w-14 !border-0 !shadow-xl"
          style={{
            background: isOpen
              ? "#0f172a"
              : "linear-gradient(135deg, #0f766e 0%, #2563eb 100%)",
          }}
          onClick={() => setIsOpen((prev) => !prev)}
          icon={
            isOpen ? (
              <CloseOutlined className="text-white" />
            ) : (
              <RobotOutlined className="text-white" />
            )
          }
        />
      </motion.div>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 18, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 18, scale: 0.96 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="fixed bottom-28 right-8 z-40 h-[650px] max-h-[80vh] w-[400px] max-w-[calc(100vw-2rem)]"
          >
            <Card
              className="flex h-full flex-col overflow-hidden !rounded-3xl !border-0 !bg-white/95 shadow-2xl backdrop-blur-xl"
              bodyStyle={{
                padding: 0,
                height: "100%",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <div className="border-b border-slate-200 bg-[linear-gradient(135deg,rgba(240,249,255,0.95),rgba(236,253,245,0.9))] px-5 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <AssistantBadge />
                    <div>
                      <div className="text-base font-semibold text-slate-900">
                        AI 助手
                      </div>
                      <div className="mt-1 text-xs leading-relaxed text-slate-500">
                        先理解你的問題，再找資料回答你。
                      </div>
                    </div>
                  </div>
                  <Button
                    type="text"
                    shape="circle"
                    icon={<CloseOutlined className="text-slate-400" />}
                    onClick={() => setIsOpen(false)}
                    className="hover:!bg-white/70"
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.08),transparent_32%),linear-gradient(180deg,#f8fafc_0%,#ffffff_35%)] px-5 py-5">
                <div className="mb-5 rounded-2xl border border-slate-200 bg-white/80 px-4 py-3 text-xs leading-6 text-slate-500">
                  可直接問我銷售、支出、產品成本、庫存或薪資摘要。我會盡量用最短、最清楚的方式回答。
                </div>

                <div className="space-y-5">
                  {messages.map((msg) => (
                    <motion.div
                      key={msg.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`flex ${msg.type === "user" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`flex max-w-[88%] gap-3 ${
                          msg.type === "user" ? "flex-row-reverse" : "flex-row"
                        }`}
                      >
                        {msg.type === "ai" && <AssistantBadge muted />}

                        <div
                          className={`rounded-3xl px-4 py-3 text-[15px] leading-7 ${
                            msg.type === "user"
                              ? "rounded-tr-md bg-slate-900 text-white"
                              : "rounded-tl-md border border-slate-200 bg-white text-slate-700 shadow-sm"
                          }`}
                        >
                          {msg.content}
                        </div>
                      </div>
                    </motion.div>
                  ))}

                  {isTyping && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="flex justify-start"
                    >
                      <div className="flex gap-3">
                        <AssistantBadge muted />
                        <div className="rounded-3xl rounded-tl-md border border-slate-200 bg-white px-4 py-4 shadow-sm">
                          <div className="flex gap-1.5">
                            {[0, 1, 2].map((dot) => (
                              <span
                                key={dot}
                                className="h-2 w-2 rounded-full bg-slate-300 animate-bounce"
                                style={{ animationDelay: `${dot * 140}ms` }}
                              />
                            ))}
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}

                  <div ref={messagesEndRef} />
                </div>
              </div>

              {messages.length === 1 && (
                <div className="border-t border-slate-100 bg-white/90 px-5 py-4">
                  <div className="mb-3 text-xs font-medium tracking-wide text-slate-400">
                    你可以直接這樣問
                  </div>
                  <div className="grid grid-cols-1 gap-2">
                    {SUGGESTED_PROMPTS.map((prompt) => (
                      <motion.button
                        key={prompt.text}
                        whileHover={{ scale: 1.01 }}
                        whileTap={{ scale: 0.99 }}
                        className="flex cursor-pointer items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-left text-sm text-slate-600 transition-colors hover:bg-white"
                        onClick={() => handleSend(prompt.text)}
                      >
                        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-sky-700 shadow-sm">
                          {prompt.icon}
                        </span>
                        <span>{prompt.text}</span>
                      </motion.button>
                    ))}
                  </div>
                </div>
              )}

              <div className="border-t border-slate-200 bg-white px-5 py-4">
                <div className="rounded-[26px] border border-slate-200 bg-slate-50 p-2 transition-all focus-within:border-sky-200 focus-within:bg-white focus-within:shadow-md">
                  <Input.TextArea
                    placeholder="直接描述你想知道的事情"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onPressEnter={(e) => {
                      if (!e.shiftKey) {
                        e.preventDefault();
                        handleSend();
                      }
                    }}
                    autoSize={{ minRows: 1, maxRows: 4 }}
                    className="!resize-none !border-0 !bg-transparent !px-3 !py-2 !text-base !shadow-none focus:!shadow-none"
                    disabled={isTyping}
                  />
                  <div className="mt-2 flex items-center justify-between px-2 pb-1">
                    <Text type="secondary" className="text-[11px] leading-5">
                      重要金額與結論仍請再次確認。
                    </Text>
                    <Button
                      type="text"
                      shape="circle"
                      icon={
                        <SendOutlined
                          className={
                            inputValue.trim()
                              ? "text-sky-600"
                              : "text-slate-300"
                          }
                        />
                      }
                      onClick={() => handleSend()}
                      disabled={isTyping || !inputValue.trim()}
                      className={inputValue.trim() ? "!bg-sky-50" : ""}
                    />
                  </div>
                </div>
              </div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

export default AICopilotWidget;
