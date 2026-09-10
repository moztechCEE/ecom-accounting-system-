import type {
  WarehouseDetail,
  WarehouseRow,
  WorkStage,
} from "./warehouse.types";
export function scanFeedback(
  before: WarehouseDetail,
  after: WarehouseDetail,
  stage: WorkStage,
) {
  const complete =
    stage === "pick" ? after.state === "picked" : after.state === "completed";
  const count = stage === "pick" ? after.picked : after.packed;
  return {
    kind: complete ? "complete" : stage,
    remaining: Math.max(0, after.required - count),
    text: complete
      ? stage === "pick"
        ? "揀貨完成，已交接裝箱"
        : "裝箱核對完成"
      : `已核對 ${count} 件，剩餘 ${Math.max(0, after.required - count)} 件`,
    accepted:
      after.revision !== before.revision &&
      count === (stage === "pick" ? before.picked : before.packed) + 1,
  };
}
export function newReadyTasks(
  previous: Set<string> | null,
  rows: WarehouseRow[],
) {
  return previous
    ? rows.filter(
        (r) => !previous.has(r.id) && ["pending", "picked"].includes(r.state),
      ).length
    : 0;
}
export function newReadyKeys(previous: Set<string> | null, keys: string[]) {
  return previous ? keys.filter((id) => !previous.has(id)).length : 0;
}

// One audio owner per workstation. Successful HTTP acceptance, not scanner decoding,
// owns success sounds. Completion/error speech must not be replaced by progress.
export class WarehouseFeedback {
  private context: AudioContext | null = null;
  private priorityUntil = 0;
  voice = false;
  get ready() {
    return this.context?.state === "running";
  }
  async enable() {
    try {
      this.context ||= new AudioContext();
      await this.context.resume();
      return this.context.state === "running";
    } catch {
      return false;
    }
  }
  play(kind: string, text?: string) {
    // Device feedback must never turn a committed scan into a failed command.
    try { this.emit(kind,text); } catch { /* Visual feedback remains available. */ }
  }
  private emit(kind: string, text?: string) {
    const ctx = this.context;
    if (ctx?.state === "running") {
      const notes =
        kind === "error"
          ? [240, 180]
          : kind === "complete"
            ? [523, 659, 784]
            : kind === "pack"
              ? [660, 880]
              : kind === "new"
                ? [800, 600]
                : [1200];
      const start = ctx.currentTime;
      notes.forEach((frequency, index) => {
        const osc = ctx.createOscillator(),
          gain = ctx.createGain(),
          at = start + index * 0.13;
        osc.frequency.value = frequency;
        osc.type = "sine";
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(0.15, at + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, at + 0.11);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(at);
        osc.stop(at + 0.12);
      });
    }
    if (!this.voice || !text || !("speechSynthesis" in window)) return;
    const important = kind === "error" || kind === "complete";
    if (!important && Date.now() < this.priorityUntil) return;
    if (important) this.priorityUntil = Date.now() + 2500;
    window.speechSynthesis.cancel();
    const speech = new SpeechSynthesisUtterance(text);
    speech.lang = "zh-TW";
    speech.rate = 1.15;
    window.speechSynthesis.speak(speech);
  }
  close() {
    void this.context?.close();
    this.context = null;
    if (this.voice && "speechSynthesis" in window)
      window.speechSynthesis.cancel();
  }
}
