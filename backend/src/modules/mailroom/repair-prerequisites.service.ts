import {
  ConflictException,
  Inject,
  Injectable,
  forwardRef,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  type InspectionData,
  type RepairData,
  type RepairDocument,
} from './repair-document.contract';
import { RepairTestRegistryService } from './repair-test-registry.service';
import { RepairMaterialsService } from './repair-materials.service';
import {
  templateReadiness,
  validateRepairTemplate,
  validateTemplateChecks,
} from './repair-template.contract';
type Item = Prisma.MailroomItemGetPayload<{ include: { receipt: true } }>;
type ReadItem = Pick<
  Item,
  | 'id'
  | 'entityId'
  | 'productId'
  | 'sku'
  | 'repairOwnerId'
  | 'custodianId'
  | 'repairInspection'
  | 'repairReport'
>;

@Injectable()
export class RepairPrerequisitesService {
  constructor(
    @Inject(forwardRef(() => RepairTestRegistryService))
    private readonly registry: RepairTestRegistryService,
    @Inject(forwardRef(() => RepairMaterialsService))
    private readonly materials: RepairMaterialsService,
  ) {}
  private async resolved(
    item: ReadItem,
    kind: 'inspection' | 'repair',
    tx?: Prisma.TransactionClient,
  ) {
    const report = item.repairReport as RepairDocument<RepairData> | null;
    if (kind === 'repair' && report?.data.outcome === 'REPLACED') {
      if (!report.data.replacementSku) return null;
      return this.registry.resolveReplacement(
        item,
        report.data.replacementSku,
        tx,
      );
    }
    return this.registry.resolve(item, kind, tx);
  }
  async bindingValidation(
    item: Item,
    kind: 'inspection' | 'repair',
    data: InspectionData | RepairData,
    tx: Prisma.TransactionClient,
  ) {
    if (data.protocol !== 2)
      throw new ConflictException('請使用目前工作單版本綁定檢測標準');
    const resolution =
      kind === 'repair' && (data as RepairData).outcome === 'REPLACED'
        ? await this.registry.resolveReplacement(
            item,
            (data as RepairData).replacementSku || '',
            tx,
          )
        : await this.registry.resolveOriginal(item, kind, tx);
    if (
      resolution.state !== 'KNOWN' ||
      !resolution.template ||
      !resolution.context ||
      !data.templateBinding
    )
      throw new ConflictException('請先確認此機種的檢測標準');
    validateRepairTemplate(resolution.template, {
      ...resolution.context,
      binding: data.templateBinding,
    });
    return {
      ...resolution,
      context: { ...resolution.context, binding: data.templateBinding },
    };
  }
  async recordValidation(
    item: Item,
    kind: 'inspection' | 'repair',
    data: InspectionData | RepairData,
    tx: Prisma.TransactionClient,
  ) {
    const resolution = await this.bindingValidation(item, kind, data, tx);
    validateTemplateChecks(
      resolution.template,
      data.checks,
      resolution.context,
      'RECORD',
      resolution.calibrations,
    );
    return {
      ...resolution,
      context: resolution.context,
    };
  }
  async forItem(item: ReadItem, tx?: Prisma.TransactionClient) {
    const [materials, inspectionResolution, completionResolution] =
      await Promise.all([
        this.materials.projectionForItem(item, tx),
        this.resolved(item, 'inspection', tx),
        this.resolved(item, 'repair', tx),
      ]);
    const inspection =
      item.repairInspection as RepairDocument<InspectionData> | null;
    const report = item.repairReport as RepairDocument<RepairData> | null;
    const state = (
      resolved: typeof inspectionResolution,
      doc: typeof inspection | typeof report,
      phase: 'INSPECTION' | 'COMPLETION',
    ) =>
      resolved?.state === 'KNOWN' &&
      resolved.context &&
      doc?.data.templateBinding
        ? templateReadiness(
            resolved.template,
            doc.data.checks,
            { ...resolved.context, binding: doc.data.templateBinding },
            phase,
            resolved.calibrations,
          )
        : 'UNKNOWN';
    return {
      materials: { start: materials.start, completion: materials.completion },
      template: inspectionResolution?.template || null,
      completionTemplate: completionResolution?.template || null,
      repairTemplate: completionResolution?.template || null,
      templateChecks: {
        inspection: state(inspectionResolution, inspection, 'INSPECTION'),
        completion: state(completionResolution, report, 'COMPLETION'),
      },
      calibrationRecords: inspectionResolution?.calibrations || [],
      completionCalibrationRecords: completionResolution?.calibrations || [],
    };
  }
  async require(
    item: Item,
    stage: 'START' | 'COMPLETION',
    tx: Prisma.TransactionClient,
  ) {
    const current = await this.forItem(item, tx);
    const material =
      stage === 'START'
        ? current.materials.start
        : current.materials.completion;
    if (material.state !== 'READY')
      throw new ConflictException('材料尚未備妥或領用責任尚未結清');
    if (
      (stage === 'START'
        ? current.templateChecks.inspection
        : current.templateChecks.completion) !== 'READY'
    )
      throw new ConflictException('必要檢測或設備校正尚未確認');
    return current;
  }
}
