import { describe, expect, it } from "vitest";

import { createSerialQueue } from "../serialQueue";

describe("createSerialQueue", () => {
  it("前の処理が終わるまで次を始めない", async () => {
    const enqueue = createSerialQueue();
    const events: string[] = [];
    let finishFirst!: () => void;

    const first = enqueue(async () => {
      events.push("first:start");
      await new Promise<void>((resolve) => (finishFirst = resolve));
      events.push("first:end");
    });
    const second = enqueue(async () => {
      events.push("second:start");
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual(["first:start"]);

    finishFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(["first:start", "first:end", "second:start"]);
  });

  it("失敗は呼び手にだけ返り、次の処理は走る", async () => {
    const enqueue = createSerialQueue();

    const failed = enqueue(async () => {
      throw new Error("落ちた");
    });
    const next = enqueue(async () => "次");

    await expect(failed).rejects.toThrow("落ちた");
    await expect(next).resolves.toBe("次");
  });

  it("列どうしは独立している", async () => {
    const stuck = createSerialQueue();
    const other = createSerialQueue();

    void stuck(() => new Promise<void>(() => {}));

    await expect(other(async () => "通る")).resolves.toBe("通る");
  });
});
