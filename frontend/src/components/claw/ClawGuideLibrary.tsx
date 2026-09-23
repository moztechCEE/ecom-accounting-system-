import { useEffect, useRef, useState } from 'react';
import { ArrowLeftOutlined, ArrowRightOutlined, BookOutlined, DownloadOutlined, SearchOutlined } from '@ant-design/icons';
import { aiService, type AiKnowledgeEntry, type AiKnowledgeLibrary, type KnowledgeLocale } from '../../services/ai.service';
import { clawText } from './copy';
import { stagedOperationsEnabled } from '../../config/release';
import { currentKnowledge, currentPageArticle, guideCategories, guideDestination, requestErrorCode, safeExample, selectedArticle } from './state';

type Load = { key: string; data?: AiKnowledgeLibrary; error?: ReturnType<typeof requestErrorCode> };

export default function ClawGuideLibrary({ active, currentPath, locale, companyName, initialArticle, currentPageHelp, refreshVersion, onNavigate }: {
  active: boolean;
  currentPath: string;
  locale: KnowledgeLocale;
  companyName?: string;
  initialArticle?: string;
  currentPageHelp?: boolean;
  refreshVersion: number;
  onNavigate: (path: string) => void;
}) {
  const t = (key: Parameters<typeof clawText>[1]) => clawText(locale, key);
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'home' | 'browse' | 'article'>(initialArticle || currentPageHelp ? 'article' : 'home');
  const [selected, setSelected] = useState<string | null>(initialArticle ?? null);
  const [category, setCategory] = useState('');
  const [retry, setRetry] = useState(0);
  const [load, setLoad] = useState<Load | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const requestKey = JSON.stringify([currentPath, locale, query, retry, refreshVersion]);
  const data = currentKnowledge(load, requestKey);
  const error = load?.key === requestKey ? load.error : undefined;
  const entries = data?.entries ?? [];
  const contextArticle = currentPageHelp && !selected
    ? currentPageArticle(entries, currentPath)?.id ?? null : null;
  const article = view === 'article' ? selectedArticle(entries, selected ?? contextArticle) : null;
  const destination = article ? guideDestination(article, stagedOperationsEnabled()) : null;
  const categories = guideCategories(entries);
  const filtered = category ? entries.filter(entry => entry.category === category) : entries;

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    let cancelled = false;
    aiService.getKnowledge(query, currentPath, locale, controller.signal).then(result => {
      if (!cancelled) setLoad({ key: requestKey, data: result });
    }).catch(failure => {
      if (!cancelled) setLoad({ key: requestKey, error: requestErrorCode(failure) });
    });
    return () => { cancelled = true; controller.abort(); };
  }, [active, currentPath, locale, query, requestKey]);

  useEffect(() => { body.current?.scrollTo({ top: 0 }); }, [selected, query, view, locale]);

  const home = () => { setView('home'); setSelected(null); setInput(''); setQuery(''); setCategory(''); };
  const browse = () => { setView('browse'); setSelected(null); setInput(''); setQuery(''); setCategory(''); };
  const card = (entry: AiKnowledgeEntry) => <button type="button" className="guide-card" key={entry.id} onClick={() => { setSelected(entry.id); setView('article'); }}>
    <BookOutlined /><span><strong>{entry.title}</strong><small>{entry.summary}</small></span><ArrowRightOutlined />
  </button>;

  return <div className="claw-guide-library" hidden={!active}>
    <div className="claw-body" ref={body}>
      {error ? <div className="claw-notice" role="alert"><p>{t(error)}</p><button type="button" className="claw-text-button" onClick={() => setRetry(value => value + 1)}>{t('retry')}</button></div>
        : !data ? <p className="claw-loading" role="status">{t('loading')}</p>
        : article ? <article className="knowledge-article">
          <button type="button" className="back-link" onClick={() => { setSelected(null); setView('browse'); }}><ArrowLeftOutlined />{t('back')}</button>
          <small className="claw-brand">{article.category}</small>
          <h3>{article.title}</h3><p className="article-summary">{article.summary}</p>
          {article.sections.map((section, index) => <section key={`${article.id}-${index}`}><h4>{section.title}</h4><p>{section.body}</p></section>)}
          {destination && <button type="button" className="claw-destination" onClick={() => onNavigate(destination)}>{t('navigate')}<ArrowRightOutlined /></button>}
          {article.examples.length > 0 && <details className="claw-details"><summary>{t('examples')}</summary><p>{t('exampleNote')}</p>
            {article.examples.map(example => {
              const safe = safeExample(example);
              return safe ? <button className="claw-download" type="button" key={example.id} onClick={() => {
                const url = URL.createObjectURL(new Blob([safe.content], { type: safe.contentType }));
                const link = document.createElement('a'); link.href = url; link.download = safe.filename;
                document.body.appendChild(link); link.click(); link.remove();
                window.setTimeout(() => URL.revokeObjectURL(url), 0);
              }}><DownloadOutlined /><span>{example.title}<small>{example.filename}</small></span></button>
                : <p key={example.id}>{t('invalidExample')}</p>;
            })}
          </details>}
          <details className="claw-details"><summary>{t('sources')}</summary><p>{t('version')}：{article.sourceVersion}</p>
            <p>{t('updated')}：{new Date(data.checkedAt).toLocaleString(locale, { hour12: false })}</p>
            {article.sources.map(source => <div className="claw-source-file" key={source.path}><code>{source.path}</code><small>SHA-256 {source.sha256}</small></div>)}
          </details>
        </article>
        : view === 'article' ? <div className="claw-notice" role="status"><p>{t('inaccessible')}</p><button type="button" className="back-link" onClick={browse}><ArrowLeftOutlined />{t('browse')}</button></div>
        : view === 'browse' ? <div>
          <button type="button" className="back-link" onClick={home}><ArrowLeftOutlined />{t('home')}</button>
          <h3>{query ? t('results') : t('guides')}</h3>
          {categories.length > 1 && <label className="claw-category"><span>{t('category')}</span><select value={category} onChange={event => setCategory(event.target.value)}><option value="">{t('all')}</option>{categories.map(value => <option key={value} value={value}>{value}</option>)}</select></label>}
          {filtered.length ? <div className="guide-list">{filtered.map(card)}</div> : <p>{t('empty')}</p>}
        </div> : <div className="assistant-home">
          <small className="claw-brand">{companyName || 'Corely ERP'}</small><h3>{t('welcome')}</h3><p>{t('intro')}</p>
          <div className="guide-list">{entries.slice(0, 3).map(card)}</div>
          <button type="button" className="browse-guides" onClick={browse}>{t('browse')}<ArrowRightOutlined /></button>
          <small className="claw-library-version">{t('version')} {data.version}</small>
        </div>}
    </div>
    <footer className="claw-footer"><form onSubmit={event => {
      event.preventDefault(); setQuery(input.trim()); setView('browse'); setSelected(null); setCategory('');
    }}><input aria-label={t('searchLabel')} placeholder={t('search')} value={input} maxLength={160} autoComplete="off" onChange={event => setInput(event.target.value)} />
      <button type="submit" aria-label={t('searchLabel')}><SearchOutlined /></button></form><p>{t('readOnly')}</p>
    </footer>
  </div>;
}
