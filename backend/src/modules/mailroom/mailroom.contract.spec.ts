import {
  transition,
  signRequest,
  validatePhotos,
  type Actor,
  type ItemState,
} from './mailroom.contract';
import { authenticateMailroomReader } from './mailroom.auth';
const mail: Actor = {
  id: 'mail',
  name: '收發',
  entityIds: ['tw'],
  permissions: new Set(['mailroom:read', 'mailroom:create', 'mailroom:update']),
};
const repair: Actor = {
  id: 'repair',
  name: '維修',
  entityIds: ['tw'],
  permissions: new Set(['repair_workbench:read', 'repair_workbench:update']),
};
const item: ItemState = {
  id: 'item',
  entityId: 'tw',
  version: 1,
  status: 'RECEIVED',
  productName: '示範產品',
  sku: 'demo',
  serialNumber: null,
  location: 'A-1',
  custodianId: 'mail',
  recipientId: null,
  nextUserId: null,
  repairOwnerId: null,
  matchResult: 'PENDING',
  grade: null,
  disposition: null,
  receipt: { category: 'REPAIR', receivedById: 'mail', sourceCaseId: 'source' },
};
const cmd = { entityId: 'tw', requestId: 'request-1', expectedVersion: 1 };
describe('Mailroom physical custody and permissions', () => {
  it('requires inspection before repair pickup, and refuses a stale click', () => {
    expect(() =>
      transition(
        item,
        { ...cmd, action: 'accept', confirmedItems: true, location: 'R-1' },
        repair,
      ),
    ).toThrow();
    expect(() =>
      transition(
        item,
        {
          ...cmd,
          expectedVersion: 2,
          action: 'inspect',
          productName: '示範',
          matchResult: 'MATCH',
          nextUserId: 'repair',
        },
        mail,
      ),
    ).toThrow('資料已更新');
  });
  it('mismatch retains custody and waits for customer service, not the receiving clerk', () => {
    const { changes } = transition(
      item,
      {
        ...cmd,
        action: 'inspect',
        productName: '另一品項',
        matchResult: 'MISMATCH',
        note: '型號不一致',
      },
      mail,
    );
    expect(changes).toMatchObject({ status: 'MISMATCH', nextUserId: null });
    expect(changes).not.toHaveProperty('custodianId');
    expect(() =>
      transition(
        { ...item, status: 'MISMATCH' },
        {
          ...cmd,
          action: 'resolve_mismatch',
          note: '同意',
          nextUserId: 'repair',
        },
        mail,
      ),
    ).toThrow();
  });
  it('only the addressed person can take custody, explicit physical confirmation is required', () => {
    const waiting = {
      ...item,
      status: 'WAITING_REPAIR_ACCEPTANCE',
      nextUserId: 'repair',
    };
    expect(() =>
      transition(
        waiting,
        { ...cmd, action: 'accept', confirmedItems: true, location: 'R-1' },
        mail,
      ),
    ).toThrow();
    expect(() =>
      transition(
        waiting,
        { ...cmd, action: 'accept', location: 'R-1' },
        repair,
      ),
    ).toThrow();
    expect(
      transition(
        waiting,
        { ...cmd, action: 'accept', confirmedItems: true, location: 'R-1' },
        repair,
      ).changes,
    ).toMatchObject({
      status: 'REPAIR_RECEIVED',
      custodianId: 'repair',
      repairOwnerId: 'repair',
    });
  });
  it('blocks actual repair without current source approval/payment and blocks other technicians', () => {
    const inspection = {
      ...item,
      status: 'INSPECTING',
      custodianId: 'repair',
      repairOwnerId: 'repair',
    };
    expect(() =>
      transition(inspection, { ...cmd, action: 'start_repair' }, repair, false),
    ).toThrow();
    expect(() =>
      transition(
        inspection,
        { ...cmd, action: 'start_repair' },
        { ...repair, id: 'other' },
        true,
      ),
    ).toThrow();
    expect(
      transition(inspection, { ...cmd, action: 'start_repair' }, repair, true)
        .changes.status,
    ).toBe('REPAIRING');
  });
  it('lets the clerk hand a matched repair to the unassigned claim pool without moving custody', () => {
    const { changes } = transition(
      item,
      {
        ...cmd,
        action: 'inspect',
        productName: '示範產品',
        matchResult: 'MATCH',
      },
      mail,
    );
    expect(changes).toMatchObject({
      status: 'WAITING_REPAIR_ACCEPTANCE',
      nextUserId: null,
    });
    expect(changes).not.toHaveProperty('custodianId');
    expect(changes).not.toHaveProperty('repairOwnerId');
  });
  it('claims only an unassigned repair and leaves physical custody, location and progress untouched', () => {
    const waiting = {
      ...item,
      status: 'WAITING_REPAIR_ACCEPTANCE',
      matchResult: 'MATCH',
    };
    expect(
      transition(waiting, { ...cmd, action: 'claim' }, repair).changes,
    ).toEqual({ nextUserId: repair.id });
    for (const occupied of [
      { nextUserId: 'someone' },
      { repairOwnerId: 'someone' },
    ])
      expect(() =>
        transition(
          { ...waiting, ...occupied },
          { ...cmd, action: 'claim' },
          repair,
        ),
      ).toThrow('已有接收人');
    expect(() =>
      transition(waiting, { ...cmd, action: 'claim' }, mail),
    ).toThrow('沒有此作業權限');
    expect(() =>
      transition(
        { ...waiting, entityId: 'other' },
        { ...cmd, action: 'claim' },
        repair,
      ),
    ).toThrow('無此公司');
    expect(() => transition(item, { ...cmd, action: 'claim' }, repair)).toThrow(
      '目前進度',
    );
    expect(() =>
      transition(
        waiting,
        { ...cmd, action: 'claim', confirmedItems: true, location: 'R-1' },
        repair,
      ),
    ).toThrow('另行本人簽收');
  });
  it('requires a separate physical signature after a successful claim', () => {
    const claimed = {
      ...item,
      status: 'WAITING_REPAIR_ACCEPTANCE',
      nextUserId: repair.id,
    };
    expect(() =>
      transition(claimed, { ...cmd, action: 'start_inspection' }, repair),
    ).toThrow('本人已簽收');
    expect(
      transition(
        claimed,
        { ...cmd, action: 'accept', confirmedItems: true, location: 'R-1' },
        repair,
      ).changes,
    ).toMatchObject({
      status: 'REPAIR_RECEIVED',
      repairOwnerId: repair.id,
      custodianId: repair.id,
      location: 'R-1',
    });
  });
  it.each([
    ['AA', 'PENDING_RESTOCK'],
    ['A', 'PENDING_DISPOSITION'],
    ['B', 'PENDING_REFURBISH'],
    ['C', 'PENDING_REFURBISH'],
  ] as const)(
    'routes grade %s without posting inventory or refunding',
    (grade, status) => {
      const { changes } = transition(
        { ...item, receipt: { ...item.receipt, category: 'RETURN' } },
        {
          ...cmd,
          action: 'grade',
          grade,
          note: '已檢查包裝、外觀與配件',
          matchResult: 'MATCH',
          returnInspection: {
            packaging: 'INTACT',
            product: 'NEW_UNUSED',
            accessories: 'COMPLETE',
          },
          evidence: [
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
          ],
          disposition: 'WELFARE_SALE',
          nextUserId: 'repair',
        },
        mail,
      );
      expect(changes.status).toBe(status);
      expect(changes).not.toHaveProperty('stock');
      expect(changes).not.toHaveProperty('refund');
    },
  );
  it('isolates entities even for otherwise privileged operators', () => {
    expect(() =>
      transition(
        item,
        { ...cmd, action: 'move', location: 'B', note: '移位' },
        { ...mail, entityIds: ['other'] },
      ),
    ).toThrow();
  });
  it('requires photos and explicit inspection, and retains a mismatched return with the clerk', () => {
    const returned = {
      ...item,
      receipt: { ...item.receipt, category: 'RETURN' },
    };
    const checked = {
      ...cmd,
      action: 'grade' as const,
      grade: 'B' as const,
      note: '實收品項不同',
      matchResult: 'MISMATCH' as const,
      returnInspection: {
        packaging: 'MAJOR_DAMAGE' as const,
        product: 'VISIBLE_WEAR' as const,
        accessories: 'MISSING' as const,
      },
    };
    expect(() => transition(returned, checked, mail)).toThrow('拍照');
    const changes = transition(
      returned,
      {
        ...checked,
        evidence: [
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
        ],
      },
      mail,
    ).changes;
    expect(changes).toMatchObject({
      status: 'MISMATCH',
      nextUserId: null,
      grade: 'B',
      returnInspection: checked.returnInspection,
    });
    expect(changes).not.toHaveProperty('custodianId');
    const reviewer = {
      ...mail,
      id: 'cs',
      permissions: new Set(['mailroom:review']),
    };
    expect(
      transition(
        { ...returned, status: 'MISMATCH' },
        {
          ...cmd,
          action: 'resolve_mismatch',
          note: '顧客已確認退回的是此品项',
        },
        reviewer,
      ).changes,
    ).toMatchObject({
      status: 'RECEIVED',
      matchResult: 'CONFIRMED_ACTUAL',
      nextUserId: null,
    });
  });
  it('customer-service inspection acknowledgement keeps stock and refund independent', () => {
    const checked = {
      ...item,
      status: 'PENDING_RESTOCK',
      matchResult: 'MATCH',
      receipt: {
        ...item.receipt,
        category: 'RETURN',
        customerServiceUserId: 'cs',
      },
      returnInspection: {
        packaging: 'INTACT',
        product: 'NEW_UNUSED',
        accessories: 'COMPLETE',
      },
    };
    const review = {
      ...mail,
      id: 'cs',
      permissions: new Set(['mailroom:review']),
    };
    expect(() =>
      transition(
        checked,
        { ...cmd, action: 'acknowledge_inspection', note: '接手' },
        mail,
      ),
    ).toThrow();
    const changes = transition(
      checked,
      { ...cmd, action: 'acknowledge_inspection', note: '已接手核對退款案件' },
      review,
    ).changes;
    expect(changes).not.toHaveProperty('status');
    expect(changes.returnInspection).toMatchObject({ reviewedBy: 'cs' });
    expect(changes).not.toHaveProperty('refund');
  });
  it('refuses AA restock for a worn product or missing accessories', () => {
    const returned = {
      ...item,
      receipt: { ...item.receipt, category: 'RETURN' },
    };
    const checked = {
      ...cmd,
      action: 'grade' as const,
      grade: 'AA' as const,
      note: '檢查',
      matchResult: 'MATCH' as const,
      evidence: [
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
      ],
    };
    for (const inspection of [
      {
        packaging: 'INTACT' as const,
        product: 'SEVERE_DAMAGE' as const,
        accessories: 'COMPLETE' as const,
      },
      {
        packaging: 'INTACT' as const,
        product: 'NEW_UNUSED' as const,
        accessories: 'MISSING' as const,
      },
    ])
      expect(() =>
        transition(
          returned,
          { ...checked, returnInspection: inspection },
          mail,
        ),
      ).toThrow('AA 級');
  });
  it('preserves customer-service acknowledgment on identical inspection and reopens it when evidence changes', () => {
    const photo =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
    const inspection = {
      packaging: 'MINOR_DAMAGE' as const,
      product: 'NEW_UNUSED' as const,
      accessories: 'COMPLETE' as const,
    };
    const checked = {
      ...item,
      status: 'PENDING_RESTOCK',
      matchResult: 'MATCH',
      grade: 'AA',
      disposition: 'RESTOCK',
      conditionNote: '包裝檢查',
      evidence: [photo],
      receipt: { ...item.receipt, category: 'RETURN' },
      returnInspection: {
        ...inspection,
        reviewedAt: '2026-10-02T00:00:00.000Z',
        reviewedBy: 'cs',
      },
    };
    const command = {
      ...cmd,
      action: 'grade' as const,
      grade: 'AA' as const,
      note: '包裝檢查',
      matchResult: 'MATCH' as const,
      returnInspection: inspection,
    };
    expect(
      transition(checked, command, mail).changes.returnInspection,
    ).toMatchObject({
      reviewedBy: 'cs',
      reviewedAt: '2026-10-02T00:00:00.000Z',
    });
    expect(
      transition(checked, { ...command, evidence: [photo, photo] }, mail)
        .changes.returnInspection,
    ).not.toHaveProperty('reviewedAt');
    expect(
      transition(checked, { ...command, note: '包裝補充檢查' }, mail).changes
        .returnInspection,
    ).not.toHaveProperty('reviewedAt');
  });
  it('accepts a recipient with no operational role, never somebody else', () => {
    const waiting = {
      ...item,
      status: 'WAITING_PICKUP',
      recipientId: 'person',
      nextUserId: 'person',
    };
    expect(
      transition(
        waiting,
        {
          ...cmd,
          action: 'accept',
          confirmedItems: true,
          location: '本人領回',
        },
        { ...mail, id: 'person', permissions: new Set() },
      ).changes.status,
    ).toBe('COLLECTED');
  });
  it('does not allow SVG or oversized evidence', () => {
    expect(() =>
      validatePhotos(['data:image/svg+xml;base64,PHN2Zz4=']),
    ).toThrow();
    expect(() => validatePhotos(['data:image/png;base64,YWJj'])).toThrow();
  });
});
describe('Mailroom service read authentication', () => {
  const secret = 'local-test-secret-more-than-32-characters';
  const time = Math.floor(Date.now() / 1000).toString();
  const path = '/api/v1/mailroom/integration/cases/demo';
  const env = {
    MAILROOM_ENABLED: 'true',
    MAILROOM_READERS: JSON.stringify([{ keyId: 'ai', entityId: 'tw', secret }]),
  };
  const request = () => ({
    method: 'GET',
    originalUrl: path,
    headers: {
      'x-mailroom-key': 'ai',
      'x-mailroom-entity': 'tw',
      'x-mailroom-time': time,
      'x-mailroom-signature': signRequest(secret, 'GET', path, time, '', 'tw'),
    },
  });
  it('binds read access to exact path, method, entity and time', () => {
    expect(authenticateMailroomReader(request(), env)).toBe(true);
    for (const req of [
      { ...request(), method: 'POST' },
      { ...request(), originalUrl: path + '?extra=1' },
      {
        ...request(),
        headers: { ...request().headers, 'x-mailroom-entity': 'other' },
      },
      {
        ...request(),
        headers: { ...request().headers, 'x-mailroom-time': '1000000000' },
      },
    ])
      expect(() => authenticateMailroomReader(req, env)).toThrow();
    expect(() => authenticateMailroomReader(request(), {})).toThrow(
      'MAILROOM_DISABLED',
    );
  });
});
