import { Alert, Collapse, Descriptions, Space, Tag, Typography } from 'antd';
import { repairReadiness } from './repair-readiness';
import type { RepairReadinessCheck, RepairReadinessContext } from './repair-readiness';
import { CSR_STATUS, PLANS, RESULTS } from './repair-model';
import type { RepairItem } from './repair-model';

const labels: Record<string, string> = {
  own_signed: '本人簽收', inspection: '檢修單', start_stage: '處理方案', csr_decision: '客服確認',
  csr_versions: '客服版次', source_release: '維修放行', source_quote: '報價版本',
  customer_consent: '顧客同意', payment: '款項確認', completion_stage: '交回階段', report: '維修單',
  report_revision: '維修依據版本', outcome: '實際處置', qc: '總複驗', checks: '逐項複驗',
  factory_receipt: '原廠返還', handoff_note: '交回說明',
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
    case 'own_signed': return check.ready ? '已簽收' : '未符合本人簽收條件';
    case 'inspection': return `${revision(inspection?.revision)} · ${inspection?.status === 'SUBMITTED' ? '已提交' : '未提交'}`;
    case 'start_stage': case 'completion_stage': return item.receipt.category==='RETURN' && inspection && inspection.data.plan!=='REPAIR' ? `此流程不支援${PLANS[inspection.data.plan]}方案` : `${item.statusLabel || item.status} · ${inspection ? PLANS[inspection.data.plan] : '未選方案'}`;
    case 'csr_decision': return csr ? CSR_STATUS[csr.status] || csr.status : '尚未交辦';
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
  return <section aria-label={title}>
    <Typography.Title level={5}>{title}</Typography.Title>
    <Descriptions size="small" column={1} items={items.map(value => ({
      key: value.key, label: labels[value.key] || value.label,
      children: <Space size={6} wrap><Tag color={value.ready ? 'blue' : 'orange'}>{value.ready ? '符合' : '待確認'}</Tag><Typography.Text>{evidence(value, item, note)}</Typography.Text></Space>,
    }))} />
  </section>;
}

export type RepairReadinessPanelProps = RepairReadinessContext & { item: RepairItem; compact?: boolean };

export default function RepairReadinessPanel({ item, canUpdate, viewerId, handoffNote, compact = false }: RepairReadinessPanelProps) {
  const readiness = repairReadiness(item, { canUpdate, viewerId, handoffNote });
  const checks = readiness.showCompletion ? readiness.completionChecks : readiness.showStart ? readiness.startChecks : [];
  const missing = checks.filter(value => !value.ready);
  const pending = readiness.showStart && !readiness.startReady || readiness.showCompletion && !readiness.completionReady;
  const csr = item.repairWorkflow?.csr;
  const details = <Space direction="vertical" size={16} style={{ width: '100%' }}>
    <Descriptions size="small" column={1} items={[
      { key: 'csr', label: '客服交辦', children: csr ? `${CSR_STATUS[csr.status] || csr.status}${csr.ownerName ? ` · ${csr.ownerName}` : ''} · 檢修 ${revision(csr.inspectionRevision)} · 報價 ${revision(csr.quoteRevision)}` : item.receipt.category === 'RETURN' ? '不適用' : '尚未交辦' },
      { key: 'actual', label: '已保存處置', children: outcome(item.repairReport?.data.outcome) },
      ...(readiness.sourceMessage ? [{ key: 'source', label: '售後回覆', children: <span style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{readiness.sourceMessage}</span> }] : []),
    ]} />
    {readiness.showStart && <Checks title="開工條件" items={readiness.startChecks} item={item} note={handoffNote} />}
    {readiness.showCompletion && <Checks title="交回條件" items={readiness.completionChecks} item={item} note={handoffNote} />}
  </Space>;
  return <section className="repair-readiness-compact" aria-label="客服與放行">
    {pending && readiness.ownSigned && <Alert showIcon type="warning" message={`尚未可${readiness.showCompletion ? '交回' : '開工'}：${missing.slice(0, 2).map(value => labels[value.key] || value.label).join('、')}${missing.length > 2 ? `等 ${missing.length} 項待確認` : ''}`} />}
    {compact ? <Collapse ghost items={[{ key: 'checks', label: '客服與放行', forceRender: true, children: details }]} /> : details}
  </section>;
}
