/** Static operating guidance. These records never register an executable tool. */
export interface KnowledgeSections {
  steps: string[];
  boundaries: string[];
  /** Entry IDs; resolve and filter through the reader's access policy. */
  related: string[];
}
export interface KnowledgeEntry {
  id: string;
  title: string;
  summary: string;
  category: string;
  keywords: string[];
  module: string;
  group: string;
  path?: string;
  aliases?: string[];
  /** OR within permissions; combined with roles and route access using AND. */
  permissions?: string[];
  roles?: string[];
  availability?: 'staged' | 'wms-portal' | 'preview-only';
  sections: KnowledgeSections;
  translations: {
    en: {
      title: string;
      summary: string;
      category: string;
      keywords: string[];
      sections: KnowledgeSections;
    };
  };
  examples?: { format: 'json' | 'csv'; title: string; titleEn?: string; content: string }[];
  sources: { path: string; sha256: string }[];
  sourceVersion: string;
}
