import type { SourceCase } from './mailroom.contract';
import {
  repairSourceBindingForItem,
  type RepairProposalItem,
} from './repair-proposal.contract';
import { repairSourceCaseBrand } from './repair-source-brand.contract';

type ProgressItem = RepairProposalItem & {
  receipt: RepairProposalItem['receipt'] & {
    entityId: string;
    sourceSnapshot?: unknown;
  };
};
type Binding = ReturnType<typeof repairSourceBindingForItem>;
type ReleaseInfo = NonNullable<SourceCase['releaseInfo']>;
type ProgressReleaseInfo = Omit<ReleaseInfo, 'quoteBindings'> & {
  quoteBindings: ReleaseInfo['quoteBindings'] | null;
};
type ProgressRelease = {
  available: boolean;
  sourceCaseId?: string;
  caseBrand?: 'MOZTECH' | 'BONSON' | 'WANBO';
  repairAllowed?: boolean;
  sourceStatus?: string;
  sourceStatusLabel?: string;
  releaseInfo?: ProgressReleaseInfo | null;
};
export type RepairListProgress = {
  release: ProgressRelease;
  repairProposalBinding: Binding | null;
};
const object = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const text = (value: unknown, max = 128): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const revision = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) > 0;
const nullableRevision = (value: unknown): value is number | null =>
  value === null || revision(value);
const digest = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const timestamp = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) &&
  Number.isFinite(Date.parse(value));
export const unavailableRepairListProgress = (): RepairListProgress => ({
  release: { available: false },
  repairProposalBinding: null,
});

/** Only a signed, exact-company Source read may be supplied by the caller. */
export function repairListProgress(
  item: ProgressItem,
  source: SourceCase | undefined,
): RepairListProgress {
  const unavailable = unavailableRepairListProgress();
  if (
    item.receipt.entityId !== item.entityId ||
    item.receipt.category !== 'REPAIR' ||
    !source ||
    source.id !== item.receipt.sourceCaseId ||
    source.number !== item.receipt.sourceNumber ||
    source.type !== 'REPAIR' ||
    !timestamp(source.version) ||
    !text(source.status, 64) ||
    typeof source.repairAllowed !== 'boolean'
  )
    return unavailable;
  try {
    const caseBrand = repairSourceCaseBrand(source);
    const snapshot = object(item.receipt.sourceSnapshot);
    const snapshotInfo = object(snapshot?.releaseInfo);
    const snapshotIdentity = object(snapshotInfo?.customerIdentity);
    const rawInfo = object(source.releaseInfo);
    const identity = object(rawInfo?.customerIdentity);
    if (
      (snapshot?.caseBrand != null && snapshot.caseBrand !== caseBrand) ||
      (timestamp(snapshot?.version) &&
        Date.parse(source.version) < Date.parse(snapshot.version)) ||
      (rawInfo?.customerIdentity != null &&
        (!identity ||
          !text(identity.companyId) ||
          identity.caseId !== source.id ||
          identity.brand !== caseBrand ||
          identity.verified !== true)) ||
      // Source company IDs and ERP entity IDs are different namespaces.
      (snapshotIdentity?.companyId != null &&
        snapshotIdentity.companyId !== identity?.companyId)
    )
      return unavailable;
    const release: ProgressRelease = {
      available: true,
      sourceCaseId: source.id,
      caseBrand,
      repairAllowed: false,
      sourceStatus: source.status,
      ...(text(source.statusLabel, 200)
        ? { sourceStatusLabel: source.statusLabel }
        : {}),
      releaseInfo: null,
    };
    if (source.releaseInfo === null)
      return { release, repairProposalBinding: null };
    const info = source.releaseInfo;
    // Source starts REPAIR at revision 1 before a formal quote exists. Preserve
    // this exact sentinel rather than mistaking it for an approved/stale quote.
    if (
      info &&
      ['RECEIVED', 'INSPECTING'].includes(source.status) &&
      source.repairAllowed === false &&
      info.quoteRevision === 1 &&
      info.amount === null &&
      info.quotePlanVersion === null &&
      info.quotePlanHash === null &&
      (info.quoteBindings === null ||
        (Array.isArray(info.quoteBindings) && !info.quoteBindings.length)) &&
      info.customerApprovedQuoteRevision === null &&
      info.customerApprovedAt === null &&
      info.confirmedPaymentQuoteRevision === null &&
      info.invoiceRequired === false &&
      info.invoiceStatus === 'NOT_REQUIRED' &&
      typeof info.currency === 'string' &&
      /^[A-Z]{3}$/.test(info.currency)
    ) {
      release.releaseInfo = {
        quoteRevision: 1,
        customerApprovedQuoteRevision: null,
        customerApprovedAt: null,
        amount: null,
        currency: info.currency,
        confirmedPaymentQuoteRevision: null,
        invoiceRequired: false,
        invoiceStatus: 'NOT_REQUIRED',
        quotePlanVersion: null,
        quotePlanHash: null,
        quoteBindings: info.quoteBindings === null ? null : [],
        ...(typeof info.invoiceSatisfied === 'boolean'
          ? { invoiceSatisfied: info.invoiceSatisfied }
          : {}),
        ...(nullableRevision(info.invoiceQuoteRevision)
          ? { invoiceQuoteRevision: info.invoiceQuoteRevision }
          : {}),
      };
      return { release, repairProposalBinding: null };
    }
    if (
      !info ||
      !revision(info.quoteRevision) ||
      !nullableRevision(info.customerApprovedQuoteRevision) ||
      !nullableRevision(info.confirmedPaymentQuoteRevision) ||
      (info.customerApprovedAt !== null &&
        !timestamp(info.customerApprovedAt)) ||
      typeof info.amount !== 'number' ||
      !Number.isFinite(info.amount) ||
      info.amount < 0 ||
      typeof info.currency !== 'string' ||
      !/^[A-Z]{3}$/.test(info.currency) ||
      (info.invoiceRequired !== undefined &&
        typeof info.invoiceRequired !== 'boolean') ||
      (info.invoiceSatisfied !== undefined &&
        typeof info.invoiceSatisfied !== 'boolean') ||
      (info.invoiceStatus !== undefined && !text(info.invoiceStatus, 64)) ||
      (info.invoiceQuoteRevision !== undefined &&
        !nullableRevision(info.invoiceQuoteRevision)) ||
      !Array.isArray(info.quoteBindings) ||
      info.quoteBindings.length < 1 ||
      info.quoteBindings.length > 200 ||
      info.quoteBindings.some(
        (binding) =>
          !binding ||
          !text(binding.itemId) ||
          !revision(binding.planVersion) ||
          !digest(binding.planHash) ||
          !digest(binding.proposalHash) ||
          binding.quoteRevision !== info.quoteRevision,
      ) ||
      new Set(info.quoteBindings.map((binding) => binding.itemId)).size !==
        info.quoteBindings.length
    )
      return unavailable;
    const expected = repairSourceBindingForItem(item, source);
    const bindings = info.quoteBindings.filter(
      (binding) => binding.itemId === item.id,
    );
    if (
      bindings.length !== 1 ||
      bindings[0].planVersion !== expected.planVersion ||
      bindings[0].planHash !== expected.planHash ||
      bindings[0].proposalHash !== expected.proposalHash
    )
      return unavailable;
    // Explicit allowlist: customer identity, decisions, payment/provider payloads,
    // contact details and arbitrary upstream properties never reach list rows.
    release.releaseInfo = {
      quoteRevision: info.quoteRevision,
      customerApprovedQuoteRevision: info.customerApprovedQuoteRevision,
      customerApprovedAt: info.customerApprovedAt,
      amount: info.amount,
      currency: info.currency,
      confirmedPaymentQuoteRevision: info.confirmedPaymentQuoteRevision,
      ...(info.invoiceRequired !== undefined
        ? { invoiceRequired: info.invoiceRequired }
        : {}),
      ...(info.invoiceStatus !== undefined
        ? { invoiceStatus: info.invoiceStatus }
        : {}),
      ...(info.invoiceSatisfied !== undefined
        ? { invoiceSatisfied: info.invoiceSatisfied }
        : {}),
      ...(info.invoiceQuoteRevision !== undefined
        ? { invoiceQuoteRevision: info.invoiceQuoteRevision }
        : {}),
      quoteBindings: bindings.map((binding) => ({
        itemId: binding.itemId,
        planVersion: binding.planVersion,
        planHash: binding.planHash,
        proposalHash: binding.proposalHash,
        quoteRevision: binding.quoteRevision,
      })),
    };
    release.repairAllowed = source.repairAllowed;
    return { release, repairProposalBinding: expected };
  } catch {
    return unavailable;
  }
}
