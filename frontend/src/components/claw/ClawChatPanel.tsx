import { useEffect, useRef, useState } from 'react';
import { ClearOutlined, SendOutlined } from '@ant-design/icons';
import { useAI } from '../../contexts/AIContext';
import { aiService, type AiCopilotReply, type AiStatus, type KnowledgeLocale } from '../../services/ai.service';
import { hasAnyPermission } from '../../utils/access';
import type { User } from '../../types';
import { clawText } from './copy';
import { stagedOperationsEnabled } from '../../config/release';
import { guideDestination, requestErrorCode } from './state';

type ChatMessage = { id: number; role: 'user' | 'assistant'; content: string; result?: AiCopilotReply };

export default function ClawChatPanel({ active, user, entityId, currentPath, locale, onNavigate, onGuides }: {
  active: boolean; user: User; entityId?: string; currentPath: string; locale: KnowledgeLocale;
  onNavigate: (path: string) => void; onGuides: () => void;
}) {
  const t = (key: Parameters<typeof clawText>[1]) => clawText(locale, key);
  const { selectedModelId, setSelectedModelId, availableModels } = useAI();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [statusError, setStatusError] = useState(false);
  const [retry, setRetry] = useState(0);
  const sequence = useRef(0);
  const pending = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    aiService.getStatus().then(result => { if (!cancelled) { setStatus(result); setStatusError(false); } })
      .catch(() => { if (!cancelled) { setStatus(null); setStatusError(true); } });
    return () => { cancelled = true; };
  }, [active, retry]);
  useEffect(() => () => { sequence.current += 1; pending.current?.abort(); }, []);
  useEffect(() => {
    if (active) end.current?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'end' });
  }, [active, messages, loading]);

  const send = async (question = input) => {
    const text = question.trim();
    if (!text || loading || status?.available !== true) return;
    const requestSequence = ++sequence.current;
    const controller = new AbortController(); pending.current = controller;
    const history = messages.filter(message => message.role === 'user').slice(-6).map(message => ({ role: 'user' as const, content: message.content }));
    setMessages(current => [...current, { id: requestSequence * 2, role: 'user', content: text }]);
    setInput(''); setLoading(true);
    try {
      const result = await aiService.chat(text, entityId, selectedModelId, currentPath, history, locale, controller.signal);
      if (sequence.current !== requestSequence) return;
      setMessages(current => [...current, { id: requestSequence * 2 + 1, role: 'assistant', content: result.reply, result }]);
    } catch (failure) {
      if (sequence.current !== requestSequence) return;
      const code = requestErrorCode(failure);
      setMessages(current => [...(code === 'forbidden' || code === 'unauthorized' ? [] : current), { id: requestSequence * 2 + 1, role: 'assistant', content: t(code) }]);
    } finally {
      if (sequence.current === requestSequence) { setLoading(false); pending.current = null; }
    }
  };

  const prompts = [t('promptPage'), t('promptExpense'), t('promptAccess'),
    ...(hasAnyPermission(user, ['expense_self:read', 'accounts:read', 'purchase_orders:read']) ? [t('promptTotal')] : [])];
  return <div className="claw-chat" hidden={!active}>
    <div className="claw-chat-controls"><label><span>{t('aiModel')}</span><select aria-label={t('aiModel')} value={selectedModelId} disabled={loading || !availableModels.length} onChange={event => setSelectedModelId(event.target.value)}>
      {availableModels.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
    </select></label><button type="button" className="claw-icon-button" aria-label={t('clear')} title={t('clear')} disabled={loading} onClick={() => { sequence.current += 1; setMessages([]); setInput(''); }}><ClearOutlined /></button></div>
    {statusError && <div className="claw-notice" role="alert"><p>{t('aiStatusError')}</p><button type="button" className="claw-text-button" onClick={() => setRetry(value => value + 1)}>{t('retry')}</button></div>}
    {status?.available === false && <div className="claw-notice" role="status"><p>{t('aiOffline')}</p><button type="button" className="claw-text-button" onClick={onGuides}>{t('guides')}</button></div>}
    <div className="claw-chat-messages" role="log" aria-live="polite" aria-label={t('chat')}>
      {!messages.length && <div className="claw-chat-empty"><h3>{t('chatWelcome')}</h3><p>{t('chatHint')}</p><div className="claw-prompts">{prompts.map(prompt => <button type="button" key={prompt} disabled={loading || status?.available !== true} onClick={() => void send(prompt)}>{prompt}</button>)}</div></div>}
      {messages.map(message => <article key={message.id} className={`claw-message claw-message--${message.role}`}>
        <strong>{message.role === 'user' ? t('you') : message.result?.status === 'guide' ? t('guides') : 'Claw'}</strong>
        {message.result && ['unavailable', 'unsupported'].includes(message.result.status) && <span className="claw-status-badge">{t('unfinished')}</span>}
        <p>{message.content}</p>
        {message.result?.sources?.map((source, index) => <div className="claw-chat-source" key={`${source.title}-${index}`}>
          {guideDestination(source, stagedOperationsEnabled()) ? <button type="button" className="claw-text-button" onClick={() => onNavigate(guideDestination(source, stagedOperationsEnabled())!)}>{source.title}</button> : <span>{source.title}</span>}
          <small>{source.kind === 'knowledge' ? t('guides') : t('liveData')} · {source.detail}</small>
          {source.sourceVersion && <small>{t('version')} {source.sourceVersion}</small>}
        </div>)}
        {message.result && <small className="claw-answer-scope">{message.result.scope ? `${message.result.scope} · ` : ''}{new Date(message.result.checkedAt).toLocaleString(locale, { hour12: false })}</small>}
      </article>)}
      {loading && <div className="claw-loading" role="status">{t('thinking')}</div>}
      <div ref={end} />
    </div>
    <footer className="claw-footer"><form className="claw-composer" onSubmit={event => { event.preventDefault(); void send(); }}>
      <textarea aria-label={t('question')} placeholder={t('question')} value={input} rows={2} maxLength={2000} disabled={loading || status?.available !== true}
        onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} />
      <button type="submit" aria-label={t('send')} title={t('send')} disabled={loading || status?.available !== true || !input.trim()}><SendOutlined /></button>
    </form><p>{t('readOnly')}</p></footer>
  </div>;
}
