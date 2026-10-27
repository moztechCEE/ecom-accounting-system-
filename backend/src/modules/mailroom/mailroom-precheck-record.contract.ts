import { fingerprint } from './mailroom.contract';
import { repairPhoto } from './repair-list.contract';
import {
  precheckContentHash,
  precheckSummary,
  type PrecheckDocument,
  type PrecheckItem,
  type PrecheckData,
} from './mailroom-precheck.contract';
import type { PrecheckTemplate } from './mailroom-precheck.templates';
import { precheckContext } from './mailroom-precheck-context.contract';

/** Only submitted, current-identity documents may leave the draft workspace. */
export function recordedPrecheck(
  item: PrecheckItem,
  doc: PrecheckDocument | null,
) {
  const summary = precheckSummary(doc, item);
  const base = {
    schema: 1 as const,
    entityId: item.entityId,
    itemId: item.id,
    stage: summary.stage,
    revision: summary.revision,
    savedByName: summary.savedByName,
    savedAt: summary.savedAt,
    submittedAt: summary.submittedAt,
  };
  if (!doc || summary.stage !== 'SUBMITTED' || !doc.submittedAt)
    return { ...base, recorded: null };
  const data = doc.data as PrecheckData;
  const template = doc.template as PrecheckTemplate | null;
  const contentHash = precheckContentHash(doc);
  const photos = (data.evidence ?? [])
    .map((value, index) => {
      if (!repairPhoto([value])) return null;
      const digest = fingerprint(value);
      const id = fingerprint({
        documentId: doc.id,
        revision: doc.revision,
        contentHash,
        digest,
        index,
      });
      return {
        id,
        digest,
        index,
        url: `/mailroom/prechecks/items/${encodeURIComponent(item.id)}/recorded-photos/${id}?revision=${doc.revision}`,
      };
    })
    .filter((photo): photo is NonNullable<typeof photo> => !!photo);
  return {
    ...base,
    recorded: {
      id: doc.id,
      revision: doc.revision,
      template: template
        ? {
            id: template.id,
            revision: template.revision,
            contentHash: template.contentHash,
            title: template.title,
          }
        : null,
      savedByName: doc.savedByName,
      savedAt: new Date(doc.savedAt).toISOString(),
      submittedAt: new Date(doc.submittedAt).toISOString(),
      notRequiredReason: data.notRequiredReason ?? null,
      ...precheckContext(data),
      checks: (data.checks ?? []).map((check) => ({
        key: check.key,
        label:
          template?.checks.find((entry) => entry.key === check.key)?.label ??
          check.key,
        result: check.result,
        note: check.note ?? null,
        photoIds: (check.evidenceIndexes ?? []).flatMap((index) =>
          photos
            .filter((photo) => photo.index === index)
            .map((photo) => photo.id),
        ),
      })),
      photos: photos.map(({ id, digest, url }) => ({ id, digest, url })),
    },
  };
}

export function recordedPrecheckPhoto(
  item: PrecheckItem,
  doc: PrecheckDocument | null,
  revision: number,
  photoId: string,
) {
  if (!doc || doc.revision !== revision || !/^[a-f0-9]{64}$/.test(photoId))
    return null;
  const record = recordedPrecheck(item, doc).recorded;
  if (!record) return null;
  const photo = record.photos.find((entry) => entry.id === photoId);
  if (!photo) return null;
  const data = doc.data as PrecheckData;
  return repairPhoto(
    data.evidence.filter((value) => fingerprint(value) === photo.digest),
  );
}
