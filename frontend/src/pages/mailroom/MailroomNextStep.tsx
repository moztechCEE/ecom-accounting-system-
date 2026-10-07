import { Alert, Button } from 'antd';
import type { Item } from './model';
import { ACTIONS } from './model';
import { mailroomNextStep } from './mailroom-workflow';

export default function MailroomNextStep({ item, actions, onAction, disabled = false }: {
  item: Item; actions: string[]; onAction: (action: string) => void; disabled?: boolean;
}) {
  const step = mailroomNextStep(item);
  const action = step.action && actions.includes(step.action) ? step.action : undefined;
  return <Alert className="mailroom-next-step" showIcon type={step.tone} message={`下一步：${step.title}`}
    description={step.description}
    action={action && <Button disabled={disabled} onClick={() => onAction(action)}>{ACTIONS[action]}</Button>} />;
}
