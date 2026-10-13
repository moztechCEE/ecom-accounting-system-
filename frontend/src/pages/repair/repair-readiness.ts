import { currentPhysicalCustody } from '../mailroom/item-custody';
import { CSR_STATUS, PLANS, RESULTS, companyCsrCurrent, refurbishmentStartReady, inspectionReviewCurrent, repairReportReady, repairStartReady, sourceQuoteConsentCurrent, sourceInvoiceCurrent, sourceItemQuoteBindingCurrent, sourceMaterialsCurrent, sourceTemplateCurrent, sourceDispositionCurrent, sourceWorkStartCurrent } from './repair-model';
import type { RepairItem } from './repair-model';

export type RepairReadinessContext = {
  canUpdate: boolean;
  viewerId?: string;
  handoffNote?: string;
};
export type RepairReadinessCheck = { key: string; label: string; ready: boolean; detail: string };
export type RepairReadiness = {
  ownSigned: boolean;
  startReady: boolean;
  reportReady: boolean;
  completionReady: boolean;
  showStart: boolean;
  showCompletion: boolean;
  showDisposition: boolean;
  dispositionReady: boolean;
  dispositionChecks: RepairReadinessCheck[];
  title: string;
  nextStep: string;
  startChecks: RepairReadinessCheck[];
  completionChecks: RepairReadinessCheck[];
  csrEvidence: string;
  sourceMessage?: string;
  actualOutcome: string;
};

const OUTCOMES = { REPAIRED: '原機實際維修', REPLACED: '實際替換', FACTORY_REPAIRED: '原廠處理返還' };
const revision = (value?: number | null) => Number.isInteger(value) && Number(value) > 0 ? `v${value}` : '未提供有效版次';
const date = (value?: string | null) => value && Number.isFinite(Date.parse(value))
  ? new Date(value).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }) : '未提供有效時間';
const check = (key: string, label: string, ready: boolean, detail: string): RepairReadinessCheck => ({ key, label, ready, detail });

/** Explain the existing saved-data gates. This projection never grants an action or changes a native state. */
export function repairReadiness(item: RepairItem, context: RepairReadinessContext): RepairReadiness {
  const inspection = item.repairInspection;
  const report = item.repairReport;
  const review = inspection?.review;
  const csr = item.repairWorkflow?.csr;
  const source = item.release;
  const info = source?.releaseInfo;
  const plan = inspection?.data.plan;
  const customerRepair = item.receipt.category === 'REPAIR';
  const companyReturn = item.receipt.category === 'RETURN';
  const nativeOriginalReturn = customerRepair && item.allowedWorkflowActions?.includes('return_original') === true;
  const waitingAcceptance = ['WAITING_REPAIR_ACCEPTANCE', 'PENDING_REFURBISH'].includes(item.status);
  const ownSigned = item.status !== 'DISPATCHED' && context.canUpdate && !!context.viewerId && item.repairOwnerId === context.viewerId
    && item.custodianId === context.viewerId && item.editable === true && (!companyReturn || currentPhysicalCustody(item)==='TECHNICIAN');
  const ownership = check('own_signed', '本人簽收與編輯', ownSigned, ownSigned
    ? '本人已簽收且可編輯'
    : !context.canUpdate ? '目前為唯讀'
      : waitingAcceptance ? '待本人點件簽收'
        : '本人簽收或編輯條件未確認');
  const quoteValid = !!info && Number.isInteger(info.quoteRevision) && info.quoteRevision > 0;
  const amountKnown = !!info && Number.isFinite(info.amount) && Number(info.amount) >= 0;
  const paymentCurrent = amountKnown && quoteValid && (info.amount === 0 || info.confirmedPaymentQuoteRevision === info.quoteRevision);
  const consentCurrent: boolean = sourceQuoteConsentCurrent(info);
  const csrBound = !!inspection && !!review?.planHash && !!csr
    && csr.inspectionRevision === inspection.revision && csr.estimateRevision === inspection.revision
    && csr.planHash === review.planHash && csr.quoteRevision === review.quoteRevision
    && Number.isInteger(review.quoteRevision) && Number(review.quoteRevision) > 0;
  const supportedStart = ['REPAIR', 'REPLACE'].includes(plan || '');
  const dispositionRoute = customerRepair && (plan==='RETURN' || plan==='SCRAP' || csr?.decision==='DECLINE');
  const dispositionRecorded = item.repairPrerequisites?.disposition?.scrapAuthorization?.state==='BLOCKED' && item.repairPrerequisites.disposition.scrapAuthorization.reason==='ALREADY_RECORDED' && !!item.repairPrerequisites.disposition.authorization;
  const showDisposition = dispositionRoute && !dispositionRecorded && ['REPAIR_RECEIVED','INSPECTING'].includes(item.status);
  const dispositionAction = plan==='SCRAP' || sourceDispositionCurrent(item,'record_scrap_authorization') && !sourceDispositionCurrent(item,'return_original') ? 'record_scrap_authorization' : 'return_original';
  const dispositionState = item.repairPrerequisites?.disposition?.[dispositionAction==='return_original'?'returnOriginal':'scrapAuthorization'];
  const dispositionChecks = [
    {...ownership,ready:ownership.ready && currentPhysicalCustody(item)==='TECHNICIAN',detail:ownership.ready && currentPhysicalCustody(item)!=='TECHNICIAN'?'目前實物持有未確認':ownership.detail},
    check('inspection','目前檢修單已提交',inspection?.status==='SUBMITTED',inspection?.status==='SUBMITTED'?`檢修 ${revision(inspection.revision)}`:'尚無已提交檢修單'),
    check('csr_versions','當版客服處置結果',inspectionReviewCurrent(inspection) && csr?.status==='RESOLVED' && csrBound && csr.decision===review?.decision,csrBound?`檢修 ${revision(inspection?.revision)} · 客服報價 ${revision(csr?.quoteRevision)}`:'客服處置結果或版次未確認'),
    check('disposition_auth','顧客處置授權',sourceDispositionCurrent(item,dispositionAction),sourceDispositionCurrent(item,dispositionAction)?dispositionAction==='return_original'?'原件退回授權已確認':'報廢授權已確認':!dispositionState || dispositionState.state==='UNKNOWN'?'處置授權暫無法取得':'目前處置授權未確認'),
  ];
  const dispositionReady = showDisposition && dispositionChecks.every(value=>value.ready);
  const startChecks = customerRepair ? [
    ownership,
    check('inspection', '目前檢修單已提交', inspection?.status === 'SUBMITTED', inspection
      ? `檢修 ${revision(inspection.revision)} · ${inspection.status === 'SUBMITTED' ? '已提交' : '草稿，尚未提交'}`
      : '尚無已提交檢修單'),
    check('start_stage', '開工作業階段與方案', item.status === 'INSPECTING' && supportedStart,
      plan === 'RETURN' ? '目前為原件退回方案'
        : plan === 'FACTORY' ? '目前為原廠處理方案'
          : `目前狀態：${item.statusLabel || item.status}；已保存方案：${plan ? PLANS[plan] : '尚未建立'}`),
    check('csr_decision', '客服本人接手與當版方案結果', inspectionReviewCurrent(inspection) && review?.decision === 'APPROVE'
      && csr?.status === 'RESOLVED' && csr.decision === 'APPROVE', csr
        ? `${CSR_STATUS[csr.status] || csr.status}；接手客服：${csr.ownerName || csr.ownerId || '未接手'}；本人接手：${date(csr.acceptedAt)}；方案結果：${csr.decision === 'APPROVE' ? '確認通過' : csr.decision === 'DECLINE' ? '拒修／不進行維修' : '尚未回覆'}。`
        : '尚無本版客服確認'),
    check('csr_versions', '客服檢修、估價、方案與報價版次一致', csrBound,
      `目前檢修 ${revision(inspection?.revision)}；客服交辦檢修 ${revision(csr?.inspectionRevision)}／估價 ${revision(csr?.estimateRevision)}；客服方案確認報價 ${revision(review?.quoteRevision)}／交辦報價 ${revision(csr?.quoteRevision)}；方案依據${csrBound ? '一致' : '未確認或不一致'}。`),
    check('source_release', '來源允許本次維修處理', source?.available === true && source.repairAllowed === true,
      source?.message || (source?.available === true && source.repairAllowed === true ? '來源放行已確認' : '尚未取得來源放行')),
    check('source_quote', '來源報價與客服確認版次一致', quoteValid && info.quoteRevision === review?.quoteRevision,
      `來源目前報價 ${revision(info?.quoteRevision)}；客服確認報價 ${revision(review?.quoteRevision)}`),
    check('customer_consent', '顧客同意目前報價版', consentCurrent, consentCurrent
      ? `來源記錄顧客同意 ${revision(info?.quoteRevision)} · ${date(info?.customerApprovedAt)}。`
      : `來源目前報價 ${revision(info?.quoteRevision)}；顧客同意版 ${revision(info?.customerApprovedQuoteRevision)}；同意時間：${date(info?.customerApprovedAt)}`),
    check('payment', '來源本版必要款項', paymentCurrent, !amountKnown
      ? '來源金額未確認'
      : info?.amount === 0 ? `來源本報價為 ${info.currency} 0，無需款項`
        : `來源報價 ${revision(info?.quoteRevision)} · ${info?.currency} ${info?.amount}；${paymentCurrent ? '來源確認本版必要款項' : `尚未確認本版必要款項（款項確認版 ${revision(info?.confirmedPaymentQuoteRevision)}）`}`),
    check('proposal_binding', '本件方案報價', sourceItemQuoteBindingCurrent(item), sourceItemQuoteBindingCurrent(item) ? `本件檢修 ${revision(inspection?.revision)} · 報價 ${revision(info?.quoteRevision)}` : '本件方案尚未綁定目前報價'),
    check('invoice', '必要發票', sourceInvoiceCurrent(info), sourceInvoiceCurrent(info) && info?.invoiceRequired!==true ? '本版無需發票' : info?.invoiceRequired!==true ? '發票需求未確認' : sourceInvoiceCurrent(info) ? `本版發票已開立 · 報價 ${revision(info.invoiceQuoteRevision)}` : `發票 ${info.invoiceStatus || '未提供'} · 發票報價 ${revision(info.invoiceQuoteRevision)}`),
    check('materials', '必要材料', sourceMaterialsCurrent(item), sourceMaterialsCurrent(item) ? '本版材料需求已符合' : item.repairPrerequisites?.materials?.start?.state==='UNKNOWN' ? '備料與實收待確認' : '本版材料需求或實收未齊'),
    check('test_standard', '檢測基準', sourceTemplateCurrent(item), sourceTemplateCurrent(item) ? '本版必要測項已確認' : '本版檢測基準或必要測項待確認'),
  ] : companyReturn ? [
    ownership,
    check('inspection','目前檢修單已提交',inspection?.status==='SUBMITTED',inspection?.status==='SUBMITTED'?`檢修 ${revision(inspection.revision)}`:'尚無已提交檢修單'),
    check('start_stage','整新開工階段與方案',['INSPECTING','REPAIR_RECEIVED','REFURBISHING'].includes(item.status) && plan==='REPAIR',plan==='REPAIR'?'原機整新方案':'目前方案不適用整新開工'),
    check('csr_decision','本版整新客服確認',companyCsrCurrent(item),companyCsrCurrent(item)?`客服已核准檢修 ${revision(inspection?.revision)}`:'本版整新客服確認未齊'),
    check('materials','開工材料',sourceMaterialsCurrent(item,'START'),sourceMaterialsCurrent(item,'START')?'開工材料已齊':'開工材料尚未齊'),
    check('test_standard','檢測基準',sourceTemplateCurrent(item,'INSPECTION'),sourceTemplateCurrent(item,'INSPECTION')?'本版必要測項已確認':'本版檢測基準待確認'),
  ] : [];

  const factoryPlan = plan === 'FACTORY';
  const supportedCompletion = ['REPAIR', 'REPLACE', 'FACTORY'].includes(plan || '');
  const unsupportedInternal = item.receipt.category === 'RETURN' && !!plan && plan !== 'REPAIR';
  const completionSupported = supportedCompletion && !unsupportedInternal;
  const outcomeMatches = plan === 'REPAIR' ? report?.data.outcome === 'REPAIRED'
    : plan === 'REPLACE' ? report?.data.outcome === 'REPLACED' && !!inspection?.data.replacementSku
      && report.data.replacementSku === inspection.data.replacementSku && !!inspection.data.replacementCondition
      && report.data.replacementCondition === inspection.data.replacementCondition
      : factoryPlan ? report?.data.outcome === 'FACTORY_REPAIRED' : false;
  const checks = report?.data.checks || [];
  const unresolved = checks.filter(value => value.result !== 'PASS');
  const completionStage = factoryPlan ? item.allowedWorkflowActions?.includes('complete_factory') === true
    : ['REPAIRING', 'REFURBISHING'].includes(item.status);
  // Completion rechecks customer release as well; having started earlier cannot preserve an old source approval.
  const completionReleaseChecks = customerRepair ? startChecks.filter(value => [
    'csr_decision', 'csr_versions', 'source_release', 'source_quote', 'customer_consent', 'payment', 'proposal_binding', 'invoice',
  ].includes(value.key)) : companyReturn ? [
    check('csr_decision','本版整新客服確認',companyCsrCurrent(item),companyCsrCurrent(item)?`客服已核准檢修 ${revision(inspection?.revision)}`:'本版整新客服確認未齊'),
    check('work_start','本版整新開工',sourceWorkStartCurrent(item),sourceWorkStartCurrent(item)?'本版整新已開始':item.repairPrerequisites?.workStart?.state==='UNKNOWN' || !item.repairPrerequisites?.workStart?'整新開工紀錄暫無法確認':'尚無本版整新開工紀錄'),
  ] : [];
  const completionChecks = [
    ownership,
    check('completion_stage', '交回作業階段與方案', completionStage && completionSupported, unsupportedInternal
      ? '目前整新方案不適用完成件交回'
      : plan === 'RETURN'
      ? '目前為原件退回方案'
      : factoryPlan ? '原廠返還簽收與交回權限待確認'
        : `目前狀態：${item.statusLabel || item.status}`),
    check('inspection', '目前檢修單已提交', inspection?.status === 'SUBMITTED', inspection
      ? `檢修 ${revision(inspection.revision)} · ${inspection.status === 'SUBMITTED' ? '已提交' : '草稿'}。` : '尚無已提交檢修單。'),
    check('report', '實際處置維修單已提交', report?.status === 'SUBMITTED', report
      ? `維修 ${revision(report.revision)} · ${report.status === 'SUBMITTED' ? '已提交' : '草稿'}；實際處置：${OUTCOMES[report.data.outcome] || report.data.outcome}`
      : '尚無已提交維修單'),
    check('report_revision', '維修單依據目前檢修版', !!inspection && !!report && report.inspectionRevision === inspection.revision,
      `目前檢修 ${revision(inspection?.revision)}；維修單依據檢修 ${revision(report?.inspectionRevision)}`),
    check('outcome', '實際處置與已提交方案一致', outcomeMatches,
      plan === 'REPLACE' ? `方案替換 SKU：${inspection?.data.replacementSku || '未提供'}／品況：${inspection?.data.replacementCondition === 'NEW' ? '全新品' : inspection?.data.replacementCondition === 'REFURBISHED' ? '合格整新品' : '未提供'}；實際替換 SKU：${report?.data.replacementSku || '未提供'}／品況：${report?.data.replacementCondition === 'NEW' ? '全新品' : report?.data.replacementCondition === 'REFURBISHED' ? '合格整新品' : '未提供'}。`
        : `已保存方案：${plan ? PLANS[plan] : '未提供'}；實際處置：${report ? OUTCOMES[report.data.outcome] || report.data.outcome : '尚無維修紀錄'}。`),
    check('qc', '總複驗通過', report?.data.qcResult === 'PASS', `總複驗：${report ? RESULTS[report.data.qcResult] || report.data.qcResult : '尚未記錄'}；${report?.data.qcNotes || '尚無複驗說明'}`),
    check('checks', '逐項複驗通過', checks.length > 0 && unresolved.length === 0, !checks.length
      ? '尚無逐項複驗'
      : unresolved.length ? unresolved.map(value => `${value.name || '未命名項目'}：${RESULTS[value.result] || value.result}（${value.observation || '尚無觀察／未測原因'}）`).join('；')
        : `已保存 ${checks.length} 項複驗通過`),
    ...completionReleaseChecks,
    check('materials', '必要材料', sourceMaterialsCurrent(item, 'COMPLETION'), sourceMaterialsCurrent(item, 'COMPLETION') ? '本版材料需求已符合' : '本版材料需求或實收未齊'),
    check('test_standard', '檢測基準', sourceTemplateCurrent(item, 'COMPLETION'), sourceTemplateCurrent(item, 'COMPLETION') ? '本版必要複驗已確認' : '本版檢測基準或必要複驗待確認'),
    ...(factoryPlan ? [check('factory_receipt', '原廠實際返還與同一委修依據', item.repairWorkflow?.factory?.stage === 'RETURNED'
      && item.repairWorkflow.factory.physicalCustody === 'TECHNICIAN' && !!report?.data.factoryReference
      && report.data.factoryReference === item.repairWorkflow.factory.reference,
    `原廠返還階段：${item.repairWorkflow?.factory?.stage || '未提供'}；送修委修單：${item.repairWorkflow?.factory?.reference || '未提供'}／維修單委修單：${report?.data.factoryReference || '未提供'}。`)] : [check('handoff_note', '交回品況與配件說明', !!context.handoffNote?.trim(), context.handoffNote?.trim()
      ? '交回說明已填寫' : '交回品況與配件說明未填')]),
  ];

  // Keep the native predicates as the final saved-document checks, rather than deriving permission from labels.
  const startReady = ownSigned && !dispositionRoute && !nativeOriginalReturn && (companyReturn?refurbishmentStartReady(item):repairStartReady(item));
  const reportReady = repairReportReady(item);
  const completionReady = ownSigned && !nativeOriginalReturn && completionStage && completionSupported && reportReady
    && completionChecks.every(value => value.ready) && (factoryPlan || !!context.handoffNote?.trim());
  const showStart = !dispositionRoute && !nativeOriginalReturn && !factoryPlan && plan !== 'RETURN' && plan !== 'SCRAP'
    && (customerRepair && ['REPAIR_RECEIVED', 'INSPECTING', 'WAITING_CUSTOMER'].includes(item.status) || companyReturn && !sourceWorkStartCurrent(item) && ['REPAIR_RECEIVED','INSPECTING','REFURBISHING','WAITING_CUSTOMER'].includes(item.status));
  // A returned factory item can need renewed CSR review even when the server withholds completion authority.
  const factoryReturned = factoryPlan && item.status === 'INSPECTING'
    && item.repairWorkflow?.factory?.stage === 'RETURNED' && currentPhysicalCustody(item) === 'TECHNICIAN';
  const showCompletion = !nativeOriginalReturn && (!companyReturn || sourceWorkStartCurrent(item) || report?.status==='SUBMITTED' || unsupportedInternal) && (supportedCompletion || unsupportedInternal) && (completionStage || factoryReturned || item.status === 'REFURBISHING')
    && !['WAITING_RETURN_ACCEPTANCE', 'READY_FOR_DISPATCH', 'STOCKED', 'PENDING_WELFARE_STOCK'].includes(item.status);
  const csrEvidence = csr
    ? `${CSR_STATUS[csr.status] || csr.status}；接手客服：${csr.ownerName || csr.ownerId || '未接手'}；交辦檢修 ${revision(csr.inspectionRevision)}／估價 ${revision(csr.estimateRevision)}／報價 ${revision(csr.quoteRevision)}；本人接手時間：${date(csr.acceptedAt)}；回覆時間：${date(csr.resolvedAt)}。`
    : customerRepair ? '尚無客服交辦紀錄' : '尚無本版整新客服確認';
  let title = '依目前保存紀錄核對下一步';
  let nextStep = '目前作業條件待確認';
  if (waitingAcceptance) {
    title = '待認領／本人實物簽收';
    nextStep = !context.canUpdate ? '目前為唯讀，待本人簽收'
      : item.nextUserId === context.viewerId ? '已交辦本人，待點件簽收'
        : !item.nextUserId && !item.repairOwnerId ? '尚未認領或簽收'
          : `等待${item.nextUserName || '指定維修接手人'}本人點件簽收`;
  } else if (item.status === 'WAITING_RETURN_ACCEPTANCE') {
    title = item.repairWorkflow?.release?.purpose === 'RETURN_UNREPAIRED' ? '未修原件已交辦收發室，待本人接收' : '已交辦收發室，待本人接收';
    nextStep = `等待${item.nextUserName || '收發室接手人'}本人點件簽收`;
  } else if (item.status === 'PENDING_WELFARE_STOCK') {
    title = '已交回收發室，後續合格與正式入庫另核對';
    nextStep = '收發已接收，待合格與正式入庫核對';
  } else if (item.status === 'READY_FOR_DISPATCH') {
    title = '交回後續由收發室安排寄回';
    nextStep = '待收發安排寄回';
  } else if (item.status === 'DISPATCHED') {
    title = '已交物流寄回，待顧客收件';
    nextStep = '已交運，待顧客收件確認';
  } else if (['FACTORY_OUTBOUND', 'FACTORY_RECEIVED', 'FACTORY_RETURNING'].includes(item.status)) {
    title = '原廠處理與實物返還各自核對';
    nextStep = item.repairWorkflow?.factory?.cancelled && item.status !== 'FACTORY_RETURNING'
      ? '原廠處理已取消，實物尚未返還'
      : item.status === 'FACTORY_RETURNING' ? '返還途中，待本人簽收'
        : item.status === 'FACTORY_OUTBOUND' ? '已交運，待原廠收件'
          : '原廠已收件，待實際返還';
  } else if (unsupportedInternal) {
    title = '公司退貨整新方案不支援此完成流程';
    nextStep = '目前整新方案不適用完成件交回';
  } else if (dispositionRecorded) {
    title = '本版報廢授權已記錄';
    nextStep = '授權紀錄已保存。';
  } else if (showDisposition) {
    title = dispositionReady ? dispositionAction==='return_original'?'原件退回授權已確認':'報廢授權已確認' : '原件處置待確認';
    nextStep = dispositionReady ? dispositionAction==='return_original'?'核對未修原件與配件。':'記錄本版顧客授權。' : dispositionChecks.find(value=>!value.ready)?.detail || '處置授權暫無法取得';
  } else if (plan === 'SCRAP') {
    title = '報廢建議待核准';
    nextStep = '保留本版檢修與原件紀錄。';
  } else if (plan === 'RETURN' || nativeOriginalReturn) {
    title = '保留未修原件，依拒修／退回流程交接';
    nextStep = '依本版原件退回授權交接';
  } else if (!ownSigned && !['STOCKED', 'COLLECTED'].includes(item.status)) {
    title = '目前登入本人尚不具備此件作業條件';
    nextStep = ownership.detail;
  } else if (item.status === 'REPAIR_RECEIVED') {
    title = '本人已簽收，下一步開始檢測';
    nextStep = '待檢測與本版檢修單';
  } else if (showCompletion) {
    title = completionReady ? '目前具備送出交回核對的條件' : '完成件交回仍有待核對條件';
    nextStep = completionReady
      ? factoryPlan ? '返還件複驗條件已齊'
        : '本版交回條件已齊'
      : '本版維修單或複驗條件未齊';
  } else if (showStart) {
    title = startReady ? '本版開工條件已齊' : companyReturn?'整新開工條件待確認':'維修開工條件待確認';
    nextStep = startReady ? '本版開工條件已齊'
      : '本版開工條件未齊';
  } else if (factoryPlan && currentPhysicalCustody(item) === 'TECHNICIAN') {
    title = '送原廠與返還複驗依實際作業處理';
    nextStep = '原廠處理與返還複驗待確認';
  }
  return { ownSigned, startReady, reportReady, completionReady, showStart, showCompletion, showDisposition, dispositionReady, dispositionChecks, title, nextStep,
    startChecks, completionChecks, csrEvidence, sourceMessage: source?.message || undefined,
    actualOutcome: report ? `${OUTCOMES[report.data.outcome] || report.data.outcome} · 維修 ${revision(report.revision)} · ${report.status === 'SUBMITTED' ? '已提交' : '草稿'}` : '尚無維修單實際處置紀錄' };
}
