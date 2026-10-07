import { Alert, Card, Collapse, Descriptions, Space, Tag, Typography } from 'antd';
import { repairReadiness } from './repair-readiness';
import type { RepairReadinessCheck, RepairReadinessContext } from './repair-readiness';
import type { RepairItem } from './repair-model';

function Checks({ title, items }: { title: string; items: RepairReadinessCheck[] }) {
  return <section aria-label={title}>
    <Typography.Title level={5}>{title}</Typography.Title>
    <ul style={{ margin: 0, paddingInlineStart: 22 }}>
      {items.map(item => <li key={item.key} style={{ marginBottom: 12 }}>
        <Space wrap size={6}><Typography.Text strong>{item.label}</Typography.Text><Tag color={item.ready ? 'blue' : 'orange'}>{item.ready ? '條件具備' : '待核對'}</Tag></Space>
        <Typography.Paragraph style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{item.detail}</Typography.Paragraph>
      </li>)}
    </ul>
  </section>;
}

export type RepairReadinessPanelProps = RepairReadinessContext & { item: RepairItem; compact?: boolean };

export default function RepairReadinessPanel({ item, canUpdate, viewerId, handoffNote, compact = false }: RepairReadinessPanelProps) {
  const readiness = repairReadiness(item, { canUpdate, viewerId, handoffNote });
  const pending = readiness.showStart && !readiness.startReady || readiness.showCompletion && !readiness.completionReady;
  const details = <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Descriptions size="small" column={1} items={[
        { key: 'csr', label: '原生客服交辦', children: readiness.csrEvidence },
        { key: 'actual', label: '已保存實際處置', children: readiness.actualOutcome },
        ...(readiness.sourceMessage ? [{ key: 'source', label: '售後來源回覆', children: <span style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{readiness.sourceMessage}</span> }] : []),
      ]} />
      {readiness.showStart && <Checks title="開始維修／替換核對" items={readiness.startChecks} />}
      {readiness.showCompletion && <Checks title="複驗與完成件交回核對" items={readiness.completionChecks} />}
      <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>以上依目前保存資料與本人作業條件顯示。送出時後端再核對；來源款項確認、實物簽收、收發接收、物流及正式庫存各有原生紀錄。</Typography.Paragraph>
    </Space>;
  return <Card size="small" className={compact ? 'repair-readiness-compact' : undefined} title={compact ? undefined : '作業條件與下一步'}>
    <Alert showIcon type={pending ? 'warning' : 'info'} message={readiness.title} description={readiness.nextStep} />
    {compact ? <Collapse ghost items={[{key:'checks',label:'查看核對條件與客服進度',forceRender:true,children:details}]} /> : details}
  </Card>;
}
