import api, { API_URL } from '../../services/api';

export type RepairEvidenceCommand = { entityId: string; requestId: string; expectedVersion: number };
export type RepairEvidenceKind = 'inspection' | 'repair';
export type RepairMediaPhase = 'BEFORE' | 'AFTER' | 'DIAGNOSTIC';
export type RepairMediaRef = { mediaId: string; phase: RepairMediaPhase; checkKey?: string };
export type RepairMediaBinding = { kind: RepairEvidenceKind; documentRevision: number; phase: RepairMediaPhase; checkKey?: string };
export type RepairMediaAsset = RepairMediaBinding & {
  mediaId: string;
  status: 'PENDING' | 'FINALIZED' | 'REVOKED';
  sha256: string | null;
  contentType: string;
  sizeBytes: number | null;
  bindings?: RepairMediaBinding[];
};
export type RepairMediaUploadCommand = RepairEvidenceCommand & {
  kind: RepairEvidenceKind; phase: RepairMediaPhase; checkKey?: string;
};
export type RepairMediaUploadResult = { asset: RepairMediaAsset; mediaRef: RepairMediaRef };
export type RepairPublicReport = {
  reportId: string; productName: string; caseNumber: string;
  findings: string; handling: string; verification: string;
  media: { mediaId: string; contentType: string }[];
};
export type RepairReportPublishCommand = RepairEvidenceCommand & { kind: RepairEvidenceKind; expiresInDays: number };
export type RepairReportPublication = { reportId: string; shareLink: string };
export type RepairReportSummary = {
  reportId: string; status: 'PUBLISHED' | 'REVOKED'; publishedAt: string; expiresAt: string;
  inspectionRevision: number; reportRevision: number | null;
};
export type RepairReportRevocation = { reportId: string; duplicate?: boolean };
export type RepairEvidenceErp = {
  get(path: string, options?: { params?: { entityId: string }; responseType?: 'blob' }): Promise<{ data: unknown }>;
  post(path: string, body: unknown): Promise<{ data: unknown }>;
};
export type RepairEvidenceDependencies = {
  erp?: RepairEvidenceErp;
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  publicApiUrl?: string;
  randomUUID?: () => string;
};
export type RepairMediaUploadOptions = { signal?: AbortSignal; expectedDocumentRevision?: number };

const mediaTypes = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime'];
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string =>
  typeof value === 'string' && !!value.trim() && value.trim() === value &&
  !Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
const fail = (message: string): never => { throw new Error(message); };
const identifier = (value: unknown): string => text(value) ? value : fail('作業識別資料不完整');
const kind = (value: unknown): value is RepairEvidenceKind => value === 'inspection' || value === 'repair';
const phase = (value: unknown): value is RepairMediaPhase => value === 'BEFORE' || value === 'AFTER' || value === 'DIAGNOSTIC';
const revision = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 2147483646;
const base = (itemId: string) => '/repair-workbench/items/' + encodeURIComponent(identifier(itemId));
const command = (value: RepairEvidenceCommand): RepairEvidenceCommand => {
  if (!text(value.entityId) || value.entityId.length > 128 || typeof value.requestId !== 'string' ||
    !/^[A-Za-z0-9_-]{8,80}$/.test(value.requestId) || !revision(value.expectedVersion))
    return fail('作業版本或識別資料不完整');
  return { entityId: value.entityId, requestId: value.requestId, expectedVersion: value.expectedVersion };
};

function readBinding(value: unknown): RepairMediaBinding {
  if (!object(value) || !kind(value.kind) || !phase(value.phase) || !revision(value.documentRevision) ||
    value.checkKey !== undefined && (!text(value.checkKey) || value.checkKey.length > 128))
    return fail('影像關聯資料不完整');
  return { kind: value.kind, documentRevision: value.documentRevision, phase: value.phase,
    ...(value.checkKey !== undefined ? { checkKey: value.checkKey as string } : {}) };
}

export function readRepairMediaAsset(value: unknown): RepairMediaAsset {
  const binding = readBinding(value);
  if (!object(value) || !text(value.mediaId) || typeof value.contentType !== 'string' || !mediaTypes.includes(value.contentType) ||
    typeof value.status !== 'string' || !['PENDING', 'FINALIZED', 'REVOKED'].includes(value.status))
    return fail('影像回執資料不完整');
  const hasHash = typeof value.sha256 === 'string' && /^[a-f0-9]{64}$/.test(value.sha256);
  const hasSize = typeof value.sizeBytes === 'number' && Number.isSafeInteger(value.sizeBytes) && value.sizeBytes > 0;
  if (value.status === 'FINALIZED' ? !hasHash || !hasSize
    : value.status === 'PENDING' ? value.sha256 !== null || value.sizeBytes !== null
      : value.sha256 !== null && !hasHash || value.sizeBytes !== null && !hasSize)
    return fail('影像回執尚未確認');
  if (value.bindings !== undefined && !Array.isArray(value.bindings)) return fail('影像版本關聯不完整');
  return { ...binding, mediaId: value.mediaId, status: value.status as RepairMediaAsset['status'],
    sha256: value.sha256 as string | null, contentType: value.contentType, sizeBytes: value.sizeBytes as number | null,
    ...(Array.isArray(value.bindings) ? { bindings: value.bindings.map(readBinding) } : {}) };
}

function finalizedResult(asset: RepairMediaAsset): RepairMediaUploadResult {
  if (asset.status !== 'FINALIZED') return fail('影像尚未確認');
  return { asset, mediaRef: { mediaId: asset.mediaId, phase: asset.phase,
    ...(asset.checkKey !== undefined ? { checkKey: asset.checkKey } : {}) } };
}

/** Signed storage requests bypass the ERP interceptor and may never redirect. */
export function validateRepairUploadUrl(value: unknown): string {
  if (!text(value)) return fail('影像上傳連結無效');
  let url: URL;
  try { url = new URL(value); } catch { return fail('影像上傳連結無效'); }
  if (url.protocol !== 'https:' || url.hostname !== 'storage.googleapis.com' || url.username || url.password ||
    url.port && url.port !== '443' || url.hash)
    return fail('影像上傳連結無效');
  return url.href;
}

export function repairReportTokenFromFragment(fragment: string): string {
  if (typeof fragment !== 'string' || !fragment.startsWith('#')) return fail('報告連結缺少驗證資料');
  const params = new URLSearchParams(fragment.slice(1)), tokens = params.getAll('token');
  if (tokens.length !== 1 || !text(tokens[0]) || /[\s]/.test(tokens[0])) return fail('報告連結缺少驗證資料');
  return tokens[0];
}

/** Return an explicit customer projection even when a server accidentally adds internal fields. */
export function readRepairPublicReport(value: unknown, reportId: string): RepairPublicReport {
  if (!object(value) || value.reportId !== reportId || !text(value.productName) || !text(value.caseNumber) ||
    !['findings', 'handling', 'verification'].every(key => typeof value[key] === 'string') || !Array.isArray(value.media))
    return fail('報告內容不完整');
  const media = value.media.map(entry => {
    if (!object(entry) || !text(entry.mediaId) || typeof entry.contentType !== 'string' || !mediaTypes.includes(entry.contentType))
      return fail('報告影像資料不完整');
    return { mediaId: entry.mediaId, contentType: entry.contentType };
  });
  if (new Set(media.map(entry => entry.mediaId)).size !== media.length) return fail('報告影像資料重複');
  return { reportId, productName: value.productName, caseNumber: value.caseNumber,
    findings: value.findings as string, handling: value.handling as string, verification: value.verification as string, media };
}

function publicUrl(apiUrl: string, reportId: string, mediaId?: string): string {
  if (!text(apiUrl)) return fail('報告服務尚未就緒');
  let parsed: URL;
  try { parsed = new URL(apiUrl, 'https://repair-report.invalid'); } catch { return fail('報告服務尚未就緒'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash ||
    !apiUrl.startsWith('/') && !/^https?:\/\//.test(apiUrl) || apiUrl.startsWith('//'))
    return fail('報告服務設定無效');
  return apiUrl.replace(/\/+$/, '') + '/public/repair-reports/' + encodeURIComponent(identifier(reportId)) +
    (mediaId === undefined ? '' : '/media/' + encodeURIComponent(identifier(mediaId)));
}

function publication(value: unknown): RepairReportPublication {
  if (!object(value) || !text(value.reportId) || !text(value.shareLink)) return fail('報告發布回執不完整');
  let link: URL;
  try { link = new URL(value.shareLink, 'https://repair-report.invalid'); } catch { return fail('報告發布連結無效'); }
  if (!['https:', 'http:'].includes(link.protocol) || link.username || link.password || link.searchParams.has('token') ||
    link.pathname !== '/repair-report/' + encodeURIComponent(value.reportId))
    return fail('報告發布連結無效');
  repairReportTokenFromFragment(link.hash);
  return { reportId: value.reportId, shareLink: value.shareLink };
}

function isoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) return false;
  const normalized = value.includes('.') ? value.replace(/\.(\d{1,3})Z$/, (_, fraction: string) => '.' + fraction.padEnd(3, '0') + 'Z') : value.replace(/Z$/, '.000Z');
  return new Date(value).toISOString() === normalized;
}

function reportSummary(value: unknown): RepairReportSummary {
  if (!object(value) || !text(value.reportId) || value.status !== 'PUBLISHED' && value.status !== 'REVOKED' ||
    !isoDate(value.publishedAt) || !isoDate(value.expiresAt) || !revision(value.inspectionRevision) ||
    value.reportRevision !== null && !revision(value.reportRevision))
    return fail('報告發布清單不完整');
  return { reportId: value.reportId, status: value.status as RepairReportSummary['status'], publishedAt: value.publishedAt,
    expiresAt: value.expiresAt, inspectionRevision: value.inspectionRevision, reportRevision: value.reportRevision as number | null };
}

export function createRepairEvidenceClient(dependencies: RepairEvidenceDependencies = {}) {
  const erp = dependencies.erp ?? { get: (path: string, options?: Parameters<RepairEvidenceErp['get']>[1]) => api.get(path, options),
    post: (path: string, body: unknown) => api.post(path, body) };
  const nativeFetch = dependencies.fetch ?? ((url: string, init: RequestInit) => globalThis.fetch(url, init));
  const randomUUID = dependencies.randomUUID ?? (() => crypto.randomUUID());
  const apiUrl = dependencies.publicApiUrl ?? API_URL;
  const safeFetch = async (url: string, init: RequestInit, message: string) => {
    try { return await nativeFetch(url, init); }
    catch (error) {
      if (init.signal?.aborted) throw error;
      return fail(message);
    }
  };
  const tokenRequest = (token: string, signal?: AbortSignal): RequestInit => ({
    method: 'GET', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal,
    headers: { 'X-Repair-Report-Token': token },
  });
  return {
    async uploadMedia(itemId: string, input: RepairMediaUploadCommand, file: Blob, options: RepairMediaUploadOptions = {}): Promise<RepairMediaUploadResult> {
      const body = command(input);
      if (!kind(input.kind) || !phase(input.phase) || input.checkKey !== undefined && (!text(input.checkKey) || input.checkKey.length > 128) ||
        !(file instanceof Blob) || !mediaTypes.includes(file.type) ||
        options.expectedDocumentRevision !== undefined && !revision(options.expectedDocumentRevision))
        return fail('影像上傳資料不完整');
      const intentRaw = (await erp.post(base(itemId) + '/media/uploads', { ...body, kind: input.kind, phase: input.phase,
        ...(input.checkKey !== undefined ? { checkKey: input.checkKey } : {}), contentType: file.type })).data;
      const intent = readRepairMediaAsset(intentRaw);
      if (intent.kind !== input.kind || intent.phase !== input.phase || intent.checkKey !== input.checkKey || intent.contentType !== file.type ||
        options.expectedDocumentRevision !== undefined && intent.documentRevision !== options.expectedDocumentRevision)
        return fail('影像與目前工作單不符');
      if (intent.status === 'FINALIZED') return finalizedResult(intent);
      if (intent.status !== 'PENDING' || !object(intentRaw) || !text(intentRaw.expiresAt) ||
        !Number.isFinite(Date.parse(intentRaw.expiresAt)) || Date.parse(intentRaw.expiresAt) <= Date.now())
        return fail('影像上傳尚未就緒或已失效');
      const uploadUrl = validateRepairUploadUrl(intentRaw.uploadUrl);
      const uploaded = await safeFetch(uploadUrl, { method: 'PUT', credentials: 'omit', redirect: 'error',
        referrerPolicy: 'no-referrer', headers: { 'Content-Type': file.type }, body: file, signal: options.signal }, '影像上傳失敗，請重試');
      if (!uploaded.ok) return fail('影像上傳失敗，請重試');
      const finalizeRequestId = randomUUID();
      if (finalizeRequestId === body.requestId) return fail('影像確認識別碼無效');
      const finalRaw = (await erp.post(base(itemId) + '/media/' + encodeURIComponent(intent.mediaId) + '/finalize',
        command({ ...body, requestId: finalizeRequestId }))).data;
      if (!object(finalRaw)) return fail('影像確認回執不完整');
      const final = readRepairMediaAsset(finalRaw.asset);
      if (final.mediaId !== intent.mediaId || final.kind !== intent.kind || final.documentRevision !== intent.documentRevision ||
        final.phase !== intent.phase || final.checkKey !== intent.checkKey || final.contentType !== intent.contentType)
        return fail('影像確認與工作單不符');
      return finalizedResult(final);
    },
    async listMedia(itemId: string, entityId: string): Promise<RepairMediaAsset[]> {
      const value = (await erp.get(base(itemId) + '/media', { params: { entityId: identifier(entityId) } })).data;
      if (!object(value) || !Array.isArray(value.items)) return fail('影像清單無法讀取');
      return value.items.map(readRepairMediaAsset);
    },
    async getMediaFile(itemId: string, mediaId: string, entityId: string): Promise<Blob> {
      const value = (await erp.get(base(itemId) + '/media/' + encodeURIComponent(identifier(mediaId)) + '/file',
        { params: { entityId: identifier(entityId) }, responseType: 'blob' })).data;
      if (!(value instanceof Blob)) return fail('影像無法讀取');
      return value;
    },
    async revokeMedia(itemId: string, mediaId: string, input: RepairEvidenceCommand): Promise<{ mediaId: string }> {
      const value = (await erp.post(base(itemId) + '/media/' + encodeURIComponent(identifier(mediaId)) + '/revoke', command(input))).data;
      if (!object(value) || value.mediaId !== mediaId) return fail('影像撤回回執不完整');
      return { mediaId };
    },
    async publishReport(itemId: string, input: RepairReportPublishCommand): Promise<RepairReportPublication> {
      const body = command(input);
      if (!kind(input.kind) || !Number.isInteger(input.expiresInDays) || input.expiresInDays < 1 || input.expiresInDays > 30)
        return fail('報告發布資料不完整');
      return publication((await erp.post(base(itemId) + '/reports/publish', { ...body, kind: input.kind, expiresInDays: input.expiresInDays })).data);
    },
    async listReports(itemId: string, entityId: string): Promise<RepairReportSummary[]> {
      const value = (await erp.get(base(itemId) + '/reports', { params: { entityId: identifier(entityId) } })).data;
      if (!object(value) || !Array.isArray(value.items)) return fail('報告發布清單無法讀取');
      const rows = value.items.map(reportSummary);
      if (new Set(rows.map(row => row.reportId)).size !== rows.length) return fail('報告發布清單重複');
      return rows;
    },
    async revokeReport(itemId: string, reportId: string, input: RepairEvidenceCommand): Promise<RepairReportRevocation> {
      const value = (await erp.post(base(itemId) + '/reports/' + encodeURIComponent(identifier(reportId)) + '/revoke', command(input))).data;
      if (!object(value) || value.reportId !== reportId || value.duplicate !== undefined && typeof value.duplicate !== 'boolean')
        return fail('報告撤回回執不完整');
      return { reportId, ...(value.duplicate !== undefined ? { duplicate: value.duplicate as boolean } : {}) };
    },
    async readPublicReportFromFragment(reportId: string, fragment: string, signal?: AbortSignal): Promise<RepairPublicReport> {
      const token = repairReportTokenFromFragment(fragment);
      const response = await safeFetch(publicUrl(apiUrl, reportId), tokenRequest(token, signal), '報告暫時無法讀取');
      if (!response.ok) return fail('報告無法讀取或連結已失效');
      let value: unknown;
      try { value = await response.json(); } catch { return fail('報告內容不完整'); }
      return readRepairPublicReport(value, reportId);
    },
    async loadPublicMediaFromFragment(reportId: string, mediaId: string, fragment: string, signal?: AbortSignal): Promise<Blob> {
      const token = repairReportTokenFromFragment(fragment);
      const response = await safeFetch(publicUrl(apiUrl, reportId, mediaId), tokenRequest(token, signal), '報告影像暫時無法讀取');
      if (!response.ok) return fail('報告影像無法讀取或連結已失效');
      const value = await response.blob();
      if (!value.size || !mediaTypes.includes(value.type.split(';')[0].trim().toLowerCase())) return fail('報告影像無法讀取');
      return value;
    },
  };
}

export type RepairEvidenceClient = ReturnType<typeof createRepairEvidenceClient>;
export const repairEvidenceClient = createRepairEvidenceClient();
