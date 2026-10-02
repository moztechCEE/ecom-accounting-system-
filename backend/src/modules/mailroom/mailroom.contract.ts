import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const CATEGORIES = [
  'REPAIR',
  'RETURN',
  'LETTER',
  'PARCEL',
  'UNMATCHED',
] as const;
export const GRADES = ['AA', 'A', 'B', 'C'] as const;
export const STATUS_LABELS: Record<string, string> = {
  RECEIVED: '已收到售後案件，待核對',
  MISMATCH: '品項不符，待客服確認',
  WAITING_PICKUP: '待同仁簽領',
  WAITING_REPAIR_ACCEPTANCE: '待維修簽收',
  REPAIR_RECEIVED: '維修已簽收',
  INSPECTING: '檢測中',
  WAITING_CUSTOMER: '待客服確認',
  REPAIRING: '維修中',
  WAITING_RETURN_ACCEPTANCE: '處理完成，待收發室簽收',
  READY_FOR_DISPATCH: '待安排寄回',
  PENDING_RESTOCK: 'AA 待重新入庫',
  PENDING_DISPOSITION: 'A 待瑕疵補寄／福利品處理',
  PENDING_REFURBISH: 'B／C 待整新簽收',
  REFURBISHING: '整新中',
  PENDING_WELFARE_STOCK: '整新完成，待福利品入庫',
  COLLECTED: '已簽領',
};
export const ACTIONS = [
  'identify',
  'inspect',
  'grade',
  'correct',
  'move',
  'assign',
  'accept',
  'resolve_mismatch',
  'resolve_customer',
  'start_inspection',
  'await_customer',
  'start_repair',
  'complete_repair',
  'start_refurbish',
  'complete_refurbish',
  'accept_return',
  'acknowledge_inspection',
] as const;
export type ActionName = (typeof ACTIONS)[number];
export type Actor = {
  id: string;
  name: string;
  permissions: Set<string>;
  entityIds: string[] | null;
};
export type ReturnInspection = {
  packaging: 'INTACT' | 'MINOR_DAMAGE' | 'MAJOR_DAMAGE' | 'NOT_PROVIDED';
  product: 'NEW_UNUSED' | 'MINOR_WEAR' | 'VISIBLE_WEAR' | 'SEVERE_DAMAGE';
  accessories: 'COMPLETE' | 'MISSING' | 'NONE_EXPECTED';
  reviewedAt?: string;
  reviewedBy?: string;
};
export type Command = {
  targetCategory?: 'REPAIR' | 'RETURN' | 'LETTER' | 'PARCEL';
  sourceCaseId?: string;
  sourceItemId?: string;
  entityId: string;
  requestId: string;
  expectedVersion: number;
  action: ActionName;
  productName?: string;
  sku?: string;
  serialNumber?: string;
  location?: string;
  note?: string;
  matchResult?: 'MATCH' | 'MISMATCH';
  grade?: (typeof GRADES)[number];
  disposition?: string;
  nextUserId?: string;
  confirmedItems?: boolean;
  evidence?: string[];
  returnInspection?: ReturnInspection;
};
export type SourceCase = {
  id: string;
  number: string;
  type: 'REPAIR' | 'RETURN';
  brand: string;
  version: string;
  status: string;
  repairAllowed: boolean;
  statusLabel?: string;
  customerLabel: string;
  assigneeId?: string | null;
  assigneeEmail?: string | null;
  assigneeName?: string | null;
  expectedQuantity?: number;
  receivedQuantity?: number;
  remainingQuantity?: number;
  items: {
    id: string;
    name: string;
    sku: string | null;
    serialNumber: string | null;
    quantity: number;
    receivedQuantity?: number;
    remainingQuantity?: number;
  }[];
};
export type ItemState = {
  id: string;
  entityId: string;
  status: string;
  version: number;
  productName: string;
  sku: string | null;
  serialNumber: string | null;
  location: string;
  custodianId: string;
  recipientId: string | null;
  nextUserId: string | null;
  repairOwnerId: string | null;
  matchResult: string;
  grade: string | null;
  disposition: string | null;
  evidence?: unknown;
  conditionNote?: string | null;
  returnInspection?: unknown;
  receipt: {
    category: string;
    receivedById: string;
    sourceCaseId: string | null;
    customerServiceUserId?: string | null;
  };
};

export function can(actor: Actor, permission: string) {
  return actor.permissions.has('*') || actor.permissions.has(permission);
}
export function requirePermission(actor: Actor, permission: string) {
  if (!can(actor, permission)) throw new ForbiddenException('沒有此作業權限');
}
export function requireEntity(actor: Actor, entityId: string) {
  if (
    !entityId ||
    (actor.entityIds !== null && !actor.entityIds.includes(entityId))
  )
    throw new ForbiddenException('無此公司存取權限');
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ':' + canonical(v))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
export function fingerprint(value: unknown) {
  return createHash('sha256').update(canonical(value)).digest('hex');
}
export function signRequest(
  secret: string,
  method: string,
  path: string,
  timestamp: string,
  body: string,
  entityId: string,
) {
  return createHmac('sha256', secret)
    .update(
      [
        'mailroom.v1',
        method,
        path,
        timestamp,
        entityId,
        createHash('sha256').update(body).digest('hex'),
      ].join('\n'),
    )
    .digest('hex');
}
export function verifySignature(
  secret: string,
  expected: string,
  actual: string,
) {
  return (
    secret.length >= 32 &&
    /^[a-f0-9]{64}$/.test(actual) &&
    timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(actual, 'hex'))
  );
}
export function validatePhotos(photos?: string[]) {
  if (!photos) return;
  if (photos.length > 4) throw new BadRequestException('每件最多附 4 張照片');
  let total = 0;
  for (const photo of photos) {
    const match =
      /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(photo);
    if (!match) throw new BadRequestException('照片只接受 PNG、JPEG 或 WebP');
    const bytes = Buffer.from(match[2], 'base64');
    total += bytes.length;
    const valid =
      match[1] === 'png'
        ? bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
        : match[1] === 'jpeg'
          ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
          : bytes.toString('ascii', 0, 4) === 'RIFF' &&
            bytes.toString('ascii', 8, 12) === 'WEBP';
    if (!valid || bytes.length > 1024 * 1024)
      throw new BadRequestException('照片格式不符或單張超過 1 MB');
  }
  if (total > 3 * 1024 * 1024)
    throw new BadRequestException('每件照片合計不可超過 3 MB');
}

/** Only named, authorized transitions are allowed. No stock or payment writes live here. */
export function transition(
  item: ItemState,
  command: Command,
  actor: Actor,
  repairAllowed = false,
) {
  requireEntity(actor, item.entityId);
  if (command.entityId !== item.entityId)
    throw new ForbiddenException('公司不符');
  if (command.expectedVersion !== item.version)
    throw new ConflictException('資料已更新，請重新整理後操作');
  const changes: Record<string, unknown> = {};
  const requireStage = (...stages: string[]) => {
    if (!stages.includes(item.status))
      throw new ConflictException('目前進度不能執行這項操作');
  };
  const note = command.note?.trim();
  const requireNote = () => {
    if (!note) throw new BadRequestException('請填寫原因或處理結果');
  };
  const requireNext = () => {
    if (!command.nextUserId) throw new BadRequestException('請指定接收人');
  };
  const requireSignature = () => {
    if (!command.confirmedItems || !command.location?.trim())
      throw new BadRequestException('請逐件核對、確認簽收並填寫存放位置');
    if (item.nextUserId !== actor.id)
      throw new ForbiddenException('只有被指派的本人可以簽收');
    changes.custodianId = actor.id;
    changes.location = command.location.trim();
  };
  const requireRepairOwner = () => {
    requirePermission(actor, 'repair_workbench:update');
    if (item.repairOwnerId !== actor.id || item.custodianId !== actor.id)
      throw new ForbiddenException('只能處理本人已簽收的物件');
  };
  if (
    ['inspect', 'grade', 'correct', 'move', 'assign', 'accept_return'].includes(
      command.action,
    )
  )
    requirePermission(actor, 'mailroom:update');
  switch (command.action) {
    case 'identify':
      requirePermission(actor, 'mailroom:update');
      requireStage('RECEIVED');
      requireNote();
      if (item.receipt.category !== 'UNMATCHED' || !command.targetCategory)
        throw new BadRequestException('只有待辨識收件可補登歸屬');
      if (['LETTER', 'PARCEL'].includes(command.targetCategory)) {
        requireNext();
        Object.assign(changes, {
          status: 'WAITING_PICKUP',
          recipientId: command.nextUserId,
          nextUserId: command.nextUserId,
        });
      } else if (command.nextUserId)
        throw new BadRequestException('售後件須先核對，再指派維修人員');
      break;
    case 'inspect':
      requireStage('RECEIVED');
      if (item.receipt.category !== 'REPAIR')
        throw new BadRequestException('此操作僅適用維修品');
      if (!command.productName?.trim() || !command.matchResult)
        throw new BadRequestException('請填寫實收產品與核對結果');
      Object.assign(changes, {
        productName: command.productName.trim(),
        sku: command.sku?.trim() || null,
        serialNumber: command.serialNumber?.trim() || null,
        matchResult: command.matchResult,
        conditionNote: note || null,
      });
      if (command.matchResult === 'MISMATCH') {
        requireNote();
        changes.status = 'MISMATCH';
        changes.nextUserId = null;
      } else {
        requireNext();
        changes.status = 'WAITING_REPAIR_ACCEPTANCE';
        changes.nextUserId = command.nextUserId;
      }
      break;
    case 'resolve_mismatch':
      requirePermission(actor, 'mailroom:review');
      requireStage('MISMATCH');
      requireNote();
      if (item.receipt.category === 'RETURN') {
        Object.assign(changes, {
          status: 'RECEIVED',
          matchResult: 'CONFIRMED_ACTUAL',
          nextUserId: null,
        });
        break;
      }
      requireNext();
      Object.assign(changes, {
        status: 'WAITING_REPAIR_ACCEPTANCE',
        matchResult: 'CONFIRMED_ACTUAL',
        nextUserId: command.nextUserId,
      });
      break;
    case 'resolve_customer':
      requirePermission(actor, 'mailroom:review');
      requireStage('WAITING_CUSTOMER');
      requireNote();
      Object.assign(changes, {
        status: 'INSPECTING',
        nextUserId: item.repairOwnerId,
        conditionNote: note,
      });
      break;
    case 'grade':
      requireStage(
        'RECEIVED',
        'PENDING_RESTOCK',
        'PENDING_DISPOSITION',
        'PENDING_REFURBISH',
      );
      if (item.receipt.category !== 'RETURN' || !command.grade)
        throw new BadRequestException('請選擇退貨品分級');
      requireNote();
      if (!command.matchResult || !command.returnInspection)
        throw new BadRequestException('請完成品項、包裝、外觀及配件檢查');
      const inspection = command.returnInspection;
      if (
        !['INTACT', 'MINOR_DAMAGE', 'MAJOR_DAMAGE', 'NOT_PROVIDED'].includes(
          inspection.packaging,
        ) ||
        !['NEW_UNUSED', 'MINOR_WEAR', 'VISIBLE_WEAR', 'SEVERE_DAMAGE'].includes(
          inspection.product,
        ) ||
        !['COMPLETE', 'MISSING', 'NONE_EXPECTED'].includes(
          inspection.accessories,
        )
      )
        throw new BadRequestException('退貨檢查結果不完整');
      if (
        command.grade === 'AA' &&
        (inspection.product !== 'NEW_UNUSED' ||
          inspection.accessories === 'MISSING')
      )
        throw new BadRequestException(
          'AA 級須為全新未使用且配件完整；請重新確認檢查與分級',
        );
      const photos = command.evidence ?? item.evidence;
      if (!Array.isArray(photos) || !photos.length)
        throw new BadRequestException('請先拍照留底，再送出退貨檢查');
      validatePhotos(photos);
      changes.returnInspection = {
        packaging: inspection.packaging,
        product: inspection.product,
        accessories: inspection.accessories,
      };
      changes.matchResult =
        command.matchResult === 'MATCH' &&
        item.matchResult === 'CONFIRMED_ACTUAL'
          ? 'CONFIRMED_ACTUAL'
          : command.matchResult;
      changes.grade = command.grade;
      changes.conditionNote = note;
      if (command.matchResult === 'MISMATCH') {
        Object.assign(changes, {
          status: 'MISMATCH',
          nextUserId: null,
          disposition: null,
        });
        break;
      }
      if (command.grade === 'AA')
        Object.assign(changes, {
          status: 'PENDING_RESTOCK',
          disposition: 'RESTOCK',
          nextUserId: null,
        });
      if (command.grade === 'A') {
        if (
          !['DEFECT_REPLACEMENT', 'WELFARE_SALE'].includes(
            command.disposition || '',
          )
        )
          throw new BadRequestException('A 級請選擇瑕疵補寄或福利品');
        Object.assign(changes, {
          status: 'PENDING_DISPOSITION',
          disposition: command.disposition,
          nextUserId: null,
        });
      }
      if (command.grade === 'B' || command.grade === 'C') {
        requireNext();
        Object.assign(changes, {
          status: 'PENDING_REFURBISH',
          disposition: 'REFURBISH_THEN_WELFARE',
          nextUserId: command.nextUserId,
        });
      }
      const previousInspection = item.returnInspection as
        | ReturnInspection
        | undefined;
      if (
        previousInspection?.reviewedAt &&
        previousInspection.packaging === inspection.packaging &&
        previousInspection.product === inspection.product &&
        previousInspection.accessories === inspection.accessories &&
        item.matchResult === changes.matchResult &&
        item.grade === changes.grade &&
        item.disposition === changes.disposition &&
        item.nextUserId === changes.nextUserId &&
        item.conditionNote === note &&
        canonical(item.evidence) === canonical(photos)
      )
        changes.returnInspection = {
          ...(changes.returnInspection as ReturnInspection),
          reviewedAt: previousInspection.reviewedAt,
          reviewedBy: previousInspection.reviewedBy,
        };
      break;
    case 'acknowledge_inspection':
      requirePermission(actor, 'mailroom:review');
      requireNote();
      if (
        item.receipt.category !== 'RETURN' ||
        !item.returnInspection ||
        (item.receipt.customerServiceUserId !== actor.id && !can(actor, '*'))
      )
        throw new ForbiddenException('僅承辦客服可確認此退貨檢查');
      if (item.status === 'MISMATCH' || item.matchResult === 'PENDING')
        throw new ConflictException('請先完成品項不符的確認');
      changes.returnInspection = {
        ...(item.returnInspection as ReturnInspection),
        reviewedAt: new Date().toISOString(),
        reviewedBy: actor.id,
      };
      break;
    case 'correct':
      requireStage(
        'RECEIVED',
        'MISMATCH',
        'WAITING_REPAIR_ACCEPTANCE',
        'PENDING_RESTOCK',
        'PENDING_DISPOSITION',
        'PENDING_REFURBISH',
      );
      requireNote();
      if (!command.productName?.trim())
        throw new BadRequestException('請填寫實收產品');
      Object.assign(changes, {
        productName: command.productName.trim(),
        sku: command.sku?.trim() || null,
        serialNumber: command.serialNumber?.trim() || null,
        status: 'RECEIVED',
        matchResult: 'PENDING',
        grade: null,
        disposition: null,
        nextUserId: null,
        returnInspection: null,
      });
      break;
    case 'move':
      if (item.status === 'COLLECTED')
        throw new ConflictException('已領取物件不可修改位置');
      if (item.custodianId !== actor.id)
        throw new ForbiddenException('只有目前保管人可登記移位');
      if (!command.location?.trim())
        throw new BadRequestException('請填寫新位置');
      requireNote();
      changes.location = command.location.trim();
      break;
    case 'assign':
      requireStage(
        'WAITING_PICKUP',
        'WAITING_REPAIR_ACCEPTANCE',
        'PENDING_REFURBISH',
        'WAITING_RETURN_ACCEPTANCE',
      );
      requireNext();
      requireNote();
      changes.nextUserId = command.nextUserId;
      if (item.status === 'WAITING_PICKUP')
        changes.recipientId = command.nextUserId;
      break;
    case 'accept':
      requireStage(
        'WAITING_PICKUP',
        'WAITING_REPAIR_ACCEPTANCE',
        'PENDING_REFURBISH',
      );
      requireSignature();
      if (item.status === 'WAITING_PICKUP') {
        if (item.recipientId !== actor.id)
          throw new ForbiddenException('只能簽領本人物件');
        Object.assign(changes, { status: 'COLLECTED', nextUserId: null });
      } else {
        requirePermission(actor, 'repair_workbench:update');
        Object.assign(changes, {
          status:
            item.status === 'PENDING_REFURBISH'
              ? 'REFURBISHING'
              : 'REPAIR_RECEIVED',
          repairOwnerId: actor.id,
          nextUserId: actor.id,
        });
      }
      break;
    case 'start_inspection':
      requireRepairOwner();
      requireStage('REPAIR_RECEIVED');
      changes.status = 'INSPECTING';
      break;
    case 'await_customer':
      requireRepairOwner();
      requireStage('REPAIR_RECEIVED', 'INSPECTING', 'REPAIRING');
      requireNote();
      changes.status = 'WAITING_CUSTOMER';
      changes.conditionNote = note;
      break;
    case 'start_repair':
      requireRepairOwner();
      requireStage('INSPECTING');
      if (!repairAllowed)
        throw new ConflictException(
          '售後案件尚未確認顧客同意及必要款項，暫不能開始維修',
        );
      changes.status = 'REPAIRING';
      break;
    case 'complete_repair':
      requireRepairOwner();
      requireStage('REPAIRING');
      requireNote();
      Object.assign(changes, {
        status: 'WAITING_RETURN_ACCEPTANCE',
        nextUserId: item.receipt.receivedById,
        conditionNote: note,
      });
      break;
    case 'start_refurbish':
      throw new BadRequestException('請先逐件簽收整新物件');
    case 'complete_refurbish':
      requireRepairOwner();
      requireStage('REFURBISHING');
      requireNote();
      Object.assign(changes, {
        status: 'WAITING_RETURN_ACCEPTANCE',
        nextUserId: item.receipt.receivedById,
        conditionNote: note,
      });
      break;
    case 'accept_return':
      requireStage('WAITING_RETURN_ACCEPTANCE');
      requireSignature();
      Object.assign(changes, {
        status:
          item.receipt.category === 'RETURN'
            ? 'PENDING_WELFARE_STOCK'
            : 'READY_FOR_DISPATCH',
        nextUserId: null,
      });
      break;
    default:
      throw new BadRequestException('不支援的進度操作');
  }
  if (
    command.evidence &&
    ![
      'inspect',
      'grade',
      'correct',
      'complete_repair',
      'complete_refurbish',
    ].includes(command.action)
  )
    throw new BadRequestException('此操作不支援更新檢查照片');
  validatePhotos(command.evidence);
  if (command.returnInspection && command.action !== 'grade')
    throw new BadRequestException('只有退貨檢查可更新檢查結果');
  if (command.evidence) changes.evidence = command.evidence;
  return { changes, replaceTasks: command.action !== 'move' };
}
