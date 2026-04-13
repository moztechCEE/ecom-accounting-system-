import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface AiModel {
  id: string;
  name: string;
  description?: string;
  isExperimental?: boolean;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly apiKey: string;

  // Default supported models - this can be moved to DB later for full dynamic control
  private readonly supportedModels: AiModel[] = [
    {
      id: 'gemini-1.5-flash',
      name: '標準模式',
      description: '速度較快，適合日常問答與建議',
    },
    {
      id: 'gemini-1.5-pro',
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

  getAvailableModels(): AiModel[] {
    return this.supportedModels;
  }

  async generateContent(
    prompt: string,
    modelId: string = 'gemini-1.5-flash',
  ): Promise<string | null> {
    if (!this.apiKey) {
      this.logger.warn('Attempted to use AI without API Key');
      return null;
    }

    try {
      // Use v1 API; some models return 404 on v1beta for generateContent.
      const url = `https://generativelanguage.googleapis.com/v1/models/${modelId}:generateContent?key=${this.apiKey}`;

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      });

      if (!response.ok) {
        const raw = await response.text().catch(() => '');
        throw new Error(
          `AI API Error: ${response.status} ${response.statusText}${raw ? ` - ${raw}` : ''}`,
        );
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

      return text || null;
    } catch (error) {
      this.logger.error(`AI Generation failed for model ${modelId}`, error);
      throw error;
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
