import test from "node:test";
import assert from "node:assert/strict";
import {
  newReadyTasks,
  newReadyKeys,
  scanFeedback,
  WarehouseFeedback,
} from "../src/services/warehouse-feedback.ts";
import { createSimulation } from "./wms-simulator.ts";
test('device errors cannot throw after a successfully saved scan',()=>{
 const audio=new WarehouseFeedback();(audio as any).context={state:'running',createOscillator(){throw Error('device disconnected')}};
 assert.doesNotThrow(()=>audio.play('complete','核對完成'));
})
test("last accepted item produces completion feedback, not ordinary scan sound", () => {
  const s = createSimulation(),
    before = s.detail("wms-fixture-1", "picker");
  const after = { ...before, picked: 1, revision: 2, state: "picking" };
  assert.equal(scanFeedback(before, after, "pick").kind, "pick");
  const complete = { ...after, picked: 3, revision: 3, state: "picked" };
  const result = scanFeedback({ ...after, picked: 2 }, complete, "pick");
  assert.equal(result.kind, "complete");
  assert.equal(result.accepted, true);
  assert.equal(result.remaining, 0);
  assert.equal(scanFeedback(complete, complete, "pick").accepted, false);
});
test("station-wide ready keys notify even when filtered table rows are empty", () => {
  assert.equal(newReadyKeys(null, ["old"]), 0);
  assert.equal(
    newReadyKeys(new Set(["old"]), ["old", "new-on-another-page"]),
    1,
  );
  assert.equal(
    newReadyKeys(new Set(["old", "new-on-another-page"]), [
      "old",
      "new-on-another-page",
    ]),
    0,
  );
});
test("audio sequences distinguish ordinary scans, completion and errors; voice defaults off", async () => {
  const saved = globalThis.AudioContext,
    frequencies: number[] = [];
  class Context {
    state = "running";
    currentTime = 0;
    destination = {};
    async resume() {}
    async close() {}
    createOscillator() {
      const node = {
        frequency: { value: 0 },
        type: "",
        connect() {},
        start() {
          frequencies.push(node.frequency.value);
        },
        stop() {},
      };
      return node;
    }
    createGain() {
      return {
        gain: {
          setValueAtTime() {},
          linearRampToValueAtTime() {},
          exponentialRampToValueAtTime() {},
        },
        connect() {},
      };
    }
  }
  Object.assign(globalThis, { AudioContext: Context });
  try {
    const audio = new WarehouseFeedback();
    assert.equal(audio.voice, false);
    assert.equal(await audio.enable(), true);
    audio.play("pick");
    assert.deepEqual(frequencies.splice(0), [1200]);
    audio.play("pack");
    assert.deepEqual(frequencies.splice(0), [660, 880]);
    audio.play("complete");
    assert.deepEqual(frequencies.splice(0), [523, 659, 784]);
    audio.play("error");
    assert.deepEqual(frequencies.splice(0), [240, 180]);
    audio.close();
  } finally {
    Object.assign(globalThis, { AudioContext: saved });
  }
});
test("initial snapshot is quiet and newly eligible packing task is detected", () => {
  const s = createSimulation(),
    row = { ...s.orders[0], state: "picked" };
  assert.equal(newReadyTasks(null, [row]), 0);
  assert.equal(newReadyTasks(new Set(), [row]), 1);
  assert.equal(newReadyTasks(new Set([row.id]), [row]), 0);
});
