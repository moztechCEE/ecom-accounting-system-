import type { Item } from './model';

export const MAILROOM_QUEUES = [
  { label: '全部收件紀錄', status: undefined },
  { label: '待核對', status: 'RECEIVED' },
  { label: '待同仁簽領', status: 'WAITING_PICKUP' },
  { label: '待技師簽收', status: 'WAITING_REPAIR_ACCEPTANCE' },
  { label: '待收發室點收', status: 'WAITING_RETURN_ACCEPTANCE' },
  { label: '待寄回', status: 'READY_FOR_DISPATCH' },
  { label: '已交物流', status: 'DISPATCHED' },
  { label: '品項不符', status: 'MISMATCH' },
] as const;

export const isCorrespondence = (category: string) => ['LETTER', 'PARCEL'].includes(category);

export function matchesMailroomSearch(item: Item, search: string): boolean {
  const query = search.trim().toLocaleLowerCase();
  return !query || [item.productName, item.label, item.sku, item.serialNumber, item.location,
    item.receipt.sourceNumber, item.receipt.senderLabel, item.receipt.carrier,
    item.receipt.trackingNumber, item.recipientName, item.nextUserName]
    .some(value => value?.toLocaleLowerCase().includes(query));
}

export type MailroomStep = {
  title: string;
  description: string;
  action?: string;
  tone: 'info' | 'warning' | 'success';
};

/** Guidance describes saved progress; permissions and physical acceptance remain server checks. */
export function mailroomNextStep(item: Item): MailroomStep {
  const person = item.nextUserName || '指定接收人';
  switch (item.status) {
    case 'RECEIVED':
      if (item.receipt.category === 'UNMATCHED') {
        return { title: '先確認收件歸屬', description: item.caseIntake
          ? '客服補建交辦正在處理；綁定原收件後再核對品項。交辦不移轉實物保管。'
          : '確認是信件、同仁包裹或售後產品。找不到售後案件時交指定客服補建，保留原收件紀錄。',
          action: item.caseIntake ? undefined : 'identify', tone: 'warning' };
      }
      return item.receipt.category === 'RETURN'
        ? { title: '拍照並完成退貨檢查', description: '核對實收品項、外包裝、產品外觀與配件；記錄分級及照片，再交客服處理。', action: 'grade', tone: 'info' }
        : { title: '拍照並核對實收產品', description: '比對售後來源品項與實際收到的產品、SKU、SN；相符後指定技師，不符則交客服重新確認。', action: 'inspect', tone: 'info' };
    case 'MISMATCH':
      return { title: '等待客服重新確認', description: '保留實收資料、不符原因與照片；尚未重新確認前不交維修，實物依目前保管紀錄。', tone: 'warning' };
    case 'WAITING_PICKUP':
      return { title: '等待同仁本人簽領', description: `${person}本人登入「我的待辦與收件」核對物件並簽領；指定或通知不代表已簽收。`, action: 'accept', tone: 'info' };
    case 'WAITING_REPAIR_ACCEPTANCE':
    case 'PENDING_REFURBISH':
      return { title: item.nextUserId ? '交給指定技師本人簽收' : '指定或由技師認領後簽收', description: item.nextUserId
        ? `${person}可在收發室平板確認本人身分、實物及位置後簽收。完成前仍由目前保管人持有。`
        : '指派具有維修權限的同仁，或等待技師認領；認領後仍須本人點收，才移轉實物保管。', action: item.nextUserId ? undefined : 'assign', tone: 'info' };
    case 'WAITING_RETURN_ACCEPTANCE':
      return { title: item.releasePurpose === 'RETURN_UNREPAIRED' ? '點收技師交回的未修原件' : '點收技師交回的實物', description: `${person}逐件核對產品、SN、照片與位置後本人簽收。技師交回完成前仍由技師保管。`, action: 'accept_return', tone: 'info' };
    case 'READY_FOR_DISPATCH':
      return { title: '核對物件並登記實際寄出', description: '填寫寄回顧客的承運商與寄出單號，確認實物已交給物流。收件時的入件單號另外保留。', action: 'dispatch', tone: 'info' };
    case 'DISPATCHED':
      return { title: '已交物流，待顧客收件', description: '寄出紀錄已保存，實物由承運商持有；交運不代表顧客已收到，亦不會自動結案。', tone: 'info' };
    case 'PENDING_RESTOCK':
    case 'PENDING_DISPOSITION':
    case 'PENDING_WELFARE_STOCK':
      return { title: '交後續庫存處理', description: '分級與實物簽收已記錄；正式入庫、瑕疵補寄或福利品處理另依庫存流程，不直接完成退款。', tone: 'info' };
    case 'COLLECTED':
      return { title: '已完成本人簽領', description: '可追溯簽領人、時間及歷程；不需再次交接或重發待辦。', tone: 'success' };
    case 'STOCKED':
      return { title: '依目前庫存或換機保管紀錄追蹤', description: '原收件保留歷程；若已正式出庫換機，實物位置與保管以關聯案件為準。', tone: 'success' };
    default:
      return { title: '追蹤維修與後續處理', description: '由目前接手人依維修或客服流程處理；收發室可查看歷程、實物保管與同步結果。', tone: 'info' };
  }
}

export function needsInspectionPhoto(action: string | undefined, saved: string[] | undefined, added: string[]): boolean {
  return ['inspect', 'grade'].includes(action || '') && !(saved?.length || added.length);
}

export function canDispatch(item: Item, userId: string, canMail: boolean): boolean {
  return canMail && item.receipt.category === 'REPAIR' && item.status === 'READY_FOR_DISPATCH'
    && item.custodianId === userId && item.physicalCustody === 'MAILROOM' && !item.outboundShipment;
}

export function matchesDispatchReceipt(item: Item, command: {
  entityId: string; requestId: string; expectedVersion: number;
  carrier: string; trackingNumber: string;
}, userId: string): boolean {
  const shipment = item.outboundShipment;
  return !!shipment && item.status === 'DISPATCHED' && item.version > command.expectedVersion
    && shipment.entityId === command.entityId && shipment.itemId === item.id
    && shipment.requestId === command.requestId && shipment.fromVersion === command.expectedVersion
    && shipment.version === command.expectedVersion + 1 && shipment.dispatchedById === userId
    && shipment.carrier === command.carrier.trim() && shipment.trackingNumber === command.trackingNumber.trim();
}
