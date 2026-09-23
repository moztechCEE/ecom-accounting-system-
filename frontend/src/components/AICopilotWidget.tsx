import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Drawer,
  Empty,
  Input,
  Select,
  Spin,
  Tag,
  Tooltip,
} from "antd";
import { ClearOutlined, RobotOutlined, SendOutlined } from "@ant-design/icons";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useAI } from "../contexts/AIContext";
import {
  aiService,
  type AiCopilotReply,
  type AiStatus,
} from "../services/ai.service";
import { listEntities, type Entity } from "../services/entities.service";
import { hasAnyPermission } from "../utils/access";
import "./AICopilotWidget.css";

type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  result?: AiCopilotReply;
};
const quickPrompts = [
  "這個頁面可以做什麼？",
  "如何申請費用並交給主管審核？",
  "如何設定人員能看到的功能？",
];
const unavailableReason = (status: AiStatus) =>
  status.reason === "sandbox_disabled"
    ? "這個測試環境尚未開放 AI 連線。可先使用下方功能入口；AI 問答與即時查詢尚未啟用。"
    : "AI 尚未完成連線設定，請管理員完成設定後使用。";

export default function AICopilotWidget() {
  const { user } = useAuth();
  const currentUserId = user?.id;
  const { selectedModelId, setSelectedModelId, availableModels } = useAI();
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [entityId, setEntityId] = useState<string | undefined>();
  const [error, setError] = useState("");
  const sequence = useRef(0);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    sequence.current += 1;
    setMessages([]);
    setInput("");
    setLoading(false);
    setError("");
  }, [currentUserId, entityId]);

  useEffect(() => {
    if (!open || !currentUserId) return;
    let cancelled = false;
    aiService
      .getStatus()
      .then((result) => {
        if (!cancelled) setStatus(result);
      })
      .catch(() => {
        if (!cancelled) {
          setStatus(null);
          setError("無法確認 AI 連線狀態，請重新開啟助手。");
        }
      });
    listEntities({ isActive: true })
      .then((result) => {
        if (cancelled) return;
        setEntities(result);
        setEntityId((current) =>
          result.some((entity) => entity.id === current)
            ? current
            : result.find(
                (entity) => entity.id === localStorage.getItem("entityId"),
              )?.id || result[0]?.id,
        );
      })
      .catch(() => {
        if (!cancelled) {
          setEntities([]);
          setEntityId(undefined);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, currentUserId]);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loading]);

  const send = async (question = input) => {
    const text = question.trim();
    if (!text || loading || status?.available === false) return;
    const requestSequence = ++sequence.current;
    const history = messages
      .filter((message) => message.role === "user")
      .slice(-6)
      .map((message) => ({ role: "user" as const, content: message.content }));
    setMessages((current) => [
      ...current,
      { id: Date.now(), role: "user", content: text },
    ]);
    setInput("");
    setLoading(true);
    setError("");
    try {
      const result = await aiService.chat(
        text,
        entityId,
        selectedModelId,
        location.pathname,
        history,
      );
      if (sequence.current !== requestSequence) return;
      setMessages((current) => [
        ...current,
        {
          id: Date.now() + 1,
          role: "assistant",
          content: result.reply,
          result,
        },
      ]);
    } catch (failure: unknown) {
      if (sequence.current !== requestSequence) return;
      const response = (failure as { response?: { status?: number } }).response;
      const content =
        response?.status === 403
          ? "目前沒有這個公司或資料範圍的查詢權限。請切換公司，或由管理員確認你的權限。"
          : response?.status === 400
            ? "查詢條件無法使用，請縮短問題或指定一年以內的有效日期區間。"
            : "AI 或資料查詢暫時無法完成，請稍後再試。";
      setMessages((current) => [
        ...current,
        { id: Date.now() + 1, role: "assistant", content },
      ]);
    } finally {
      if (sequence.current === requestSequence) setLoading(false);
    }
  };

  const showGuide = async (query: string) => {
    const requestSequence = ++sequence.current;
    setLoading(true);
    setError("");
    try {
      const result = await aiService.getGuide(query, location.pathname);
      if (sequence.current === requestSequence)
        setMessages((current) => [
          ...current,
          { id: Date.now(), role: "assistant", content: result.reply, result },
        ]);
    } catch {
      if (sequence.current === requestSequence)
        setError("無法讀取內建指南，請稍後再試。");
    } finally {
      if (sequence.current === requestSequence) setLoading(false);
    }
  };

  const links = [
    {
      label: "費用申請",
      path: "/ap/expenses",
      permissions: [
        "expense_self:read",
        "purchase_orders:read",
        "accounts:read",
      ],
    },
    {
      label: "權限管理",
      path: "/admin/access-control",
      permissions: ["access_control:read", "access_control:update"],
    },
    { label: "個人資料", path: "/profile", permissions: ["profile_self:read"] },
  ].filter((link) => hasAnyPermission(user, link.permissions));

  if (!user) return null;
  return (
    <>
      <Tooltip title="詢問 ERP 操作與即時資料" placement="left">
        <button
          className="erp-copilot-launcher"
          aria-label="開啟 ERP Copilot"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          <RobotOutlined />
          <span>Copilot</span>
        </button>
      </Tooltip>
      <Drawer
        title={
          <span>
            <RobotOutlined /> ERP Copilot
          </span>
        }
        open={open}
        onClose={() => setOpen(false)}
        width="min(440px, 100vw)"
        className="erp-copilot-drawer"
        extra={
          <Button
            type="text"
            icon={<ClearOutlined />}
            aria-label="清除 Copilot 對話"
            disabled={loading}
            onClick={() => {
              sequence.current += 1;
              setMessages([]);
              setError("");
            }}
          />
        }
      >
        <div className="erp-copilot-context">
          <p>詢問怎麼操作，或查詢你有權限的資料。</p>
          <Select
            aria-label="Copilot 查詢公司"
            value={entityId}
            placeholder="選擇查詢公司"
            allowClear
            disabled={loading}
            onChange={setEntityId}
            options={entities.map((entity) => ({
              value: entity.id,
              label: entity.name,
            }))}
          />
          <Select
            aria-label="Copilot AI 模式"
            value={selectedModelId}
            disabled={loading || availableModels.length === 0}
            onChange={setSelectedModelId}
            options={availableModels.map((model) => ({
              value: model.id,
              label: model.name,
            }))}
          />
          <span className="erp-copilot-caption">
            操作指南 · 唯讀查詢 · 不會自動審批或付款
          </span>
        </div>
        {status?.available === false && (
          <Alert type="info" showIcon message={unavailableReason(status)} />
        )}
        {error && <Alert type="warning" showIcon message={error} />}
        <div className="erp-copilot-links">
          <Button
            size="small"
            disabled={loading}
            onClick={() => void showGuide("這個頁面可以做什麼？")}
          >
            內建操作指南
          </Button>
          {links.map((link) => (
            <Button
              key={link.path}
              size="small"
              onClick={() => {
                navigate(link.path);
                setOpen(false);
              }}
            >
              {link.label}
            </Button>
          ))}
        </div>
        {status?.available === false && (
          <div className="erp-copilot-links">
            {["費用申請", "主管審核", "權限管理"].map((topic) => (
              <Button
                key={topic}
                size="small"
                disabled={loading}
                onClick={() => void showGuide(topic)}
              >
                {topic}指南
              </Button>
            ))}
          </div>
        )}
        <div
          className="erp-copilot-messages"
          role="log"
          aria-live="polite"
          aria-label="Copilot 對話"
        >
          {!messages.length && (
            <>
              <Empty
                image={
                  <RobotOutlined style={{ fontSize: 40, color: "#468276" }} />
                }
                description="從一個問題開始"
              />
              <div className="erp-copilot-prompts">
                {[
                  ...quickPrompts,
                  ...(hasAnyPermission(user, [
                    "expense_self:read",
                    "accounts:read",
                    "purchase_orders:read",
                  ])
                    ? ["本月我的費用申請總額是多少？"]
                    : []),
                ].map((prompt) => (
                  <Button
                    key={prompt}
                    disabled={loading || status?.available === false}
                    onClick={() => void send(prompt)}
                  >
                    {prompt}
                  </Button>
                ))}
              </div>
            </>
          )}
          {messages.map((message) => (
            <article
              key={message.id}
              className={`erp-copilot-message erp-copilot-message--${message.role}`}
            >
              <strong>
                {message.role === "user"
                  ? "你"
                  : message.result?.status === "guide"
                    ? "內建操作指南"
                    : "Copilot"}
              </strong>
              {message.result?.status === "unavailable" && (
                <Tag color="orange">尚未完成</Tag>
              )}
              <p>{message.content}</p>
              {message.result?.sources?.map((source, index) => (
                <div
                  className="erp-copilot-source"
                  key={`${source.title}-${index}`}
                >
                  {source.path && /^\/[a-zA-Z0-9/_-]*$/.test(source.path) ? (
                    <Button
                      type="link"
                      size="small"
                      onClick={() => {
                        navigate(source.path!);
                        setOpen(false);
                      }}
                    >
                      {source.title}
                    </Button>
                  ) : (
                    <span>{source.title}</span>
                  )}
                  <small>
                    {source.kind === "knowledge" ? "內建指南" : "即時資料查詢"}{" "}
                    · {source.detail}
                  </small>
                </div>
              ))}
              {message.result && (
                <small className="erp-copilot-caption">
                  {message.result.scope ? `${message.result.scope} · ` : ""}
                  {new Date(message.result.checkedAt).toLocaleString("zh-TW", {
                    hour12: false,
                  })}
                </small>
              )}
            </article>
          ))}
          {loading && (
            <div className="erp-copilot-thinking">
              <Spin size="small" /> 正在確認權限並整理資料…
            </div>
          )}
          <div ref={end} />
        </div>
        <form
          className="erp-copilot-composer"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <Input.TextArea
            aria-label="詢問 ERP Copilot"
            placeholder="輸入問題，例如：怎麼申請費用？"
            value={input}
            maxLength={2000}
            autoSize={{ minRows: 2, maxRows: 5 }}
            disabled={loading || status?.available === false}
            onChange={(event) => setInput(event.target.value)}
            onPressEnter={(event) => {
              if (!event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void send();
              }
            }}
          />
          <Button
            type="primary"
            htmlType="submit"
            icon={<SendOutlined />}
            loading={loading}
            disabled={!input.trim() || status?.available === false}
          >
            送出
          </Button>
        </form>
      </Drawer>
    </>
  );
}
