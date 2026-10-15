import { BadRequestException } from '@nestjs/common';
import { isIP } from 'node:net';

export type AfterSalesPublicDisplay = { version: 1; published: boolean; brands: ('MOZTECH' | 'BONSON')[]; aliases: string[]; imageUrl?: string; displayName?: string };
const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export function publicDisplayMetadata(value: unknown): AfterSalesPublicDisplay {
  const invalid = () => { throw new BadRequestException('售後顯示資料格式錯誤'); };
  const aliases = plain(value) && value.aliases === undefined ? [] : plain(value) ? value.aliases : null;
  if (!plain(value) || Object.keys(value).some(k => !['version', 'published', 'brands', 'aliases', 'imageUrl', 'displayName'].includes(k))
    || value.version !== 1 || typeof value.published !== 'boolean' || !Array.isArray(value.brands) || value.brands.length > 2
    || value.brands.some(b => !['MOZTECH', 'BONSON'].includes(String(b))) || new Set(value.brands).size !== value.brands.length
    || value.published && !value.brands.length || !Array.isArray(aliases) || aliases.length > 12
    || aliases.some(a => typeof a !== 'string' || !a.trim() || a.trim().length > 80 || /[\x00-\x1f]/.test(a))) return invalid();
  const result: AfterSalesPublicDisplay = { version: 1, published: value.published, brands: value.brands as AfterSalesPublicDisplay['brands'], aliases: [...new Set((aliases as string[]).map(a => a.trim()))] };
  for (const key of ['imageUrl', 'displayName'] as const) {
    if (value[key] == null || value[key] === '') continue;
    if (typeof value[key] !== 'string' || value[key].length > (key === 'imageUrl' ? 1000 : 120) || /[\x00-\x1f]/.test(value[key])) return invalid();
    const text = value[key].trim(); if (!text) continue;
    if (key === 'imageUrl') {
      let url: URL; try { url = new URL(text); } catch { return invalid(); }
      if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.port
        || url.hostname.endsWith('.') || isIP(url.hostname.replace(/^\[|\]$/g, '')) || !url.hostname.includes('.') || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(url.hostname)) return invalid();
    }
    result[key] = text;
  }
  return result;
}
export function validatePublicDisplayAttributes(attributes: unknown): any {
  if (plain(attributes) && Object.hasOwn(attributes, 'afterSalesPublicDisplay'))
    return { ...attributes, afterSalesPublicDisplay: publicDisplayMetadata(attributes.afterSalesPublicDisplay) };
  return attributes;
}
export function publishedPublicDisplay(value: unknown, brand: string): AfterSalesPublicDisplay | null {
  try { const metadata = publicDisplayMetadata(value); return metadata.published && metadata.brands.includes(brand as 'MOZTECH' | 'BONSON') ? metadata : null; }
  catch { return null; }
}
