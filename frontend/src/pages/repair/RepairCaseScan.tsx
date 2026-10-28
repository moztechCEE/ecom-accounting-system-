import { useEffect, useRef, useState } from 'react';
import { Button, Input, Tag, Typography, type InputRef } from 'antd';
import { ScanOutlined } from '@ant-design/icons';
import { repairService, type RepairCaseLookupResult, type RepairCaseLookupMatch } from '../../services/repair';
import { isRepairCaseLookupResult, repairScanInput, type RepairScanTarget } from './repair-case-scan-model';

type Props = {
  entityId:string; active:boolean; disabled?:boolean;
  onOpen:(target:RepairScanTarget)=>Promise<boolean>;
};
const accessToken = () => localStorage.getItem('access_token');

export default function RepairCaseScan({entityId,active,disabled=false,onOpen}:Props) {
  const [value,setValue] = useState(''), [failure,setFailure] = useState(''), [busy,setBusy] = useState(false);
  const [choices,setChoices] = useState<RepairCaseLookupResult|null>(null);
  const input = useRef<InputRef>(null), container = useRef<HTMLDivElement>(null);
  const generation = useRef(0), request = useRef<AbortController|null>(null), phase = useRef<'idle'|'lookup'|'opening'>('idle');
  const latest = useRef({entityId,active,disabled});
  latest.current = {entityId,active,disabled};
  const choiceScope = useRef<{entityId:string;token:string|null;generation:number}|null>(null);

  useEffect(() => {
    const requests=generation, pending=request;
    requests.current++;
    pending.current?.abort(); pending.current=null; phase.current='idle'; choiceScope.current=null;
    setValue(''); setFailure(''); setChoices(null); setBusy(false);
    return () => { requests.current++; pending.current?.abort(); };
  },[entityId]);

  useEffect(() => {
    if (disabled || (!active && phase.current !== 'opening')) {
      generation.current++; request.current?.abort(); request.current=null; phase.current='idle';
      choiceScope.current=null; setChoices(null); setBusy(false);
    }
    if (!active || disabled) return;
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && !container.current?.contains(focused)
      && (focused.matches('input,textarea,select') || focused.isContentEditable)) return;
    input.current?.focus({preventScroll:true});
  },[active,disabled,entityId]);

  const current = (scope:{entityId:string;token:string|null;generation:number},requireActive=true) =>
    scope.generation === generation.current && scope.entityId === latest.current.entityId
    && !latest.current.disabled && (!requireActive || latest.current.active) && scope.token === accessToken();

  const open = async (target:RepairScanTarget,scope:{entityId:string;token:string|null;generation:number}) => {
    if (!current(scope) || target.entityId !== scope.entityId || phase.current === 'opening') return;
    phase.current='opening'; setBusy(true);
    try {
      const accepted = await onOpen({entityId:target.entityId,itemId:target.itemId});
      if (accepted && current(scope,false)) { setValue(''); setChoices(null); setFailure(''); choiceScope.current=null; }
    } catch {
      if (current(scope,false)) setFailure('無法開啟案件，請重試');
    } finally {
      if (scope.generation === generation.current && scope.entityId === latest.current.entityId) { setBusy(false); phase.current='idle'; }
    }
  };

  const search = async () => {
    if (!active || disabled || busy || phase.current !== 'idle' || !entityId) return;
    request.current?.abort();
    const scope = {entityId,token:accessToken(),generation:++generation.current};
    const parsed = repairScanInput(value,window.location.origin,entityId);
    setChoices(null); choiceScope.current=null; setFailure('');
    if (parsed.kind === 'INVALID') { setFailure('請掃描有效標籤或輸入案件編號'); return; }
    if (parsed.kind === 'ITEM') { await open(parsed.target,scope); return; }
    const controller = new AbortController(); request.current=controller; phase.current='lookup'; setBusy(true);
    try {
      const result = await repairService.lookup(entityId,parsed.code,controller.signal);
      if (!current(scope)) return;
      if (!isRepairCaseLookupResult(result,entityId)) { setFailure('案件資料無法確認，請重試'); return; }
      if (result.limitExceeded) { setFailure('案件號碼無法唯一定位，請掃描實物標籤'); return; }
      if (result.kind === 'NOT_FOUND') { setFailure('找不到此案件'); return; }
      if (result.kind === 'MATCH') { await open(result.matches[0],scope); return; }
      choiceScope.current=scope; setChoices(result);
    } catch (error) {
      if (current(scope) && !controller.signal.aborted) {
        const status = (error as {response?:{status?:number}})?.response?.status;
        setFailure(status === 401 || status === 403 ? '沒有此案件的查閱權限' : '無法查詢案件，請重試');
      }
    } finally {
      if (scope.generation === generation.current && scope.entityId === latest.current.entityId) { setBusy(false); phase.current='idle'; }
      if (request.current === controller) request.current=null;
    }
  };

  const choose = async (match:RepairCaseLookupMatch) => {
    const scope = choiceScope.current;
    if (busy || phase.current !== 'idle' || !scope) return;
    if (!current(scope)) { setChoices(null); choiceScope.current=null; setFailure('登入狀態已變更，請重新掃描'); return; }
    await open(match,scope);
  };

  return <div className="repair-case-scan" ref={container} aria-busy={busy}>
    <Input.Search ref={input} aria-label="掃描 QR code 或輸入案件編號" prefix={<ScanOutlined/>}
      placeholder="掃描 QR code／輸入案件編號" enterButton="開啟案件" size="large" value={value}
      maxLength={600} disabled={disabled || !active || !entityId || (busy && phase.current === 'opening')} loading={busy}
      onChange={event => {
        generation.current++; request.current?.abort(); request.current=null; phase.current='idle';
        setBusy(false); setValue(event.target.value); setFailure(''); setChoices(null); choiceScope.current=null;
      }} onSearch={() => {void search();}}/>
    {failure && <Typography.Text className="repair-case-scan-feedback" type="danger" role="alert">{failure}</Typography.Text>}
    {active && choices && <div className="repair-case-scan-results" aria-label="選擇案件產品">
      <Typography.Text strong>{choices.kind === 'AMBIGUOUS' ? '案件號碼重複，請選擇產品' : '選擇產品'}</Typography.Text>
      <ul className="repair-case-scan-options">
        {choices.matches.map(match => <li key={match.itemId}>
          <Button className="repair-case-scan-option" disabled={busy || disabled} onClick={() => {void choose(match);}}>
            <span className="repair-case-scan-option-identity">
              <span className="repair-case-scan-option-name">{match.productName || match.label || '未命名產品'}</span>
              <span className="repair-case-scan-option-meta">{[match.label,match.receiptNumber].filter(Boolean).join(' · ')}</span>
            </span>
            {match.statusLabel && <Tag>{match.statusLabel}</Tag>}
          </Button>
        </li>)}
      </ul>
    </div>}
  </div>;
}
