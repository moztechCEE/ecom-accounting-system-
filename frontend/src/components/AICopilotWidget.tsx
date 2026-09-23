import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CloseOutlined, BookOutlined, MessageOutlined } from '@ant-design/icons';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { listEntities, type Entity } from '../services/entities.service';
import type { KnowledgeLocale } from '../services/ai.service';
import type { User } from '../types';
import { ClawGreeting, ClawMascot } from './claw/ClawMascot';
import ClawGuideLibrary from './claw/ClawGuideLibrary';
import ClawChatPanel from './claw/ClawChatPanel';
import { clawText } from './claw/copy';
import { CLAW_HELP_EVENT, clawScopeKey, focusWrapIndex, helpArticleId, safeGuidePath } from './claw/state';
import './AICopilotWidget.css';
import './claw/mascot.css';

export default function AICopilotWidget() {
  const { user } = useAuth();
  return user ? <ClawWidget key={clawScopeKey(user)} user={user} /> : null;
}

function ClawWidget({ user }: { user: User }) {
  const [open, setOpen] = useState(false);
  const [openVersion, setOpenVersion] = useState(0);
  const [tab, setTab] = useState<'guides' | 'chat'>('guides');
  const [locale, setLocale] = useState<KnowledgeLocale>('zh-TW');
  const [entities, setEntities] = useState<Entity[]>([]);
  const [entityId, setEntityId] = useState<string>();
  const [companyError, setCompanyError] = useState(false);
  const [help, setHelp] = useState<{ id?: string; nonce: number; currentPage?: boolean }>({ nonce: 0 });
  const [mobile, setMobile] = useState(() => matchMedia('(max-width: 640px)').matches);
  const [composerFocused, setComposerFocused] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const id = useId();
  const t = (key: Parameters<typeof clawText>[1]) => clawText(locale, key);
  const show = () => { setOpenVersion(value => value + 1); setOpen(true); };

  useEffect(() => {
    const onHelp = (event: Event) => {
      const detail: unknown = (event as CustomEvent).detail;
      const article = helpArticleId(detail);
      if (!article && (detail as { article?: unknown } | null)?.article !== undefined) return;
      setHelp(current => ({ id: article ?? undefined, nonce: current.nonce + 1, currentPage: !article }));
      setTab('guides'); setOpenVersion(value => value + 1); setOpen(true);
    };
    window.addEventListener(CLAW_HELP_EVENT, onHelp);
    return () => window.removeEventListener(CLAW_HELP_EVENT, onHelp);
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    listEntities({ isActive: true }).then(result => {
      if (cancelled) return;
      setEntities(result); setCompanyError(false);
      setEntityId(current => result.some(entity => entity.id === current) ? current
        : result.find(entity => entity.id === localStorage.getItem('entityId'))?.id || result[0]?.id);
    }).catch(() => { if (!cancelled) { setEntities([]); setEntityId(undefined); setCompanyError(true); } });
    return () => { cancelled = true; };
  }, [open, openVersion]);

  useEffect(() => {
    const media = matchMedia('(max-width: 640px)');
    const viewport = window.visualViewport;
    const updateMobile = () => setMobile(media.matches);
    const updateViewport = () => {
      root.current?.style.setProperty('--claw-vh', `${viewport?.height ?? window.innerHeight}px`);
      root.current?.style.setProperty('--claw-vtop', `${viewport?.offsetTop ?? 0}px`);
    };
    const focus = () => queueMicrotask(() => {
      if (!root.current) return;
      const active = document.activeElement;
      setComposerFocused(Boolean(active && !root.current.contains(active) && active.matches('input, textarea, [contenteditable="true"]')));
    });
    updateViewport();
    media.addEventListener('change', updateMobile);
    viewport?.addEventListener('resize', updateViewport); viewport?.addEventListener('scroll', updateViewport);
    window.addEventListener('resize', updateViewport);
    document.addEventListener('focusin', focus); document.addEventListener('focusout', focus);
    return () => {
      media.removeEventListener('change', updateMobile);
      viewport?.removeEventListener('resize', updateViewport); viewport?.removeEventListener('scroll', updateViewport);
      window.removeEventListener('resize', updateViewport);
      document.removeEventListener('focusin', focus); document.removeEventListener('focusout', focus);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    if (mobile) document.body.style.overflow = 'hidden';
    closeButton.current?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); }
      if (!mobile || event.key !== 'Tab') return;
      const nodes = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), summary, [tabindex="0"]') ?? []).filter(node => node.tabIndex >= 0 && node.getClientRects().length > 0);
      const next = focusWrapIndex(nodes.length, nodes.indexOf(document.activeElement as HTMLElement), event.shiftKey);
      if (next !== null) { event.preventDefault(); nodes[next]?.focus(); }
    };
    document.addEventListener('keydown', keyboard);
    return () => {
      document.removeEventListener('keydown', keyboard);
      if (mobile) document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [open, mobile]);

  const go = (path: string) => { const destination = safeGuidePath(path); if (destination) { navigate(destination); setOpen(false); } };
  return createPortal(<div className="erp-claw" ref={root}>
    <button type="button" hidden={open} className={`claw-launcher mascot-interaction${composerFocused ? ' composer-focused' : ''}`} aria-label={t('open')} title={t('open')} aria-haspopup="dialog" aria-expanded={open} onClick={show}>
      <ClawMascot variant="launcher" /><span className="launcher-label">Corely Claw</span>
    </button>
    {open && mobile && <div className="claw-backdrop" aria-hidden="true" onClick={() => setOpen(false)} />}
    <section className="claw-panel" ref={panel} hidden={!open} role="dialog" aria-modal={mobile || undefined} aria-labelledby={`${id}-title`}>
      <header className="claw-header"><ClawGreeting label={t('greeting')} /><div className="claw-heading"><h2 id={`${id}-title`}>Corely Claw</h2><span>{t('mode')}</span></div>
        <select className="claw-locale" aria-label="語言 / Language" value={locale} onChange={event => setLocale(event.target.value as KnowledgeLocale)}><option value="zh-TW">繁中</option><option value="en">EN</option></select>
        <button ref={closeButton} type="button" className="claw-icon-button" aria-label={t('close')} onClick={() => setOpen(false)}><CloseOutlined /></button>
      </header>
      <div className="claw-company"><label htmlFor={`${id}-company`}>{t('company')}</label><select id={`${id}-company`} value={entityId ?? ''} disabled={!entities.length} onChange={event => { setEntityId(event.target.value); setHelp({ nonce: 0 }); }}>
        {!entityId && <option value="">{t('chooseCompany')}</option>}{entities.map(entity => <option key={entity.id} value={entity.id}>{entity.name}</option>)}
      </select></div>
      {companyError && <div className="claw-notice" role="alert">{t('companyError')}</div>}
      <div className="claw-tabs" role="tablist" aria-label="Corely Claw" onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 'guides' : event.key === 'End' ? 'chat' : tab === 'guides' ? 'chat' : 'guides';
        setTab(next); document.getElementById(`${id}-${next}-tab`)?.focus();
      }}>
        <button type="button" role="tab" id={`${id}-guides-tab`} tabIndex={tab === 'guides' ? 0 : -1} aria-controls={`${id}-guides`} aria-selected={tab === 'guides'} onClick={() => setTab('guides')}><BookOutlined />{t('guides')}</button>
        <button type="button" role="tab" id={`${id}-chat-tab`} tabIndex={tab === 'chat' ? 0 : -1} aria-controls={`${id}-chat`} aria-selected={tab === 'chat'} onClick={() => setTab('chat')}><MessageOutlined />{t('chat')}</button>
      </div>
      <div className="claw-tab-panel" id={`${id}-guides`} role="tabpanel" aria-labelledby={`${id}-guides-tab`} hidden={tab !== 'guides'}>
        <ClawGuideLibrary key={`${entityId ?? ''}:${help.nonce}`} active={open && tab === 'guides'} currentPath={location.pathname} locale={locale} companyName={entities.find(entity => entity.id === entityId)?.name} initialArticle={help.id} currentPageHelp={help.currentPage} refreshVersion={openVersion} onNavigate={go} />
      </div>
      <div className="claw-tab-panel" id={`${id}-chat`} role="tabpanel" aria-labelledby={`${id}-chat-tab`} hidden={tab !== 'chat'}>
        <ClawChatPanel key={entityId ?? ''} active={open && tab === 'chat'} user={user} entityId={entityId} currentPath={location.pathname} locale={locale} onNavigate={go} onGuides={() => setTab('guides')} />
      </div>
    </section>
  </div>, document.body);
}
