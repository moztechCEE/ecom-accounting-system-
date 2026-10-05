import type { Item, PhysicalCustody } from './model';

export const CUSTODY: Record<PhysicalCustody, string> = {
  TECHNICIAN: '維修師本人持有',
  MAILROOM: '收發人員本人持有',
  FACTORY_CARRIER: '承運商持有（原廠交運）',
  FACTORY: '原廠持有',
  INVENTORY: '庫存負責人本人持有',
  LINKED_CASE: '實物已轉入換機案件',
  UNKNOWN: '出庫關聯待核對',
};

type CustodyItem = Pick<Item, 'custodianName' | 'location' | 'physicalCustody' | 'linkedReplacementCustody'> & {
  status?: string;
  repairWorkflow?: { factory?: { physicalCustody: PhysicalCustody } } | null;
};
export type CurrentItemCustody = {
  holder: string;
  location: string;
  transferred: boolean;
  notice?: string;
  reference?: string;
  status?: string;
};
export function currentPhysicalCustody(item: CustodyItem): PhysicalCustody | undefined {
  return item.physicalCustody || item.repairWorkflow?.factory?.physicalCustody;
}

/** Keep the donor's immutable inbound custodian separate from its physical unit after formal OUT. */
export function currentItemCustody(item: CustodyItem): CurrentItemCustody {
  if (item.physicalCustody === 'LINKED_CASE') {
    const linked = item.linkedReplacementCustody;
    if (linked) return {
      transferred: true,
      holder: ['FACTORY', 'FACTORY_CARRIER'].includes(linked.physicalCustody)
        ? CUSTODY[linked.physicalCustody]
        : linked.custodianName || '換機案件目前保管待核對',
      location: linked.location || '換機案件目前位置待核對',
      notice: '已作換機出庫；實物保管依換機案',
      reference: `${linked.sourceNumber || linked.itemId} · OUT ${linked.outTransactionId}`,
      status: linked.statusLabel || linked.status,
    };
  }
  if (item.physicalCustody === 'UNKNOWN' || item.physicalCustody === 'LINKED_CASE') {
    const transferred = item.status === 'STOCKED' || item.physicalCustody === 'LINKED_CASE';
    return {
      transferred,
      holder: transferred ? '出庫關聯待核對' : '目前實物保管待核對',
      location: '目前實物位置待核對',
      notice: transferred ? '出庫關聯待核對' : '目前實物保管待核對',
    };
  }
  const physical = currentPhysicalCustody(item);
  return {
    transferred: false,
    holder: physical === 'FACTORY' || physical === 'FACTORY_CARRIER' ? CUSTODY[physical] : item.custodianName,
    location: item.location,
  };
}
