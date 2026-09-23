import React, { createContext, useContext, useState, useEffect } from "react";
import { aiService, type AiModel } from "../services/ai.service";
import { useAuth } from "./AuthContext";
import { aiModelMode, readModelPreference, resolveAiModel } from "./ai-model-selection";

interface AIContextType {
  selectedModelId: string | undefined;
  setSelectedModelId: (id: string) => void;
  availableModels: AiModel[];
  loading: boolean;
}

const AIContext = createContext<AIContextType | undefined>(undefined);

export const AIProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  return <ScopedAIProvider key={user?.id ?? 'anonymous'} userId={user?.id}>{children}</ScopedAIProvider>;
};

function ScopedAIProvider({ children, userId }: { children: React.ReactNode; userId?: string }) {
  const [preference, setPreference] = useState(() => readModelPreference(
    localStorage.getItem("ai_selected_model"), localStorage.getItem("ai_selected_mode"),
  ));
  const [catalog, setCatalog] = useState<{ userId: string; models: AiModel[] } | null>(null);
  // Ignore another account's catalog synchronously, before the new request finishes.
  const availableModels = userId && catalog?.userId === userId ? catalog.models : [];
  const selectedModelId = resolveAiModel(availableModels, preference)?.id;
  const loading = Boolean(userId && catalog?.userId !== userId);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    aiService.getAvailableModels().then(models => {
      if (!cancelled) setCatalog({ userId, models });
    }).catch(() => {
      // Authentication redirects are handled by the API client. Never retain a stale model ID.
      if (!cancelled) setCatalog({ userId, models: [] });
    });
    return () => { cancelled = true; };
  }, [userId]);

  const setSelectedModelId = (id: string) => {
    const model = availableModels.find(candidate => candidate.id === id);
    if (!model) return;
    const mode = aiModelMode(model);
    setPreference({ id: model.id, mode });
    localStorage.setItem("ai_selected_model", model.id);
    if (mode) localStorage.setItem("ai_selected_mode", mode);
    else localStorage.removeItem("ai_selected_mode");
  };

  return <AIContext.Provider value={{ selectedModelId, setSelectedModelId, availableModels, loading }}>
    {children}
  </AIContext.Provider>;
}

// Keep the existing provider/hook import contract used across ERP pages.
// eslint-disable-next-line react-refresh/only-export-components
export const useAI = () => {
  const context = useContext(AIContext);
  if (context === undefined) throw new Error("useAI must be used within an AIProvider");
  return context;
};
