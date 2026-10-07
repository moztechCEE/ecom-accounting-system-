import { currentPhysicalCustody } from '../mailroom/item-custody';
import { CSR_STATUS, PLANS, RESULTS, inspectionReviewCurrent, repairReportReady, repairStartReady, sourceQuoteConsentCurrent } from './repair-model';
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
  const nativeOriginalReturn = customerRepair && item.allowedWorkflowActions?.includes('return_original') === true;
  const waitingAcceptance = ['WAITING_REPAIR_ACCEPTANCE', 'PENDING_REFURBISH'].includes(item.status);
  const ownSigned = context.canUpdate && !!context.viewerId && item.repairOwnerId === context.viewerId
    && item.custodianId === context.viewerId && item.editable === true;
  const ownership = check('own_signed', '本人簽收與編輯', ownSigned, ownSigned
    ? '目前登錄的維修負責人、實物保管人與登入本人一致，且此件可編輯。'
    : !context.canUpdate ? '此登入身分沒有維修編輯權；可檢視保存紀錄。'
      : waitingAcceptance ? '認領與本人收到實物分開；先按原交辦安排點件、核對位置並本人簽收。'
        : '目前負責人、實物保管人或可編輯條件未與登入本人一致；由目前接手人處理，不可代簽。');
  const quoteValid = !!info && Number.isInteger(info.quoteRevision) && info.quoteRevision > 0;
  const amountKnown = !!info && Number.isFinite(info.amount) && Number(info.amount) >= 0;
  const paymentCurrent = amountKnown && quoteValid && (info.amount === 0 || info.confirmedPaymentQuoteRevision === info.quoteRevision);
  const consentCurrent: boolean = sourceQuoteConsentCurrent(info);
  const csrBound = !!inspection && !!review?.planHash && !!csr
    && csr.inspectionRevision === inspection.revision && csr.estimateRevision === inspection.revision
    && csr.planHash === review.planHash && csr.quoteRevision === review.quoteRevision
    && Number.isInteger(review.quoteRevision) && Number(review.quoteRevision) > 0;
  const supportedStart = ['REPAIR', 'REPLACE'].includes(plan || '');
  const startChecks = customerRepair ? [
    ownership,
    check('inspection', '目前檢修單已提交', inspection?.status === 'SUBMITTED', inspection
      ? `檢修 ${revision(inspection.revision)} · ${inspection.status === 'SUBMITTED' ? '已提交' : '草稿，尚未提交'}。保存新檢修版本後須重新核對客服與維修單。`
      : '尚無檢修單；先完成真實檢測並提交檢修單。'),
    check('start_stage', '開工作業階段與方案', item.status === 'INSPECTING' && supportedStart,
      plan === 'RETURN' ? '原件退回不走開始維修或維修完成；保留未修原件品況與配件，依原件退回作業處理。'
        : plan === 'FACTORY' ? '送原廠走原廠交運、收件、實際返還與本人複驗作業，不走開始維修。'
          : `目前狀態：${item.statusLabel || item.status}；已保存方案：${plan ? PLANS[plan] : '尚未建立'}。開始維修／替換須在檢測中。`),
    check('csr_decision', '客服本人接手與當版方案結果', inspectionReviewCurrent(inspection) && review?.decision === 'APPROVE'
      && csr?.status === 'RESOLVED' && csr.decision === 'APPROVE', csr
        ? `${CSR_STATUS[csr.status] || csr.status}；接手客服：${csr.ownerName || csr.ownerId || '尚未提供本人接手紀錄'}；本人接手：${date(csr.acceptedAt)}；方案結果：${csr.decision === 'APPROVE' ? '確認通過' : csr.decision === 'DECLINE' ? '拒修／不進行維修' : '尚未回覆'}。`
        : '尚無原生客服交辦結果；提交檢修單後交客服本人接手與確認。'),
    check('csr_versions', '客服檢修、估價、方案與報價版次一致', csrBound,
      `目前檢修 ${revision(inspection?.revision)}；客服交辦檢修 ${revision(csr?.inspectionRevision)}／估價 ${revision(csr?.estimateRevision)}；客服方案確認報價 ${revision(review?.quoteRevision)}／交辦報價 ${revision(csr?.quoteRevision)}；方案依據${csrBound ? '一致' : '未齊備或不一致，須重新交客服核對'}。`),
    check('source_release', '來源允許本次維修處理', source?.available === true && source.repairAllowed === true,
      source?.message || (source?.available === true && source.repairAllowed === true ? '來源目前提供維修放行；仍須逐項核對當版方案、顧客同意與必要款項。' : '尚未取得可用的來源維修放行。')),
    check('source_quote', '來源報價與客服確認版次一致', quoteValid && info.quoteRevision === review?.quoteRevision,
      `來源目前報價 ${revision(info?.quoteRevision)}；客服確認報價 ${revision(review?.quoteRevision)}。舊版同意或客服結果不能放行新報價。`),
    check('customer_consent', '顧客同意目前報價版', consentCurrent, consentCurrent
      ? `來源記錄顧客同意 ${revision(info?.quoteRevision)} · ${date(info?.customerApprovedAt)}。`
      : `來源目前報價 ${revision(info?.quoteRevision)}；顧客同意版 ${revision(info?.customerApprovedQuoteRevision)}；同意時間：${date(info?.customerApprovedAt)}。免費方案也須有本報價版顧客同意。`),
    check('payment', '來源本版必要款項', paymentCurrent, !amountKnown
      ? '來源金額未提供或無效，不能當成免費方案；由客服／會計核對。'
      : info?.amount === 0 ? `來源本報價為 ${info.currency} 0，無需款項；仍須本報價版顧客同意。`
        : `來源報價 ${revision(info?.quoteRevision)} · ${info?.currency} ${info?.amount}；${paymentCurrent ? '來源確認本版必要款項' : `尚未確認本版必要款項（款項確認版 ${revision(info?.confirmedPaymentQuoteRevision)}）`}。此處只讀來源確認紀錄，不代替銀行實收或會計對帳。`),
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
    'csr_decision', 'csr_versions', 'source_release', 'source_quote', 'customer_consent', 'payment',
  ].includes(value.key)) : [];
  const completionChecks = [
    ownership,
    check('completion_stage', '交回作業階段與方案', completionStage && completionSupported, unsupportedInternal
      ? '公司退貨整新目前只支援原機維修的完成件交回；替換、送原廠或原件退回方案不支援此完成流程。保留已填實際處置，由協調窗口核對後續處理，不能改填原機維修冒充完成。'
      : plan === 'RETURN'
      ? '原件退回不能記成維修完成；使用原件未修退回作業，保留拒修原因、原件與配件。'
      : factoryPlan ? '原廠處理須已實際返還並由本人簽收，且伺服器明確允許原廠複驗交回作業。'
        : `目前狀態：${item.statusLabel || item.status}；原機修理／替換或公司整新依原作業階段交回。`),
    check('inspection', '目前檢修單已提交', inspection?.status === 'SUBMITTED', inspection
      ? `檢修 ${revision(inspection.revision)} · ${inspection.status === 'SUBMITTED' ? '已提交' : '草稿'}。` : '尚無已提交檢修單。'),
    check('report', '實際處置維修單已提交', report?.status === 'SUBMITTED', report
      ? `維修 ${revision(report.revision)} · ${report.status === 'SUBMITTED' ? '已提交' : '草稿'}；實際處置：${OUTCOMES[report.data.outcome] || report.data.outcome}。保留原記錄，不因建議方案改寫實際處置。`
      : '尚無維修單；只填寫實際修理、替換或原廠處理。未修原件不補造維修紀錄。'),
    check('report_revision', '維修單依據目前檢修版', !!inspection && !!report && report.inspectionRevision === inspection.revision,
      `目前檢修 ${revision(inspection?.revision)}；維修單依據檢修 ${revision(report?.inspectionRevision)}。檢修改版後須依新方案核對並重新提交維修單。`),
    check('outcome', '實際處置與已提交方案一致', outcomeMatches,
      plan === 'REPLACE' ? `方案替換 SKU：${inspection?.data.replacementSku || '未提供'}／品況：${inspection?.data.replacementCondition === 'NEW' ? '全新品' : inspection?.data.replacementCondition === 'REFURBISHED' ? '合格整新品' : '未提供'}；實際替換 SKU：${report?.data.replacementSku || '未提供'}／品況：${report?.data.replacementCondition === 'NEW' ? '全新品' : report?.data.replacementCondition === 'REFURBISHED' ? '合格整新品' : '未提供'}。`
        : `已保存方案：${plan ? PLANS[plan] : '未提供'}；實際處置：${report ? OUTCOMES[report.data.outcome] || report.data.outcome : '尚無維修紀錄'}。`),
    check('qc', '總複驗通過', report?.data.qcResult === 'PASS', `總複驗：${report ? RESULTS[report.data.qcResult] || report.data.qcResult : '尚未記錄'}；${report?.data.qcNotes || '尚無複驗說明'}。不通過或未測可保留真實紀錄，但不能交回作完成件。`),
    check('checks', '逐項複驗通過', checks.length > 0 && unresolved.length === 0, !checks.length
      ? '尚無逐項複驗；請依實際機種基準記錄。'
      : unresolved.length ? unresolved.map(value => `${value.name || '未命名項目'}：${RESULTS[value.result] || value.result}（${value.observation || '尚無觀察／未測原因'}）`).join('；')
        : `已保存 ${checks.length} 項複驗通過；以維修單逐項觀察結果為依據。`),
    ...completionReleaseChecks,
    ...(factoryPlan ? [check('factory_receipt', '原廠實際返還與同一委修依據', item.repairWorkflow?.factory?.stage === 'RETURNED'
      && item.repairWorkflow.factory.physicalCustody === 'TECHNICIAN' && !!report?.data.factoryReference
      && report.data.factoryReference === item.repairWorkflow.factory.reference,
    `原廠返還階段：${item.repairWorkflow?.factory?.stage || '未提供'}；本人簽收後才可複驗；送修委修單：${item.repairWorkflow?.factory?.reference || '未提供'}／維修單委修單：${report?.data.factoryReference || '未提供'}。`)] : [check('handoff_note', '交回品況與配件說明', !!context.handoffNote?.trim(), context.handoffNote?.trim()
      ? '交回說明已填寫，須隨實際交回作業送出保存。' : '請在下一步作業填寫實際交回品況與配件說明。')]),
  ];

  // Keep the native predicates as the final saved-document checks, rather than deriving permission from labels.
  const startReady = ownSigned && !nativeOriginalReturn && repairStartReady(item);
  const reportReady = repairReportReady(item);
  const completionReady = ownSigned && !nativeOriginalReturn && completionStage && completionSupported && reportReady
    && completionReleaseChecks.every(value => value.ready) && (factoryPlan || !!context.handoffNote?.trim());
  const showStart = customerRepair && !nativeOriginalReturn && !factoryPlan && plan !== 'RETURN'
    && ['REPAIR_RECEIVED', 'INSPECTING', 'WAITING_CUSTOMER'].includes(item.status);
  const showCompletion = !nativeOriginalReturn && (supportedCompletion || unsupportedInternal) && (completionStage || !!report || item.status === 'REFURBISHING')
    && !['WAITING_RETURN_ACCEPTANCE', 'READY_FOR_DISPATCH', 'STOCKED', 'PENDING_WELFARE_STOCK'].includes(item.status);
  const csrEvidence = csr
    ? `${CSR_STATUS[csr.status] || csr.status}；接手客服：${csr.ownerName || csr.ownerId || '尚未提供本人接手紀錄'}；交辦檢修 ${revision(csr.inspectionRevision)}／估價 ${revision(csr.estimateRevision)}／報價 ${revision(csr.quoteRevision)}；本人接手時間：${date(csr.acceptedAt)}；回覆時間：${date(csr.resolvedAt)}。`
    : customerRepair ? '尚無原生客服交辦紀錄；通知送達不等於客服本人接手。' : '公司退貨整新，不套用顧客維修的客服同意／收款放行。';
  let title = '依目前保存紀錄核對下一步';
  let nextStep = '依原生案件與實物交接紀錄繼續作業；此面板不改共同狀態。';
  if (waitingAcceptance) {
    title = '待認領／本人實物簽收';
    nextStep = !context.canUpdate ? '目前為唯讀，等待有權限的維修接手人認領並本人點件簽收。'
      : item.nextUserId === context.viewerId ? '本件已交辦給登入本人；收到原件後核對品名、SKU、SN、配件與存放位置，再本人簽收。認領不等於已收到實物。'
        : !item.nextUserId && !item.repairOwnerId ? '可先認領此件，再依交接安排本人收到、核對實物並簽收。'
          : `等待${item.nextUserName || '指定維修接手人'}本人核對實物並簽收；目前登入人不可代簽。`;
  } else if (item.status === 'WAITING_RETURN_ACCEPTANCE') {
    title = item.repairWorkflow?.release?.purpose === 'RETURN_UNREPAIRED' ? '未修原件已交辦收發室，待本人接收' : '已交辦收發室，待本人接收';
    nextStep = `等待${item.nextUserName || '收發室接手人'}本人點件簽收，實物保管仍以目前登錄持有人為準。交辦完成不等於收發已接收、已出貨或已入庫。`;
  } else if (item.status === 'PENDING_WELFARE_STOCK') {
    title = '已交回收發室，後續合格與正式入庫另核對';
    nextStep = '收發室已本人接收處理完成件；目前實物保管與位置以原生紀錄為準。庫存負責人仍須本人點收、核對合格與所有權依據及正式入庫回執，不能把待入庫記成已入庫。';
  } else if (item.status === 'READY_FOR_DISPATCH') {
    title = '交回後續由收發室安排寄回';
    nextStep = '依收發室目前實物與物流紀錄安排寄回；待安排寄回不等於已交運或顧客收到。';
  } else if (['FACTORY_OUTBOUND', 'FACTORY_RECEIVED', 'FACTORY_RETURNING'].includes(item.status)) {
    title = '原廠處理與實物返還各自核對';
    nextStep = item.repairWorkflow?.factory?.cancelled && item.status !== 'FACTORY_RETURNING'
      ? '原廠處理已取消，實物仍依原廠／承運商目前持有紀錄。取得實際返還物流後再登記，取消本身不表示已返還。'
      : item.status === 'FACTORY_RETURNING' ? '返還在途不等於本人收到；等待指定維修接手人實際收回、核對原件與配件並本人簽收後，記錄原廠實際處理與複驗。'
        : item.status === 'FACTORY_OUTBOUND' ? '已登記送廠交運；原廠接收、實際返還物流與維修師本人簽收各自保存證據。尚未實際返還，不能交回作完成件。'
          : '原廠收件不等於處理完成或已返還；依實際返還物流與本人收件證據繼續作業。';
  } else if (unsupportedInternal) {
    title = '公司退貨整新方案不支援此完成流程';
    nextStep = '此完成流程目前只支援原機實際維修；替換、送原廠或原件退回的實際紀錄仍保留。請由協調窗口核對後續處理，不能將真實處置改成修理來取得交回條件。';
  } else if (plan === 'RETURN' || nativeOriginalReturn) {
    title = '保留未修原件，依拒修／退回流程交接';
    nextStep = `${nativeOriginalReturn ? '伺服器目前允許原件未修退回；即使原建議為修理／替換，當版客服拒修結果也須依原件退回作業處理。' : '原件退回方案不走開始維修或複驗完成。'}保留當版客服拒修／退回確認、拒修原因、原件品況與配件；由接手人本人核對，只依伺服器允許的「原件未修退回收發室」作業交接。`;
  } else if (!ownSigned && !['STOCKED', 'COLLECTED'].includes(item.status)) {
    title = '目前登入本人尚不具備此件作業條件';
    nextStep = ownership.detail;
  } else if (item.status === 'REPAIR_RECEIVED') {
    title = '本人已簽收，下一步開始檢測';
    nextStep = '開始檢測後記錄實際故障、測試條件、建議方案與估價；提交檢修單再交客服確認。';
  } else if (showCompletion) {
    title = completionReady ? '目前具備送出交回核對的條件' : '完成件交回仍有待核對條件';
    nextStep = completionReady
      ? factoryPlan ? '請在原廠作業填寫實際品況與交接依據後送出；後端仍會核對目前版本，收發室另須本人簽收。'
        : '可從下一步作業送出交回；後端仍會核對目前版本與必要放行，收發室另須本人簽收。'
      : '依下方缺口補齊當版維修單與複驗。保留失敗、未測與實際處置，不能把未修原件或未返還原廠件記成完成。';
  } else if (showStart) {
    title = startReady ? '目前具備送出開工核對的條件' : '維修開工仍有待核對條件';
    nextStep = startReady ? '可從下一步作業送出開始維修／替換；後端仍會重新核對當版客服結果、來源顧客同意與必要款項。'
      : '依下方缺口取得當版客服結果、顧客同意與必要款項；維修估價、通知送達與來源放行旗標各自不代表開工條件完整。';
  } else if (factoryPlan && currentPhysicalCustody(item) === 'TECHNICIAN') {
    title = '送原廠與返還複驗依實際作業處理';
    nextStep = '送廠前依伺服器允許作業核對當版方案；返還後保留原廠處理依據與同一委修單號，逐項複驗再交回。';
  }
  return { ownSigned, startReady, reportReady, completionReady, showStart, showCompletion, title, nextStep,
    startChecks, completionChecks, csrEvidence, sourceMessage: source?.message || undefined,
    actualOutcome: report ? `${OUTCOMES[report.data.outcome] || report.data.outcome} · 維修 ${revision(report.revision)} · ${report.status === 'SUBMITTED' ? '已提交' : '草稿'}` : '尚無維修單實際處置紀錄' };
}
