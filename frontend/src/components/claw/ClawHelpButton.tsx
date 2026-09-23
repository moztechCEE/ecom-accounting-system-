import { QuestionCircleOutlined } from '@ant-design/icons';
import type { ReactNode } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { hasAnyPermission } from '../../utils/access';
import { CLAW_HELP_EVENT, helpArticleId } from './state';

/** Pages provide an authored article ID; the library checks access again before showing it. */
export function ClawHelpButton({ article, children = '操作說明', permissions }: {
  article?: string;
  children?: ReactNode;
  permissions?: string[];
}) {
  const { user } = useAuth();
  if (!user || (article !== undefined && !helpArticleId({ article })) || (permissions?.length && !hasAnyPermission(user, permissions))) return null;
  return <button type="button" className="erp-claw-help-button" onClick={() => {
    window.dispatchEvent(new CustomEvent(CLAW_HELP_EVENT, { detail: { article } }));
  }}><QuestionCircleOutlined /> {children}</button>;
}
