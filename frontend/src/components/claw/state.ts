import type { User } from '../../types';
import type { AiKnowledgeEntry, AiKnowledgeExample } from '../../services/ai.service';

type ScopeUser = User & {
  entityIds?: string[];
  entityMemberships?: Array<{ entityId: string; isPrimary?: boolean; entity?: { isActive?: boolean } }>;
  employee?: { id?: string; entityId?: string; departmentId?: string; isActive?: boolean };
};

/** A permission change invalidates displayed answers as well as pending requests. */
export function clawScopeKey(user: ScopeUser): string {
  return JSON.stringify({
    id: user.id,
    roles: [...user.roles].sort(),
    permissions: [...user.permissions].sort(),
    entities: [...(user.entityIds ?? [])].sort(),
    memberships: (user.entityMemberships ?? []).map(m => [m.entityId, m.isPrimary, m.entity?.isActive]).sort(),
    employee: user.employee ? [user.employee.id, user.employee.entityId, user.employee.departmentId, user.employee.isActive] : null,
    scopes: [user.employeeDataScope, user.attendanceDataScope, user.payrollDataScope,
      user.accountingDataScope, user.inventoryDataScope, user.salesDataScope,
      user.purchasingDataScope, user.bankingDataScope],
  });
}

/** Only authored in-app paths may be used as navigation, never URLs from prompts. */
export function safeGuidePath(path: unknown): string | null {
  return typeof path === 'string' && /^\/[a-zA-Z0-9/_-]*$/.test(path) && !path.startsWith('//')
    ? path : null;
}

export function guideDestination(entry: { path?: string; availability?: string }, staged: boolean): string | null {
  return entry.availability === 'staged' && !staged ? null : safeGuidePath(entry.path);
}

export function selectedArticle(entries: AiKnowledgeEntry[], id: string | null) {
  return entries.find(entry => entry.id === id) ?? null;
}

export function currentPageArticle(entries: AiKnowledgeEntry[], currentPath: string) {
  return entries.filter(entry => {
    const path = safeGuidePath(entry.path);
    return path && (path === currentPath || currentPath.startsWith(`${path}/`));
  }).sort((a, b) => (b.path?.length ?? 0) - (a.path?.length ?? 0))[0] ?? null;
}

export function currentKnowledge<T>(result: { key: string; data?: T } | null, key: string): T | undefined {
  return result?.key === key ? result.data : undefined;
}

/** Leave normal tab movement to the browser; wrap only at a mobile dialog boundary. */
export function focusWrapIndex(count: number, currentIndex: number, backwards: boolean): number | null {
  if (count < 1) return null;
  if (backwards && currentIndex <= 0) return count - 1;
  if (!backwards && (currentIndex === count - 1 || currentIndex < 0)) return 0;
  return null;
}

export function guideCategories(entries: AiKnowledgeEntry[]): string[] {
  return [...new Set(entries.map(entry => entry.category).filter(Boolean))];
}

/** Downloads are inert synthetic files. Reject path traversal and active file formats. */
export function safeExample(example: AiKnowledgeExample): AiKnowledgeExample | null {
  const type = example.contentType.split(';')[0].trim().toLowerCase();
  const extension = type === 'application/json' ? '.json' : type === 'text/csv' ? '.csv' : null;
  if (!extension || !example.filename.toLowerCase().endsWith(extension)
      || /[\\/]/.test(example.filename) || [...example.filename].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) || example.filename.startsWith('.')
      || example.filename.length > 180 || typeof example.content !== 'string' || example.content.length > 1_000_000) return null;
  if (type === 'application/json') {
    try { JSON.parse(example.content); } catch { return null; }
  }
  return { ...example, contentType: `${type};charset=utf-8` };
}

export function requestErrorCode(error: unknown): 'unauthorized' | 'forbidden' | 'invalid' | 'unavailable' {
  const status = (error as { response?: { status?: number } } | null)?.response?.status;
  return status === 401 ? 'unauthorized' : status === 403 ? 'forbidden' : status === 400 ? 'invalid' : 'unavailable';
}

export const CLAW_HELP_EVENT = 'corely-claw:help';
export function helpArticleId(detail: unknown): string | null {
  const id = (detail as { article?: unknown } | null)?.article;
  return typeof id === 'string' && /^[a-z][a-z0-9-]{0,100}$/.test(id) ? id : null;
}
