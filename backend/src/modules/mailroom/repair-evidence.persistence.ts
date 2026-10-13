import { ServiceUnavailableException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

type Query = {
  where?: Record<string, unknown>;
  orderBy?: unknown;
  take?: number;
};
export type EvidenceTable<T> = {
  findFirst(query: Query): Promise<T | null>;
  findMany(query: Query): Promise<T[]>;
  create(query: { data: Record<string, unknown> }): Promise<T>;
  update(query: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }): Promise<T>;
  updateMany(query: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }): Promise<{ count: number }>;
};
export type MediaAsset = {
  id: string;
  entityId: string;
  itemId: string;
  kind: 'inspection' | 'repair';
  documentRevision: number;
  phase: 'BEFORE' | 'AFTER' | 'DIAGNOSTIC';
  checkKey: string | null;
  status: string;
  bucket: string;
  objectKey: string;
  generation: string | null;
  sha256: string | null;
  contentType: string;
  sizeBytes: bigint | null;
  bindings: unknown;
  uploadedById: string;
  expiresAt: Date;
  finalizedAt: Date | null;
};
export type CustomerReport = {
  id: string;
  entityId: string;
  itemId: string;
  sourceCaseId: string;
  sourceBrand: string;
  verifiedCustomerId: string;
  inspectionRevision: number;
  reportRevision: number | null;
  planHash: string;
  proposalHash: string;
  itemIdentityHash: string;
  currency: string;
  quoteRevision: number;
  content: unknown;
  contentHash: string;
  mediaIds: string[];
  status: string;
  tokenHash: string;
  expiresAt: Date;
  publishedById: string;
  publishedAt: Date;
};
export type EvidenceOperation = {
  entityId: string;
  actorId: string;
  requestId: string;
  action: string;
  requestHash: string;
  result: unknown;
};
export type EvidenceDatabase = Prisma.TransactionClient & {
  repairMediaAsset: EvidenceTable<MediaAsset>;
  repairCustomerReport: EvidenceTable<CustomerReport>;
  repairEvidenceOperation: EvidenceTable<EvidenceOperation>;
};
/** Structural bridge until the central schema editor generates the app client.
 * Missing deployed migrations never become empty records or positive evidence. */
export function evidenceDatabase(value: unknown): EvidenceDatabase {
  const db = value as EvidenceDatabase;
  if (
    !db?.repairMediaAsset ||
    !db.repairCustomerReport ||
    !db.repairEvidenceOperation
  )
    throw new ServiceUnavailableException('檢修存證服務尚未就緒');
  return db;
}
