const { readFileSync } = require("node:fs");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const ts = require("../../backend/node_modules/typescript");
const path = require("node:path");
const src = readFileSync(
  path.resolve(
    __dirname,
    "../../frontend/src/services/source-interaction-bridge.ts",
  ),
  "utf8",
);
const code = ts.transpileModule(src, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const sandbox = { exports: {} };
vm.runInNewContext(code, sandbox);
const { sourceInteractionBatch, trustedSourceInteractionBatch } =
  sandbox.exports;
const data = {
  source: "corely.aftersales.interactions.v1",
  events: [{ actionId: "source.cases.create", outcome: "INTENT" }],
};
test('only explicit opaque record IDs join intent; never raw URL/phone/email fields', () => {
  const input = { ...data, events: [{ ...data.events[0], recordId: 'case-opaque' }] };
  assert.equal(sourceInteractionBatch(input)[0].recordId, 'case-opaque');
  for (const recordId of ['https://private.test?token=secret', 'email@private.test', 'raw customer']) assert.equal(sourceInteractionBatch({ ...input, events: [{ ...input.events[0], recordId }] }).length, 0);
  assert.equal(sourceInteractionBatch({ ...input, events: [{ ...input.events[0], phone: '0900000000' }] }).length, 0);
});
test("only approved current ready sameorigin frame emits interactions", () => {
  const frame = {};
  const event = { source: frame, origin: "https://erp.example", data };
  assert.equal(
    trustedSourceInteractionBatch(event, event.origin, frame, "READY").length,
    1,
  );
  assert.equal(
    trustedSourceInteractionBatch(
      event,
      "https://other.example",
      frame,
      "READY",
    ).length,
    0,
  );
  assert.equal(
    trustedSourceInteractionBatch(
      { ...event, source: {} },
      event.origin,
      frame,
      "READY",
    ).length,
    0,
  );
  for (const phase of ["LOADING", "ERROR", "REQUESTING"])
    assert.equal(
      trustedSourceInteractionBatch(event, event.origin, frame, phase).length,
      0,
    );
});
test("bridge never accepts committed client outcomes", () =>
  assert.equal(
    sourceInteractionBatch({
      ...data,
      events: [{ actionId: "source.cases.create", outcome: "COMMITTED" }],
    }).length,
    0,
  ));
test("bridge rejects private input fields and actor impersonation", () => {
  for (const key of ["actorId", "token", "query", "value", "phone"])
    assert.equal(
      sourceInteractionBatch({
        ...data,
        events: [{ ...data.events[0], [key]: "private" }],
      }).length,
      0,
    );
});
test("bridge refuses oversized batches and unregistered action prefix", () => {
  assert.equal(
    sourceInteractionBatch({ ...data, events: Array(21).fill(data.events[0]) })
      .length,
    0,
  );
  assert.equal(
    sourceInteractionBatch({
      ...data,
      events: [{ actionId: "arbitrary.click", outcome: "INTENT" }],
    }).length,
    0,
  );
});
test("cancellation and validation remain distinct UI facts", () => {
  for (const outcome of ["CANCELLED", "VALIDATION_BLOCKED"])
    assert.equal(
      sourceInteractionBatch({
        ...data,
        events: [{ actionId: "source.cases.create", outcome }],
      }).at(0).outcome,
      outcome,
    );
});
