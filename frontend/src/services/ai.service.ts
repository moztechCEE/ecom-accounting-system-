import api from "./api";

export interface AiModel {
  id: string;
  name: string;
  description?: string;
  isExperimental?: boolean;
  mode?: "standard" | "deep";
}

export interface AiCopilotSource {
  kind: "metric" | "record" | "knowledge";
  title: string;
  detail?: string;
  path?: string;
  sourceVersion?: string;
  sources?: Array<{ path: string; sha256: string }>;
  availability?: 'staged' | 'preview-only' | 'wms-portal';
}

export interface AiStatus {
  available: boolean;
  provider: string;
  reason?: "sandbox_disabled" | "not_configured";
}

export interface AiCopilotReply {
  reply: string;
  status: "answered" | "unavailable" | "unsupported" | "guide";
  checkedAt: string;
  scope?: string;
  code?: string;
  sources?: AiCopilotSource[];
}

export type KnowledgeLocale = "zh-TW" | "en";
export interface AiKnowledgeExample {
  id: string;
  title: string;
  filename: string;
  contentType: string;
  content: string;
}
export interface AiKnowledgeEntry {
  id: string;
  title: string;
  summary: string;
  category: string;
  path?: string;
  keywords?: string[];
  sections: Array<{ title: string; body: string }>;
  examples: AiKnowledgeExample[];
  sources: Array<{ path: string; sha256: string }>;
  sourceVersion: string;
  availability?: 'staged' | 'preview-only' | 'wms-portal';
}
export interface AiKnowledgeLibrary {
  version: string;
  locale: KnowledgeLocale;
  entries: AiKnowledgeEntry[];
  checkedAt: string;
}

export interface DailyBriefingAlert {
  key: string;
  title: string;
  count: number;
  tone: "healthy" | "warning" | "critical";
  helper: string;
}

export const aiService = {
  async getKnowledge(query = "", currentPath?: string, locale: KnowledgeLocale = "zh-TW", signal?: AbortSignal) {
    return (await api.get<AiKnowledgeLibrary>("/ai/knowledge", {
      params: { query, currentPath, locale }, signal,
    })).data;
  },
  async getGuide(query: string, currentPath?: string) {
    return (
      await api.get<AiCopilotReply>("/ai/guide", {
        params: { query, currentPath },
      })
    ).data;
  },
  async getStatus() {
    return (await api.get<AiStatus>("/ai/status")).data;
  },
  async getAvailableModels() {
    const response = await api.get<AiModel[]>("/ai/models");
    return response.data;
  },

  async getDailyBriefing(entityId: string, modelId?: string) {
    const response = await api.post<{
      insight: string;
      alerts: DailyBriefingAlert[];
    }>("/ai/insights/daily-briefing", {
      entityId,
      modelId,
    });
    return response.data;
  },

  async chat(
    message: string,
    entityId?: string,
    modelId?: string,
    currentPath?: string,
    history?: Array<{ role: "user"; content: string }>,
    locale?: KnowledgeLocale,
    signal?: AbortSignal,
  ) {
    const response = await api.post<AiCopilotReply>(
      "/ai/copilot/chat",
      {
        message,
        entityId,
        modelId,
        currentPath,
        history,
        locale,
      },
      { timeout: 60000, signal },
    );
    return response.data;
  },
};
