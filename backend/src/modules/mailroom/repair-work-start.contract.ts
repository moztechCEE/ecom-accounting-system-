import { ConflictException } from '@nestjs/common';
import { inspectionPlanHash } from './repair-document.contract';
import {
  currentCsrReview,
  physicalCustody,
  repairWorkflow,
  type WorkflowItem,
} from './repair-workflow.contract';
export type RepairWorkStartProof = {
  schema: 'corely.repair.work-start.v1';
  kind: 'REFURBISHMENT';
  entityId: string;
  itemId: string;
  inspectionRevision: number;
  planHash: string;
  ownerId: string;
  custodianId: string;
  startedById: string;
  startedAt: string;
};
type Item = WorkflowItem & { id: string; entityId: string };
export function requireRefurbishmentWorkStart(
  item: Item,
  now = new Date(),
): RepairWorkStartProof {
  const workflow = repairWorkflow(item.repairWorkflow),
    doc = currentCsrReview(item),
    proof = workflow.workStart;
  if (
    item.receipt.category !== 'RETURN' ||
    item.status !== 'REFURBISHING' ||
    doc.data.plan !== 'REPAIR' ||
    workflow.csr?.decision !== 'APPROVE' ||
    workflow.csr.quoteRevision !== null ||
    doc.review?.quoteRevision !== null ||
    !proof ||
    proof.schema !== 'corely.repair.work-start.v1' ||
    proof.kind !== 'REFURBISHMENT' ||
    proof.entityId !== item.entityId ||
    proof.itemId !== item.id ||
    proof.inspectionRevision !== doc.revision ||
    proof.planHash !== inspectionPlanHash(doc) ||
    !item.repairOwnerId ||
    proof.ownerId !== item.repairOwnerId ||
    proof.custodianId !== item.custodianId ||
    item.custodianId !== item.repairOwnerId ||
    proof.startedById !== item.repairOwnerId ||
    physicalCustody(item) !== 'TECHNICIAN' ||
    typeof proof.startedAt !== 'string' ||
    !Number.isFinite(now.getTime()) ||
    !Number.isFinite(Date.parse(proof.startedAt)) ||
    Date.parse(proof.startedAt) > now.getTime()
  )
    throw new ConflictException('本版整新尚未由本人確認開工');
  return Object.freeze(structuredClone(proof));
}
