import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { KNOWLEDGE_ENTRIES, type KnowledgeEntry } from './knowledge';

export type AiKnowledgeLocale = 'zh-TW' | 'en';
export interface AiKnowledgeEntry {
  id: string;
  title: string;
  summary: string;
  category: string;
  keywords: string[];
  path?: string;
  availability?: KnowledgeEntry['availability'];
  sections: Array<{ title: string; body: string }>;
  examples: Array<{
    id: string;
    title: string;
    filename: string;
    contentType: string;
    content: string;
  }>;
  sources: Array<{ path: string; sha256: string }>;
  sourceVersion: string;
}
export interface AiKnowledgeLibrary {
  version: string;
  locale: AiKnowledgeLocale;
  entries: AiKnowledgeEntry[];
  checkedAt: string;
}

@Injectable()
export class AiKnowledgeService {
  readonly version = `erp-claw-${createHash('sha256').update(JSON.stringify(KNOWLEDGE_ENTRIES)).digest('hex').slice(0, 16)}`;

  // Authorization precedes ranking and localization. A caller that omits the
  // server policy sees nothing; a page hint or model query never grants access.
  search(
    query: string,
    limit = 5,
    currentPath?: string,
    locale: AiKnowledgeLocale = 'zh-TW',
    canRead: (entry: KnowledgeEntry) => boolean = () => false,
  ): AiKnowledgeEntry[] {
    const authorized = KNOWLEDGE_ENTRIES.filter(canRead);
    const entries = authorized.map((entry) =>
      this.localize(entry, locale, authorized),
    );
    const tokens = this.tokenize(query);
    const path = currentPath?.split('?')[0];
    const scored = entries.map((entry, index) => ({
      entry,
      score:
        Math.max(
          this.score(entry, tokens),
          this.score(
            this.localize(
              authorized[index],
              locale === 'en' ? 'zh-TW' : 'en',
              authorized,
            ),
            tokens,
          ),
        ) +
        (path &&
        (entry.path?.split('?')[0] === path ||
          authorized[index].aliases?.includes(path))
          ? 1
          : 0),
    }));
    return scored
      .filter((item) => !tokens.length || item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(0, Math.min(limit, 512)))
      .map((item) => item.entry);
  }

  private localize(
    entry: KnowledgeEntry,
    locale: AiKnowledgeLocale,
    authorized: KnowledgeEntry[],
  ): AiKnowledgeEntry {
    const text = locale === 'en' ? entry.translations.en : entry;
    const related = text.sections.related.flatMap((id) => {
      const found = authorized.find((candidate) => candidate.id === id);
      if (!found) return [];
      const title = locale === 'en' ? found.translations.en.title : found.title;
      return [title + (found.path ? ` (${found.path})` : '')];
    });
    const availability =
      entry.availability === 'staged'
        ? locale === 'en'
          ? 'This is a staged feature guide. It may not be enabled in the current environment; an accessible guide does not mean the feature is active.'
          : '這是分階段開放功能的操作指南，目前環境可能尚未啟用；能閱讀指南不表示功能已開放。'
        : entry.availability === 'wms-portal'
          ? locale === 'en'
            ? 'Warehouse portal access requires an enabled connection and current warehouse authorization. This guide does not verify connection or completed warehouse work.'
            : '儲運入口需已啟用串接並通過目前儲運權限檢查；本指南不代表已確認連線或完成倉庫作業。'
          : '';
    const sections = [
      {
        title: locale === 'en' ? 'Steps' : '操作步驟',
        body: text.sections.steps.join('\n'),
      },
      {
        title: locale === 'en' ? 'Scope and limits' : '適用範圍與限制',
        body: [...text.sections.boundaries, availability]
          .filter(Boolean)
          .join('\n'),
      },
      {
        title: locale === 'en' ? 'Related guides' : '相關指南',
        body: related.join('\n'),
      },
    ].filter((section) => section.body);
    return {
      id: entry.id,
      title: text.title,
      summary: text.summary,
      category: text.category,
      keywords: [...text.keywords],
      path: entry.path,
      availability: entry.availability,
      sections,
      examples: (entry.examples || []).map((example, index) => ({
        id: `${entry.id}-${index + 1}`,
        title:
          locale === 'en' ? example.titleEn || example.title : example.title,
        filename: `${entry.id}-${index + 1}.${example.format}`,
        contentType:
          example.format === 'json' ? 'application/json' : 'text/csv',
        content: example.content,
      })),
      sources: entry.sources.map((source) => ({ ...source })),
      sourceVersion: entry.sourceVersion,
    };
  }

  private score(entry: AiKnowledgeEntry, tokens: string[]): number {
    const title = entry.title.toLowerCase();
    const body = [
      entry.summary,
      entry.category,
      ...entry.sections.map((section) => section.body),
    ]
      .join(' ')
      .toLowerCase();
    return tokens.reduce(
      (score, token) =>
        score +
        (entry.keywords.some(
          (keyword) =>
            keyword.toLowerCase().includes(token) ||
            token.includes(keyword.toLowerCase()),
        )
          ? 5
          : 0) +
        (title.includes(token) ? 4 : 0) +
        (body.includes(token) ? 2 : 0),
      0,
    );
  }

  private tokenize(text: string): string[] {
    const normalized = text.toLowerCase().replace(/[^\p{L}\p{N}/-]+/gu, ' ');
    const words = [
      ...new Intl.Segmenter('zh-TW', { granularity: 'word' }).segment(
        normalized,
      ),
    ]
      .filter((segment) => segment.isWordLike)
      .map((segment) => segment.segment);
    const stopwords = new Set([
      '如何',
      '怎麼',
      '使用',
      '什麼',
      '這頁',
      '這個',
      '可以',
      '請問',
      '能否',
      '想要',
      'how',
      'do',
      'to',
      'the',
      'this',
      'page',
      'can',
      'what',
      'use',
      'is',
      'i',
    ]);
    return [...new Set([...normalized.split(/\s+/), ...words])]
      .map((token) => token.trim())
      .filter((token) => token.length >= 2 && !stopwords.has(token));
  }
}
