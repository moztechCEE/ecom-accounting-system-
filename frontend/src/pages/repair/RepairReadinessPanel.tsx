import { Collapse, Typography } from 'antd';
import { repairReadiness } from './repair-readiness';
import type { RepairReadinessCheck, RepairReadinessContext } from './repair-readiness';
import { CSR_STATUS, PLANS, RESULTS } from './repair-model';
import type { RepairItem } from './repair-model';
import { repairCaseProgress } from './repair-list-model';

const labels: Record<string, string> = {
  disposition_auth:'顧客處置授權',
  own_signed: '本人簽收', inspection: '檢修單', start_stage: '處理方案', csr_decision: '客服確認',
  csr_versions: '客服版次', source_release: '維修放行', source_quote: '報價版本',
  customer_consent: '顧客同意', payment: '款項確認', completion_stage: '交回階段', report: '維修單',
  report_revision: '維修依據版本', outcome: '實際處置', qc: '總複驗', checks: '逐項複驗',
  factory_receipt: '原廠返還', handoff_note: '交回說明',
  proposal_binding: '本件方案報價', invoice: '必要發票', materials: '必要材料', test_standard: '檢測基準',
  work_start:'整新開工',
};
const outcomes: Record<string, string> = { REPAIRED: '原機維修', REPLACED: '換機', FACTORY_REPAIRED: '原廠維修' };
const revision = (value?: number | null) => value == null ? '未提供' : `v${value}`;
const outcome = (value?: string) => outcomes[value || ''] || value || '未記錄';

function evidence(check: RepairReadinessCheck, item: RepairItem, note?: string): string {
  const inspection = item.repairInspection;
  const report = item.repairReport;
  const csr = item.repairWorkflow?.csr;
  const info = item.release?.releaseInfo;
  switch (check.key) {
    case 'disposition_auth': return check.detail;
    case 'own_signed': return check.ready ? '已簽收' : '未符合本人簽收條件';
    case 'inspection': return `${revision(inspection?.revision)} · ${inspection?.status === 'SUBMITTED' ? '已提交' : '未提交'}`;
    case 'start_stage': case 'completion_stage': return item.receipt.category==='RETURN' && inspection && inspection.data.plan!=='REPAIR' ? `此流程不支援${PLANS[inspection.data.plan]}方案` : `${item.statusLabel || item.status} · ${inspection ? PLANS[inspection.data.plan] : '未選方案'}`;
    case 'csr_decision': return item.receipt.category==='RETURN'?check.detail:csr ? CSR_STATUS[csr.status] || csr.status : '尚未交辦';
    case 'csr_versions': {
      if (check.ready) return `檢修 ${revision(inspection?.revision)}`;
      const differences = [
        csr?.inspectionRevision !== inspection?.revision ? `客服檢修 ${revision(csr?.inspectionRevision)}／目前檢修 ${revision(inspection?.revision)}` : '',
        csr?.estimateRevision !== inspection?.revision ? `估價依據 ${revision(csr?.estimateRevision)}／目前檢修 ${revision(inspection?.revision)}` : '',
        csr?.quoteRevision !== inspection?.review?.quoteRevision ? `客服報價 ${revision(csr?.quoteRevision)}／方案報價 ${revision(inspection?.review?.quoteRevision)}` : '',
        !inspection?.review?.planHash ? '方案依據未齊備' : csr?.planHash !== inspection.review.planHash ? '方案依據不一致' : '',
      ].filter(Boolean);
      return differences.join('；') || `方案報價 ${revision(inspection?.review?.quoteRevision)} · 無有效版次`;
    }
    case 'source_release': return check.ready ? '已放行' : item.release?.message || '尚未放行';
    case 'source_quote': return `報價 ${revision(info?.quoteRevision)}／客服確認 ${revision(inspection?.review?.quoteRevision)}`;
    case 'customer_consent': return check.ready ? `已同意 ${revision(info?.quoteRevision)}` : `待同意報價 ${revision(info?.quoteRevision)}`;
    case 'payment': return !info || !Number.isFinite(info.amount) || Number(info.amount) < 0 ? '金額未確認'
      : info.amount === 0 ? '免費' : `${info.currency} ${info.amount} · ${check.ready ? '已確認' : `待確認報價 ${revision(info.quoteRevision)} 款項`}`;
    case 'proposal_binding': return check.ready ? `本件檢修 ${revision(inspection?.revision)} · 報價 ${revision(info?.quoteRevision)}` : '本件方案尚未綁定目前報價';
    case 'invoice': return check.detail;
    case 'materials': return check.detail;
    case 'test_standard': return check.detail;
    case 'work_start': return check.detail;
    case 'report': return `${revision(report?.revision)} · ${report?.status === 'SUBMITTED' ? '已提交' : '未提交'}`;
    case 'report_revision': return `目前檢修 ${revision(inspection?.revision)}／維修依據 ${revision(report?.inspectionRevision)}`;
    case 'outcome': return outcome(report?.data.outcome);
    case 'qc': return `${report ? RESULTS[report.data.qcResult] || report.data.qcResult : '未記錄'}${report?.data.qcNotes ? ` · ${report.data.qcNotes}` : ''}`;
    case 'checks': return report?.data.checks.length ? report.data.checks.map(value => `${value.name}：${RESULTS[value.result] || value.result}${value.result !== 'PASS' && value.observation ? ` · ${value.observation}` : ''}`).join('；') : '未記錄';
    case 'factory_receipt': return `${item.repairWorkflow?.factory?.stage === 'RETURNED' && item.repairWorkflow.factory.physicalCustody === 'TECHNICIAN' ? '已簽收返還件' : '未簽收返還件'} · 委修單 ${item.repairWorkflow?.factory?.reference || '未提供'}／維修單 ${report?.data.factoryReference || '未提供'}`;
    case 'handoff_note': return note?.trim() || '未填寫';
    default: return check.ready ? '完成' : '待確認';
  }
}

function Checks({ title, items, item, note }: { title: string; items: RepairReadinessCheck[]; item: RepairItem; note?: string }) {
  const pending = items.filter(value => !value.ready);
  const complete = items.filter(value => value.ready);
  const rows = (values: RepairReadinessCheck[]) => <ul className="repair-readiness-list">
    {values.map(value => <li key={`${item.id}:${item.version}:${value.key}`}>
      <details className="repair-readiness-check" data-check-key={value.key} data-check-ready={value.ready}>
        <summary>{labels[value.key] || value.label}</summary>
        <div className="repair-readiness-evidence">{evidence(value, item, note)}</div>
      </details>
    </li>)}
  </ul>;
  return <section aria-label={title}>
    <Typography.Title level={5}>{title}</Typography.Title>
    {pending.length > 0 && <div className="repair-readiness-pending">
      <div className="repair-readiness-group-title">待完成 <span>{pending.length}</span></div>
      {rows(pending)}
    </div>}
    {complete.length > 0 && <details className="repair-readiness-complete" key={`${item.id}:${item.version}:complete`}>
      <summary>已符合 <span>{complete.length}</span></summary>
      {rows(complete)}
    </details>}
  </section>;
}

const pendingLabels: Record<string, string> = {
  own_signed: '等待本人簽收', inspection: '檢修單待提交', start_stage: '處理方案待確認',
  csr_decision: '等待客服確認', csr_versions: '客服確認需更新', source_release: '維修放行待確認',
  source_quote: '報價版本待確認', customer_consent: '等待顧客確認', payment: '款項待確認',
  proposal_binding: '方案報價待核對', invoice: '發票待確認', materials: '材料待確認', test_standard: '檢測基準待確認',
  disposition_auth: '顧客處置授權待確認', completion_stage: '交回階段待確認', report: '維修單待提交',
  report_revision: '維修依據需更新', outcome: '實際處置待確認', qc: '修後複驗待完成', checks: '逐項複驗待完成',
  factory_receipt: '等待原廠返還件簽收', handoff_note: '交回說明待填寫', work_start: '整新開工待確認',
};

export type RepairReadinessPanelProps = RepairReadinessContext & { item: RepairItem; compact?: boolean };

export default function RepairReadinessPanel({ item, canUpdate, viewerId, handoffNote, compact = false }: RepairReadinessPanelProps) {
  const readiness = repairReadiness(item, { canUpdate, viewerId, handoffNote });
  const checks = readiness.showDisposition ? readiness.dispositionChecks : readiness.showCompletion ? readiness.completionChecks : readiness.showStart ? readiness.startChecks : [];
  const missing = checks.filter(value => !value.ready);
  const pending = readiness.showDisposition && !readiness.dispositionReady || readiness.showStart && !readiness.startReady || readiness.showCompletion && !readiness.completionReady;
  const csr = item.repairWorkflow?.csr;
  const priority = readiness.showCompletion
    ? ['own_signed', 'completion_stage', 'report', 'report_revision', 'outcome', 'qc', 'checks', 'factory_receipt', 'handoff_note', 'csr_decision', 'csr_versions', 'source_quote', 'proposal_binding', 'customer_consent', 'payment', 'invoice', 'materials', 'test_standard', 'source_release']
    : ['own_signed', 'inspection', 'start_stage', 'csr_decision', 'csr_versions', 'source_quote', 'proposal_binding', 'customer_consent', 'payment', 'invoice', 'materials', 'test_standard', 'source_release'];
  const firstMissing = priority.map(key => missing.find(value => value.key === key)).find(Boolean) || missing[0];
  const progress = item.status === 'WAITING_CUSTOMER' && csr && ['SENT', 'ACCEPTED'].includes(csr.status)
    ? repairCaseProgress(item) : undefined;
  const workflow = item.repairWorkflow;
  const workflowKnown = Object.hasOwn(item, 'repairWorkflow') && (workflow === null
    || !!workflow && 'schema' in workflow && workflow.schema === 1);
  const unsent = readiness.showStart && !readiness.showCompletion && !readiness.showDisposition
    && firstMissing?.key === 'csr_decision' && item.receipt.category === 'REPAIR'
    && item.status === 'INSPECTING' && item.repairInspection?.status === 'SUBMITTED'
    && workflowKnown && csr == null;
  const pendingTitle = !readiness.showDisposition && item.receipt.category === 'REPAIR' && item.release?.available !== true
    && !['own_signed', 'inspection', 'start_stage'].includes(firstMissing?.key)
    ? '放行資料待確認'
    : progress && !progress.startsWith('待開始') && !progress.endsWith('已開工')
      ? progress : unsent ? '待送客服確認'
        : firstMissing?.key === 'csr_decision' && item.receipt.category === 'REPAIR' && !workflowKnown
          ? '客服交辦待確認' : pendingLabels[firstMissing?.key] || '作業條件待確認';
  const details = <div className="repair-readiness-details">
    {readiness.showStart && <Checks title="開工條件" items={readiness.startChecks} item={item} note={handoffNote} />}
    {readiness.showDisposition && <Checks title="原件處置核對" items={readiness.dispositionChecks} item={item} note={handoffNote} />}
    {readiness.showCompletion && <Checks title="交回條件" items={readiness.completionChecks} item={item} note={handoffNote} />}
    {(csr || item.repairReport || readiness.sourceMessage) && <dl className="repair-readiness-records">
      {csr && <div><dt>客服交辦</dt><dd>{CSR_STATUS[csr.status] || csr.status}{csr.ownerName ? ` · ${csr.ownerName}` : ''} · 檢修 {revision(csr.inspectionRevision)}{item.receipt.category === 'RETURN' ? '' : ` · 報價 ${revision(csr.quoteRevision)}`}</dd></div>}
      {item.repairReport && <div><dt>已保存處置</dt><dd>{outcome(item.repairReport.data.outcome)}</dd></div>}
      {readiness.sourceMessage && <div><dt>售後回覆</dt><dd>{readiness.sourceMessage}</dd></div>}
    </dl>}
  </div>;
  return <section className="repair-readiness-compact" aria-label="客服與放行">
    {pending && readiness.ownSigned && <div className="repair-readiness-status" role="status" aria-label="目前進度">
      <strong>{pendingTitle}</strong>
      {firstMissing?.key.startsWith('csr_') && csr?.ownerName && <span>{csr.ownerName}</span>}
    </div>}
    {compact ? <Collapse ghost items={[{ key: 'checks', label: '客服與放行', forceRender: true, children: details }]} /> : details}
  </section>;
}
