import test from "node:test";
import assert from "node:assert/strict";
import { clearPendingBrandReview, readPendingBrandReview, savePendingBrandReview } from '../src/pages/after-sales/pending-brand-review.ts';
import {
  clearPendingConfirmation,
  notificationStatuses,
  notificationAction,
  pendingConfirmationKey,
  proposalBlocker,
  readPendingConfirmation,
  savePendingConfirmation,
  validatePendingConfirmation,
} from "../src/pages/after-sales/native-communication-model.ts";
const scope = { actorId: "actor-a", entityId: "company-a", caseId: "case-a" };
test('brand review unknown retry preserves exact independent UUID and evidence, isolated from confirmation journal', () => {
  const store = storage();
  const value = { ...scope, schema: 'corely.doa.pending-brand-review.v1' as const, request: { operation: 'BIND_LEGACY_BRAND' as const, requestId: 'e187ba12-9733-4d4c-a512-90e773f4d837', expectedUpdatedAt: '2026-10-13T00:00:00.000Z', brand: 'BONSON' as const, proofReference: '產品照片 IMG-reference' } };
  savePendingBrandReview(store, value); assert.deepEqual(readPendingBrandReview(store, scope), value);
  assert.equal(readPendingConfirmation(store, scope), null);
  assert.throws(() => savePendingBrandReview(store, { ...value, request: { ...value.request, brand: 'MOZTECH' } }), /原請求/);
  assert.equal(readPendingBrandReview(store, { ...scope, actorId: 'other' }), null);
  clearPendingBrandReview(store, value); assert.equal(readPendingBrandReview(store, scope), null);
});
test('brand review cannot dispatch when pending journal storage cannot preserve exact body', () => {
  const value = { ...scope, schema: 'corely.doa.pending-brand-review.v1' as const, request: { operation: 'BIND_LEGACY_BRAND' as const, requestId: 'e187ba12-9733-4d4c-a512-90e773f4d837', expectedUpdatedAt: '2026-10-13T00:00:00.000Z', brand: 'MOZTECH' as const, proofReference: '檢查照片' } };
  assert.throws(() => savePendingBrandReview({ getItem: () => null, setItem: () => {} }, value), /尚未送出/);
});
const request = {
  ...scope,
  schema: "corely.doa.pending-confirmation.v1" as const,
  request: {
    operation: "CREATE_CONFIRMATION" as const,
    requestId: "e187ba12-9733-4d4c-a512-90e773f4d837",
    purpose: "PROFILE" as const,
    expectedUpdatedAt: "2026-10-13T00:00:00.000Z",
  },
};
function storage() {
  const rows = new Map<string, string>();
  return {
    getItem: (key: string) => rows.get(key) || null,
    setItem: (key: string, value: string) => {
      rows.set(key, value);
    },
    removeItem: (key: string) => {
      rows.delete(key);
    },
  };
}
test("unknown confirmation response preserves a durable exact request across reload", () => {
  const store = storage();
  savePendingConfirmation(store, request);
  assert.deepEqual(readPendingConfirmation(store, scope), request);
  savePendingConfirmation(store, request);
  assert.deepEqual(readPendingConfirmation(store, scope), request);
  clearPendingConfirmation(store, scope, request.request.requestId);
  assert.equal(readPendingConfirmation(store, scope), null);
});
test("actor/company/case scopes cannot resume each other journals", () => {
  const store = storage();
  savePendingConfirmation(store, request);
  for (const other of [
    { ...scope, actorId: "actor-b" },
    { ...scope, entityId: "company-b" },
    { ...scope, caseId: "case-b" },
  ]) {
    assert.notEqual(
      pendingConfirmationKey(scope),
      pendingConfirmationKey(other),
    );
    assert.equal(readPendingConfirmation(store, other), null);
    assert.throws(() => validatePendingConfirmation(request, other));
  }
});
test("a different UUID or content never overwrites an outstanding request", () => {
  const store = storage();
  savePendingConfirmation(store, request);
  assert.throws(() =>
    savePendingConfirmation(store, {
      ...request,
      request: { ...request.request, purpose: "QUOTE" },
    }),
  );
  assert.deepEqual(readPendingConfirmation(store, scope), request);
});
test("storage failure or tampering prevents dispatch preparation", () => {
  assert.throws(() =>
    savePendingConfirmation(
      {
        getItem: () => null,
        setItem: () => {
          throw Error("blocked");
        },
      },
      request,
    ),
  );
  assert.throws(() =>
    validatePendingConfirmation({ ...request, token: "private" }, scope),
  );
  assert.throws(() =>
    validatePendingConfirmation(
      { ...request, request: { ...request.request, token: "private" } },
      scope,
    ),
  );
});
test("disposition binds exact peritem proposal hash without keeping a URL or token", () => {
  const store = storage();
  const input = {
    ...request,
    request: {
      ...request.request,
      purpose: "DISPOSITION" as const,
      binding: {
        itemId: "physical-a",
        planVersion: 2,
        planHash: "a".repeat(64),
        proposalHash: "b".repeat(64),
      },
    },
  };
  savePendingConfirmation(store, input);
  assert.deepEqual(
    readPendingConfirmation(store, scope)?.request.binding,
    input.request.binding,
  );
  assert.equal(
    JSON.stringify(readPendingConfirmation(store, scope)).includes("token"),
    false,
  );
});
test("REVIEW/null price and partial or duplicate proposals cannot be adopted as free", () => {
  const proposal: any = {
    id: "proposal-a",
    itemId: "item-a",
    status: "PROPOSED",
    proposal: { feeMode: "REVIEW", amount: null, currency: "TWD" },
  };
  assert.equal(proposalBlocker([proposal]), "維修師尚未確認費用");
  assert.ok(proposalBlocker([proposal], true));
  assert.ok(
    proposalBlocker([
      {
        ...proposal,
        proposal: { feeMode: "FREE", amount: 0, currency: "TWD" },
      },
      {
        ...proposal,
        id: "proposal-b",
        proposal: { feeMode: "FREE", amount: 0, currency: "TWD" },
      },
    ]),
  );
  assert.equal(
    proposalBlocker([
      {
        ...proposal,
        proposal: { feeMode: "FREE", amount: 0, currency: "TWD" },
      },
    ]),
    null,
  );
});
test("provider accepted and DEV simulated are never customer delivery assertions", () => {
  assert.equal(notificationStatuses.SENT, "LINE 已接受");
  assert.equal(notificationStatuses.SIMULATED, "DEV 模擬完成");
  assert.equal(notificationStatuses.UNKNOWN, "發送結果待確認");
  assert.equal(
    Object.values(notificationStatuses).some((value) =>
      value.includes("已送達"),
    ),
    false,
  );
});
test('only a persisted AI pending provider offers receipt polling; UNKNOWN never offers resend', () => {
  for (const status of ['RECEIVED', 'HOLD', 'SENDING', 'UNKNOWN']) {
    const action = notificationAction({ status, provider: 'CORELY_AI' });
    assert.equal(action?.kind, 'POLL'); assert.equal(action?.label, '核對發送結果');
    assert.equal(action?.actionId, 'after_sales.notification.refresh'); assert.equal(action?.receiptOnly, true);
    assert.equal(notificationAction({ status, provider: 'LINE' }), null);
  }
  assert.equal(notificationAction({ status: 'APPROVED', provider: null }, 'CORELY_AI')?.label, '交給 AI 客服');
  assert.equal(notificationAction({ status: 'FAILED', provider: 'CORELY_AI' })?.kind, 'SEND');
  for (const status of ['SENT', 'SIMULATED', 'CANCELLED', 'DRAFT']) assert.equal(notificationAction({ status, provider: 'CORELY_AI' }), null);
  assert.equal(notificationStatuses.RECEIVED, 'AI 已接收，等待處理'); assert.equal(notificationStatuses.HOLD, '暫停，待客服核對');
});
