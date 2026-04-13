import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import {
  AI_AGENT_CORE_PRINCIPLES,
  AI_AGENT_RESPONSE_STYLE,
} from '../ai/ai-principles';

@Injectable()
export class ExpenseIntelligenceService {
  private readonly logger = new Logger(ExpenseIntelligenceService.name);
  private genAI: GoogleGenerativeAI;
  private model: GenerativeModel;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    if (apiKey) {
      this.genAI = new GoogleGenerativeAI(apiKey);
      this.model = this.genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    } else {
      this.logger.warn(
        'GEMINI_API_KEY not found. AI features will be disabled.',
      );
    }
  }

  async analyzeFinancialReport(reportContext: string, data: any): Promise<any> {
    if (!this.model) {
      return { analysis: 'AI service not configured.' };
    }

    try {
      const prompt = `
        ${AI_AGENT_CORE_PRINCIPLES}
        ${AI_AGENT_RESPONSE_STYLE}

        Role:
        You are a financial analyst for an e-commerce company.

        Context:
        Analyze the following financial data context: "${reportContext}".

        Data:
        ${JSON.stringify(data, null, 2)}

        Task:
        Summarize only the most important insights, anomalies, and optimization suggestions.
        Keep each point clear and practical.

        Return valid raw JSON with keys: "insights", "anomalies", "suggestions".
        Do not include markdown code blocks.
      `;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();

      // Attempt to clean markdown if present (e.g. ```json ... ```)
      const cleaned = text
        .replace(/```json/g, '')
        .replace(/```/g, '')
        .trim();

      return JSON.parse(cleaned);
    } catch (error) {
      this.logger.error('Failed to generate AI analysis', error);
      return { error: 'Failed to generate analysis', details: error.message };
    }
  }
}
