/** Read-only, company/item-scoped observations; never a formal repair report. */
export type MailroomPrecheckRecord = {
  schema: 1;
  entityId: string;
  itemId: string;
  stage: 'NOT_STARTED' | 'DRAFT' | 'READY' | 'SUBMITTED' | 'STALE';
  revision: number;
  savedByName: string | null;
  savedAt: string | null;
  submittedAt: string | null;
  recorded: null | {
    id: string;
    revision: number;
    template: null | { id: string; revision: number; contentHash: string; title: string };
    savedByName: string;
    savedAt: string;
    submittedAt: string;
    notRequiredReason: string | null;
    warrantyReview?: {
      schema: 1;
      method: 'MANUAL_EXTERNAL';
      status: 'CHECKED' | 'NEEDS_CORRECTION' | 'CORRECTED_EXTERNALLY';
      note: string | null;
      warrantyNumber: string | null;
      recordedById: string;
      recordedByName: string;
      recordedAt: string;
    } | null;
    mailroomIssue?: { schema: 1; symptom: string | null; preliminaryReason: string | null } | null;
    checks: {
      key: string;
      label: string;
      result: 'NORMAL' | 'ABNORMAL' | 'NOT_TESTED' | 'NOT_APPLICABLE';
      note: string | null;
      photoIds: string[];
    }[];
    photos: { id: string; digest: string; url: string }[];
  };
};
