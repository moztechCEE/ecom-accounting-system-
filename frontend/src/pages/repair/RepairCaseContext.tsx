import { Card, Typography } from 'antd';
import { repairPrecheckView, type RepairItem } from './repair-model';
import RepairPrecheckReadOnly from './RepairPrecheckReadOnly';

export default function RepairCaseContext({item,entityId,expectedItemId}:{item:RepairItem;entityId:string;expectedItemId:string}) {
  if (item.id !== expectedItemId || item.entityId !== entityId) return null;
  const context=item.customerContext;
  const sameSource=item.receipt.sourceCaseId ? context?.sourceCaseId===item.receipt.sourceCaseId : !context?.sourceCaseId;
  const available=sameSource && context?.state==='AVAILABLE' && !!item.receipt.sourceCaseId
    && typeof context.customerIssue==='string' && !!context.customerIssue.trim();
  return <div className="repair-case-context">
    <Card title="顧客問題" className="repair-customer-issue">
      <Typography.Paragraph className="repair-customer-issue-text" type={available?undefined:'secondary'}>
        {available ? context.customerIssue : sameSource && context?.state==='NOT_PROVIDED' ? '未提供' : '顧客問題暫無法取得'}
      </Typography.Paragraph>
    </Card>
    <Card title="收發初檢">
      <RepairPrecheckReadOnly compact entityId={entityId} itemId={expectedItemId} record={repairPrecheckView(item.mailroomPrecheck,entityId,expectedItemId)} />
    </Card>
  </div>;
}
