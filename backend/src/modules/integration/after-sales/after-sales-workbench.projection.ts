import { BadGatewayException } from '@nestjs/common';

type Scalar = string | number | boolean | null;
type SourceRow = Record<string, unknown>;
type Field = { key: string; label: string; value: Scalar };
type RecordView = { key: string; fields: Field[] };
export type WorkbenchSection = {
  key: string;
  title: string;
  records: RecordView[];
};
export const WORKBENCH_CONTRACT = '2026-09-04.v1';

const contact = {
  contactName: '聯絡人',
  contactPhone: '電話',
  contactEmail: '電子郵件',
  contactAddress: '地址',
  convenienceStoreInfo: '超商',
  sourceChannel: '來源通路',
  referenceNumber: '原始單號',
  registeredAt: '登記時間',
  receivedAt: '收件時間',
  internalNote: '內部備註',
  customerVisibleNote: '客戶備註',
};
const shipmentDraft = {
  draftShipmentCarrier: '預定物流',
  draftShipmentTrackingNumber: '預定物流單號',
  draftRecipientName: '收件人',
  draftRecipientPhone: '收件電話',
  draftRecipientAddress: '收件地址',
  draftShipmentNote: '出貨備註',
  shipmentInstruction: '出貨要求',
};
const reverseDraft = {
  draftReverseCarrier: '預定回收物流',
  draftReverseTrackingNumber: '預定回收單號',
  draftPickupAddress: '回收地址',
  draftReverseShipmentNote: '回收備註',
};
const pricing = {
  paymentRegion: '付款地區',
  receivingAccountType: '收款帳號類型',
  receivingAccountLabel: '收款帳號',
  transferLastFive: '末五碼',
  currency: '幣別',
  exchangeRate: '匯率',
  convertedAmount: '換算金額',
  includesShippingFee: '含運費',
  shippingFeeCurrency: '運費幣別',
  shippingFeeAmount: '運費',
  shippingFeeConvertedAmount: '換算運費',
  finalAmount: '最終應收',
};
const timestamps = { createdAt: '建立時間', updatedAt: '更新時間' };
const invoiceBuyer = {
  buyerTaxId: '買受人統編',
  carrierType: '載具類型',
  carrierNumber: '載具號碼',
};
const sectionFields: Record<
  string,
  { title: string; fields: Record<string, string> }
> = {
  reshipmentDetail: {
    title: '補寄',
    fields: {
      missingContents: '缺漏內容',
      reshipmentReason: '原因',
      lossCategory: '損耗分類',
      requiresPayment: '需收款',
      ...shipmentDraft,
    },
  },
  privatePurchaseDetail: {
    title: '購買',
    fields: {
      ...pricing,
      requiresInvoice: '需發票',
      invoiceNumber: '發票號碼',
      stockOutNumber: '銷庫單號',
      ...shipmentDraft,
    },
  },
  repairCaseDetail: {
    title: '維修',
    fields: {
      repairNumber: '維修單號',
      productModel: '型號',
      serialNumber: '序號',
      warrantyNumber: '保固編號',
      purchasePlatform: '購買通路',
      purchaseDate: '購買日期',
      faultDescription: '故障內容',
      hasReceivedProduct: '已收到商品',
      inspectionSummary: '檢測結果',
      isAccidentalDamage: '人為損壞',
      isUnderWarranty: '保固內',
      quoteAmount: '報價',
      customerApprovedRepair: '同意維修',
      returnTrackingNumber: '寄回單號',
      ...pricing,
      ...shipmentDraft,
    },
  },
  exchangeReturnDetail: {
    title: '來回件',
    fields: {
      reasonCategory: '原因',
      reasonNote: '原因備註',
      inventoryDisposition: '舊系統庫存處置',
      itemQuantity: '件數',
      warehouseReceiptNumber: '入庫單號',
      receivedAt: '收件時間',
      returnedItemCondition: '回收品狀態',
      ...pricing,
      ...shipmentDraft,
      ...reverseDraft,
    },
  },
  refundPickupDetail: {
    title: '退款派車',
    fields: {
      refundReason: '原因',
      refundOption: '退款選項',
      isRefunded: '已退款',
      refundInvoiceAction: '發票處理',
      invoiceVoided: '發票已作廢',
      refundAmount: '退款金額',
      refundMethod: '退款方式',
      refundAccountInfo: '退款帳號',
      warehouseReceiptNumber: '入庫單號',
      receivedAt: '收件時間',
      accountingConfirmedAt: '會計確認時間',
      ...reverseDraft,
    },
  },
  customerIssueDetail: {
    title: '客戶問題',
    fields: {
      brand: '品牌',
      issueCategory: '問題分類',
      issueDescription: '問題內容',
      analysisSummary: '分析紀錄',
      importSource: '來源',
    },
  },
  items: {
    title: '商品',
    fields: {
      productNameSnapshot: '商品',
      productSkuSnapshot: 'SKU',
      productId: '來源商品 ID',
      quantity: '數量',
      unitPrice: '來源單價',
    },
  },
  shipments: {
    title: '正向物流',
    fields: {
      shipmentNumber: '出貨單號',
      carrier: '物流',
      trackingNumber: '物流單號',
      trackingSource: '單號來源',
      trackingImportReference: '匯入批次',
      trackingImportedAt: '匯入時間',
      status: '狀態',
      recipientName: '收件人',
      recipientPhone: '電話',
      recipientAddress: '地址',
      shippedAt: '出貨時間',
      deliveredAt: '送達時間',
      note: '備註',
    },
  },
  reverseShipments: {
    title: '逆向物流',
    fields: {
      reverseShipmentNumber: '回收單號',
      carrier: '物流',
      trackingNumber: '物流單號',
      status: '狀態',
      pickupAddress: '回收地址',
      receivedAt: '收件時間',
      warehouseReceiptNumber: '入庫單號',
      inventoryDisposition: '舊系統庫存處置',
      note: '備註',
    },
  },
  paymentRecords: {
    title: '付款',
    fields: {
      amount: '金額',
      currency: '幣別',
      status: '狀態',
      paymentMethod: '付款方式',
      accountType: '帳號類型',
      accountLabel: '收款帳號',
      referenceNumber: '交易編號',
      remittanceLastFive: '末五碼',
      confirmedAt: '確認時間',
      note: '備註',
    },
  },
  paymentRequests: {
    title: '付款請求',
    fields: {
      brand: '品牌',
      channel: '管道',
      status: '狀態',
      reminderTitle: '通知標題',
      reminderDueAt: '提醒期限',
      reminderSentAt: '提醒時間',
      expiresAt: '到期時間',
      sentAt: '發送時間',
      openedAt: '開啟時間',
      submittedAt: '提交時間',
      completedAt: '完成時間',
      invalidatedAt: '失效時間',
      ...timestamps,
    },
  },
  paymentSubmissions: {
    title: '付款提交',
    fields: {
      status: '狀態',
      customerName: '付款人',
      remittanceMethod: '匯款方式',
      remittedAt: '匯款時間',
      remittanceAmount: '匯款金額',
      remittanceLastFive: '末五碼',
      ...invoiceBuyer,
      note: '備註',
      reviewComment: '審核意見',
      reviewedAt: '審核時間',
      ...timestamps,
    },
  },
  refundRecords: {
    title: '退款',
    fields: {
      amount: '退款金額',
      currency: '幣別',
      status: '狀態',
      refundOption: '選項',
      refundMethod: '退款方式',
      refundAccountInfo: '退款帳號',
      refundInvoiceAction: '發票處理',
      invoiceVoided: '發票已作廢',
      confirmedAt: '確認時間',
      note: '備註',
    },
  },
  invoiceRecords: {
    title: '發票',
    fields: {
      invoiceNumber: '發票號碼',
      isRequired: '需發票',
      status: '狀態',
      ...invoiceBuyer,
      issuedAt: '開立時間',
      voidedAt: '作廢時間',
      note: '備註',
    },
  },
  attachments: {
    title: '附件',
    fields: {
      fileName: '檔名',
      contentType: '類型',
      sizeBytes: '位元組',
      createdAt: '上傳時間',
    },
  },
  timeline: {
    title: '時間軸',
    fields: { title: '事件', description: '內容', occurredAt: '時間' },
  },
  auditLog: {
    title: '操作紀錄',
    fields: { action: '動作', summary: '異動摘要', createdAt: '時間' },
  },
  notes: {
    title: '備註',
    fields: { visibility: '可見範圍', content: '內容', ...timestamps },
  },
  generatedFaqs: {
    title: '關聯 FAQ',
    fields: {
      title: '標題',
      brand: '品牌',
      channel: '通路',
      isActive: '啟用',
      ...timestamps,
    },
  },
};

export function sourceRecord(value: unknown): SourceRow {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as SourceRow)
    : {};
}

function scalar(value: unknown): Scalar {
  return typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
    ? value
    : null;
}

function fields(
  record: SourceRow,
  definitions: Record<string, string>,
): Field[] {
  return Object.entries(definitions).map(([key, label]) => ({
    key,
    label,
    value: scalar(record[key]),
  }));
}

function projectWorkflow(value: unknown) {
  const row = sourceRecord(value);
  return Object.fromEntries(
    [
      'queue',
      'queueLabel',
      'stageLabel',
      'ownerRoleLabel',
      'nextAction',
      'isLocked',
      'isOverdue',
      'overdueLabel',
    ].map((key) => [key, scalar(row[key])]),
  );
}

function envelope(source: SourceRow) {
  if (
    source.workbenchContractVersion !== WORKBENCH_CONTRACT ||
    source.mode !== 'read_only' ||
    typeof source.checkedAt !== 'string' ||
    !Number.isFinite(Date.parse(source.checkedAt))
  ) {
    throw new BadGatewayException('售後工作台 API 版本不相容');
  }
  return {
    mode: 'read_only' as const,
    checkedAt: source.checkedAt,
    sourceCommit: scalar(source.sourceCommit),
    featureBaseline: scalar(source.featureBaseline),
  };
}

export function projectWorkbenchList(source: SourceRow) {
  const meta = envelope(source);
  const page = sourceRecord(source.page);
  const summary = sourceRecord(source.summary);
  if (
    !Array.isArray(source.items) ||
    source.items.length > 100 ||
    !['number', 'pageSize', 'totalCount'].every(
      (key) => Number.isInteger(page[key]) && Number(page[key]) >= 0,
    ) ||
    Number(page.number) < 1 ||
    Number(page.pageSize) < 1 ||
    Number(page.pageSize) > 100 ||
    source.items.length > Number(page.pageSize) ||
    !['total', 'active', 'urgent', 'closed'].every(
      (key) => Number.isInteger(summary[key]) && Number(summary[key]) >= 0,
    )
  ) {
    throw new BadGatewayException('售後工作台回傳資料不完整');
  }
  if (
    Number(page.totalCount) < source.items.length ||
    Number(summary.total) !== Number(summary.active) + Number(summary.closed) ||
    Number(summary.urgent) > Number(summary.active)
  ) {
    throw new BadGatewayException('售後工作台筆數不一致');
  }
  const items = source.items.map((value) => {
    const row = sourceRecord(value);
    if (
      typeof row.id !== 'string' ||
      !row.id ||
      typeof row.caseNumber !== 'string'
    )
      throw new BadGatewayException('售後案件識別不完整');
    return {
      ...Object.fromEntries(
        [
          'id',
          'caseNumber',
          'type',
          'status',
          'sourceChannel',
          'referenceNumber',
          'contactName',
          'isUrgent',
          'handlerName',
          'assigneeName',
          'registeredAt',
          'updatedAt',
        ].map((key) => [key, scalar(row[key])]),
      ),
      workflow: projectWorkflow(row.workflow),
    };
  });
  return {
    ...meta,
    items,
    page: {
      number: page.number,
      pageSize: page.pageSize,
      totalCount: page.totalCount,
      hasMore: page.hasMore === true,
    },
    summary: {
      total: summary.total,
      active: summary.active,
      urgent: summary.urgent,
      closed: summary.closed,
    },
  };
}

export function projectWorkbenchDetail(source: SourceRow, expectedId: string) {
  const meta = envelope(source);
  const item = sourceRecord(source.item);
  if (item.id !== expectedId || typeof item.caseNumber !== 'string')
    throw new BadGatewayException('售後案件識別不一致');
  const collections = [
    'items',
    'shipments',
    'reverseShipments',
    'paymentRecords',
    'paymentRequests',
    'paymentSubmissions',
    'refundRecords',
    'invoiceRecords',
    'attachments',
    'timeline',
    'auditLog',
    'notes',
    'generatedFaqs',
  ];
  if (collections.some((key) => !Array.isArray(item[key])))
    throw new BadGatewayException('售後案件明細不完整');
  const contactFields = fields(item, contact);
  for (const [key, label] of [
    ['handler', '經手人'],
    ['assignee', '承辦人'],
  ]) {
    contactFields.push({
      key,
      label,
      value: scalar(sourceRecord(item[key]).name),
    });
  }
  const sections: WorkbenchSection[] = [
    {
      key: 'contact',
      title: '案件',
      records: [{ key: expectedId, fields: contactFields }],
    },
  ];
  for (const [key, definition] of Object.entries(sectionFields)) {
    const raw = item[key];
    const rows = Array.isArray(raw) ? raw : raw ? [raw] : [];
    const records = rows.map((value, index) => {
      const row = sourceRecord(value);
      const display = fields(row, definition.fields);
      for (const actorKey of [
        'actor',
        'createdBy',
        'confirmedBy',
        'reviewedBy',
        'updatedBy',
        'uploadedBy',
      ]) {
        const name = scalar(sourceRecord(row[actorKey]).name);
        if (name) display.push({ key: actorKey, label: '經手人', value: name });
      }
      return {
        key: typeof row.id === 'string' ? row.id : `${key}-${index}`,
        fields: display,
      };
    });
    // Empty collections remain visible as verified zero, not silently dropped features.
    if (Array.isArray(raw) || rows.length)
      sections.push({ key, title: definition.title, records });
  }
  return {
    ...meta,
    id: item.id,
    caseNumber: item.caseNumber,
    type: scalar(item.type),
    status: scalar(item.status),
    workflow: projectWorkflow(source.workflow),
    sections,
  };
}
