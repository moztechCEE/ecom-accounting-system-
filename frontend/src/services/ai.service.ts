import api from "./api";

export interface AiModel {
  id: string;
  name: string;
  description?: string;
  isExperimental?: boolean;
}

export interface AiCopilotSource {
  kind: "metric" | "record" | "knowledge";
  title: string;
  detail?: string;
  path?: string;
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

export interface DailyBriefingAlert {
  key: string;
  title: string;
  count: number;
  tone: "healthy" | "warning" | "critical";
  helper: string;
}

export const aiService = {
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
  ) {
    const response = await api.post<AiCopilotReply>(
      "/ai/copilot/chat",
      {
        message,
        entityId,
        modelId,
        currentPath,
        history,
      },
      { timeout: 60000 },
    );
    return response.data;
  },
};
