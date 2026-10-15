import { BadRequestException } from '@nestjs/common';
import { fingerprint } from './mailroom.contract';

export type PrecheckTemplateBinding = {
  id: string;
  revision: number;
  contentHash: string;
};
export type PrecheckTemplate = PrecheckTemplateBinding & {
  schema: 1;
  title: string;
  productId: string;
  sku: string;
  checks: { key: string; label: string; required: boolean }[];
};
export type PrecheckTemplateResolution = {
  state: 'CONFIGURED' | 'UNCONFIGURED' | 'PRODUCT_UNBOUND';
  template: PrecheckTemplate | null;
  availableTemplates: PrecheckTemplate[];
  reason: string | null;
};
export type PrecheckProduct = {
  id: string;
  entityId: string;
  sku: string;
  isActive: boolean;
  attributes: unknown;
};
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/** Only the actual, active company product master supplies functional checks. */
export function resolvePrecheckTemplate(
  item: { entityId: string; productId: string | null; sku: string | null },
  product: PrecheckProduct | null,
  selectedTemplateId?: string | null,
): PrecheckTemplateResolution {
  if (
    !product ||
    !item.productId ||
    product.id !== item.productId ||
    product.entityId !== item.entityId ||
    !product.isActive ||
    product.sku !== item.sku
  )
    return {
      state: 'PRODUCT_UNBOUND',
      template: null,
      availableTemplates: [],
      reason: '請先核對實物產品主檔',
    };
  const build = (
    id: string,
    title: string,
    revision: number,
    checks: PrecheckTemplate['checks'],
  ): PrecheckTemplate => {
    const definition = {
      schema: 1 as const,
      id,
      title,
      revision,
      entityId: item.entityId,
      productId: product.id,
      sku: product.sku,
      checks,
    };
    return { ...definition, contentHash: fingerprint(definition) };
  };
  const availableTemplates = [
    build('GENERIC_FUNCTIONAL_V1', '基本功能初檢', 1, [
      { key: 'basic_function', label: '基本功能', required: true },
    ]),
    build('MOZTECH_POWERBANK_PRO_V1', '萬能充 Pro 初檢表', 1, [
      { key: 'builtin_type_c', label: '自帶 Type-C 線', required: true },
      { key: 'builtin_lightning', label: '自帶 Lightning 線', required: true },
      { key: 'usb_c_output', label: 'USB-C 輸出', required: true },
      { key: 'usb_a_output', label: 'USB-A 輸出', required: true },
      { key: 'wireless_charging', label: '無線充電', required: true },
    ]),
  ];
  const config = object(product.attributes)
    ? product.attributes.mailroomPrecheck
    : undefined;
  if (
    config !== undefined &&
    (!object(config) ||
      config.schema !== 1 ||
      !Number.isInteger(config.revision) ||
      Number(config.revision) < 1 ||
      !Array.isArray(config.checks) ||
      config.checks.length < 1 ||
      config.checks.length > 40)
  )
    throw new BadRequestException('產品初檢模板格式不符，請先核對產品主檔');
  const seen = new Set<string>();
  const checks = (
    object(config) && Array.isArray(config.checks) ? config.checks : []
  ).map((value) => {
    if (
      !object(value) ||
      typeof value.key !== 'string' ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(value.key) ||
      seen.has(value.key) ||
      typeof value.label !== 'string' ||
      !value.label.trim() ||
      value.label.length > 160 ||
      typeof value.required !== 'boolean'
    )
      throw new BadRequestException('產品初檢項目不完整或重複');
    seen.add(value.key);
    return { key: value.key, label: value.label, required: value.required };
  });
  if (object(config))
    availableTemplates.unshift(
      build(
        `product:${product.id}`,
        '產品主檔初檢表',
        Number(config.revision),
        checks,
      ),
    );
  const selected =
    selectedTemplateId === undefined && object(config)
      ? availableTemplates[0]
      : (availableTemplates.find(
          (template) => template.id === selectedTemplateId,
        ) ?? null);
  return {
    state: selected ? 'CONFIGURED' : 'UNCONFIGURED',
    template: selected,
    availableTemplates,
    reason: selected ? null : '請選擇初檢表或明確填寫不需初檢原因',
  };
}
