import { ConflictException } from '@nestjs/common';
import type { SourceCase } from './mailroom.contract';
/** brand is the display window; only the signed caseBrand names the case brand. */
export function repairSourceCaseBrand(
  source: SourceCase,
): 'MOZTECH' | 'BONSON' | 'WANBO' {
  const brand = (source as SourceCase & { caseBrand?: unknown }).caseBrand;
  if (brand !== 'MOZTECH' && brand !== 'BONSON' && brand !== 'WANBO')
    throw new ConflictException('案件品牌尚未確認');
  return brand;
}
