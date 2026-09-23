import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface AiModel {
  id: string;
  name: string;
  description?: string;
  isExperimental?: boolean;
  mode?: 'standard' | 'deep';
}

const DEFAULT_STANDARD_MODEL = 'gemini-3.5-flash-lite';
const DEFAULT_DEEP_MODEL = 'gemini-3.5-flash';

const LEGACY_MODEL_ALIASES: Record<string, string> = {
  'gemini-1.5-flash': DEFAULT_STANDARD_MODEL,
  'gemini-1.5-pro': DEFAULT_DEEP_MODEL,
  'gemini-2.0-flash': DEFAULT_STANDARD_MODEL,
  'gemini-2.5-flash': DEFAULT_STANDARD_MODEL,
  'gemini-2.5-pro': DEFAULT_DEEP_MODEL,
};

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly apiKey: string;

  // Default supported models - this can be moved to DB later for full dynamic control
  private readonly supportedModels: AiModel[] = [
    {
      id: DEFAULT_STANDARD_MODEL,
      mode: 'standard',
      name: '標準模式',
      description: '速度較快，適合日常問答與建議',
    },
    {
      id: DEFAULT_DEEP_MODEL,
      mode: 'deep',
      name: '深度模式',
      description: '思考較深，適合分析與判斷',
    },
  ];

  constructor(private configService: ConfigService) {
    this.apiKey = this.configService.get<string>('GEMINI_API_KEY') || '';
    if (!this.apiKey) {
      this.logger.warn(
        'GEMINI_API_KEY is not set. AI features will be disabled.',
      );
    }
  }

  getStatus() {
    const sandbox =
      this.configService.get<string>('ERP_DEV_SANDBOX') === 'true';
    const sandboxDisabled =
      sandbox &&
      this.configService.get<string>('ERP_DEV_AI_ENABLED') !== 'true';
    return {
      available: Boolean(this.apiKey) && !sandboxDisabled,
      provider: 'Gemini',
      reason: sandboxDisabled
        ? 'sandbox_disabled'
        : !this.apiKey
          ? 'not_configured'
          : undefined,
    };
  }

  getAvailableModels(): AiModel[] {
    return this.supportedModels;
  }

  resolveModelId(modelId?: string): string {
    if (!modelId) {
      return DEFAULT_STANDARD_MODEL;
    }

    const normalizedModelId = LEGACY_MODEL_ALIASES[modelId] || modelId;
    const isSupportedModel = this.supportedModels.some(
      (model) => model.id === normalizedModelId,
    );

    if (!isSupportedModel) {
      this.logger.warn(
        `Unsupported Gemini model "${modelId}" requested. Falling back to ${DEFAULT_STANDARD_MODEL}.`,
      );
      return DEFAULT_STANDARD_MODEL;
    }

    if (normalizedModelId !== modelId) {
      this.logger.log(
        `Mapped legacy Gemini model "${modelId}" to "${normalizedModelId}".`,
      );
    }

    return normalizedModelId;
  }

  async generateContent(
    prompt: string,
    modelId?: string,
  ): Promise<string | null> {
    if (!this.getStatus().available) {
      this.logger.warn('Attempted to use AI without API Key');
      return null;
    }

    const resolvedModelId = this.resolveModelId(modelId);

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${resolvedModelId}:generateContent`;

      const response = await fetch(url, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(25000),
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.apiKey,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      });

      if (!response.ok) {
        // Provider bodies may contain request data; expose only a diagnostic status.
        throw new Error(`provider_http_${response.status}`);
      }

      const data = (await response.json()) as {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: unknown; thought?: boolean }> };
        }>;
      };
      const parts = data.candidates?.[0]?.content?.parts;
      // A response can contain several text parts alongside thought summaries
      // or non-text parts. Only assemble the public answer, preserving its order.
      const text = Array.isArray(parts)
        ? parts
            .filter(
              (part) =>
                typeof part?.text === 'string' &&
                (part.thought === undefined || part.thought === false),
            )
            .map((part) => part.text)
            .join('')
        : '';

      return text || null;
    } catch (error) {
      const code =
        error instanceof Error && /^provider_http_\d{3}$/.test(error.message)
          ? error.message
          : error instanceof Error &&
              ['TimeoutError', 'AbortError'].includes(error.name)
            ? 'provider_timeout'
            : 'provider_unavailable';
      this.logger.error(
        `AI Generation failed for model ${resolvedModelId}: ${code}`,
      );
      throw new ServiceUnavailableException({
        message: 'AI 服務暫時無法連線，請稍後再試',
        code,
      });
    }
  }

  /**
   * Helper to parse JSON response from AI which might be wrapped in markdown code blocks
   */
  parseJsonOutput<T>(text: string): T | null {
    try {
      const jsonString = text
        .replace(/```json/g, '')
        .replace(/```/g, '')
        .trim();
      return JSON.parse(jsonString) as T;
    } catch (error) {
      this.logger.error('Failed to parse AI JSON output', error);
      return null;
    }
  }
}
