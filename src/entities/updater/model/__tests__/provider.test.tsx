// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UpdaterProvider } from "../provider";
import { useUpdater } from "../useUpdater";
import type { UpdaterState } from "../types";

/**
 * `docs/state-transitions/updater.md` のセルを踏む。
 *
 * **plugin を差し替えるのは、実プロセスが要る経路をここでは踏めないため。**
 * 入替そのもの（D1 → D2 / D3）はこちらから観測できないので、固定できるのは
 * 「plugin がどう振る舞ったとき、画面がどの段に居るか」まで。
 */

const check = vi.fn();
const relaunch = vi.fn();
const loadUpdaterState = vi.fn();
const saveUpdaterState = vi.fn();

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: (...args: unknown[]) => check(...args),
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: (...args: unknown[]) => relaunch(...args),
}));

vi.mock("../../api/updaterState", () => ({
  loadUpdaterState: (...args: unknown[]) => loadUpdaterState(...args),
  saveUpdaterState: (...args: unknown[]) => saveUpdaterState(...args),
}));

const EMPTY: UpdaterState = { skippedVersion: null, lastCheckedMs: null };

type DownloadEvent =
  | { event: "Started"; data: { contentLength?: number } }
  | { event: "Progress"; data: { chunkLength: number } }
  | { event: "Finished" };

/** `Update` のうち、provider が触る分だけ */
function fakeUpdate(version: string, run: (emit: (e: DownloadEvent) => void) => Promise<void>) {
  return {
    version,
    close: vi.fn().mockResolvedValue(undefined),
    downloadAndInstall: vi.fn((onEvent: (e: DownloadEvent) => void) => run(onEvent)),
  };
}

function Probe() {
  const {
    status,
    persisted,
    manualCheck,
    isChecking,
    downloadAndInstall,
    dismiss,
    skipCurrentVersion,
    unskip,
    checkNow,
  } = useUpdater();

  return (
    <div>
      <span data-testid="phase">{status.phase}</span>
      <span data-testid="detail">
        {status.phase === "error"
          ? `${status.failure.stage}:${status.failure.detail}`
          : status.phase === "available"
            ? status.version
            : status.phase === "downloading"
              ? String(status.progress)
              : "-"}
      </span>
      <span data-testid="skipped">{persisted?.skippedVersion ?? "-"}</span>
      <span data-testid="lastChecked">{String(persisted?.lastCheckedMs ?? "-")}</span>
      <span data-testid="manual">{manualCheck?.kind ?? "-"}</span>
      <span data-testid="checking">{String(isChecking)}</span>
      <button data-testid="install" onClick={() => void downloadAndInstall()}>
        install
      </button>
      <button data-testid="dismiss" onClick={dismiss}>
        dismiss
      </button>
      <button data-testid="skip" onClick={() => void skipCurrentVersion()}>
        skip
      </button>
      <button data-testid="unskip" onClick={() => void unskip()}>
        unskip
      </button>
      <button data-testid="checkNow" onClick={() => void checkNow()}>
        checkNow
      </button>
    </div>
  );
}

function mount() {
  render(
    <UpdaterProvider>
      <Probe />
    </UpdaterProvider>,
  );
}

function phase() {
  return screen.getByTestId("phase").textContent;
}

/** 起動時の確認が終わって段が据わるまで待つ */
async function settled(expected: string) {
  await waitFor(() => expect(phase()).toBe(expected));
}

beforeEach(() => {
  vi.clearAllMocks();
  loadUpdaterState.mockResolvedValue(EMPTY);
  saveUpdaterState.mockResolvedValue(undefined);
  check.mockResolvedValue(null);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("確認", () => {
  /**
   * **`idle` を待つだけでは「まだ始まっていない」と区別が付かない。**
   * 初期値が `idle` なので、確認が走る前にその判定が通ってしまう。
   * 確認が終わったことは、確認が通ったときだけ書かれる記憶で見る。
   */
  async function checkSettled() {
    await waitFor(() => expect(saveUpdaterState).toHaveBeenCalled());
  }

  it("(S1, E3) 更新が無ければ何も描かない段へ戻る", async () => {
    mount();
    await checkSettled();
    expect(phase()).toBe("idle");
    expect(screen.getByTestId("manual").textContent).toBe("-");
  });

  it("(S1, E2) 更新があれば告知の段へ進む", async () => {
    check.mockResolvedValue(fakeUpdate("9.9.9", async () => {}));
    mount();
    await settled("available");
    expect(screen.getByTestId("detail").textContent).toBe("9.9.9");
  });

  it("(S1, E5) 確認が失敗しても段は idle のままで、最後に確認できた時刻が動かない", async () => {
    check.mockRejectedValue(new Error("つながらない"));
    mount();
    // 失敗の枝は記憶を書かないので、通ったことは記録で待つ
    await waitFor(() => expect(console.error).toHaveBeenCalled());
    expect(phase()).toBe("idle");
    expect(screen.getByTestId("lastChecked").textContent).toBe("-");
    // **書いてはいけない。** 書くと「確認できている」と「試みたが失敗した」が
    // 同じ値になり、配布先が壊れていることを読み取る手掛かりが消える
    expect(saveUpdaterState).not.toHaveBeenCalled();
  });

  it("確認が通れば最後に確認できた時刻を書く", async () => {
    mount();
    await waitFor(() => expect(saveUpdaterState).toHaveBeenCalledTimes(1));
    expect(saveUpdaterState.mock.calls[0]![0].lastCheckedMs).toBeTypeOf("number");
  });

  it("上限を渡して確認する", async () => {
    mount();
    await checkSettled();
    expect(check.mock.calls[0]![0]).toMatchObject({
      timeout: expect.any(Number),
    });
  });

  it("(S1, E4) 飛ばす設定の版は告知しない", async () => {
    loadUpdaterState.mockResolvedValue({
      skippedVersion: "9.9.9",
      lastCheckedMs: 1,
    });
    const update = fakeUpdate("9.9.9", async () => {});
    check.mockResolvedValue(update);
    mount();
    // **`close` で待つ。** 飛ばす枝だけがここを通るので、枝を外すと待ちが空振りする
    await waitFor(() => expect(update.close).toHaveBeenCalled());
    expect(phase()).toBe("idle");
  });

  it("飛ばす設定と違う版なら告知する", async () => {
    loadUpdaterState.mockResolvedValue({
      skippedVersion: "9.9.8",
      lastCheckedMs: 1,
    });
    check.mockResolvedValue(fakeUpdate("9.9.9", async () => {}));
    mount();
    await settled("available");
  });
});

describe("取得と適用", () => {
  /** `Finished` を送ったあと、解決も棄却もしないまま止める */
  function pending(version: string) {
    let settle!: (ok: boolean) => void;
    const update = fakeUpdate(version, async (emit) => {
      emit({ event: "Started", data: { contentLength: 100 } });
      emit({ event: "Progress", data: { chunkLength: 50 } });
      emit({ event: "Finished" });
      await new Promise<void>((resolve, reject) => {
        settle = (ok) => (ok ? resolve() : reject(new Error("入替に失敗")));
      });
    });
    return { update, settle: (ok: boolean) => settle(ok) };
  }

  it("(S4) 取得の完了では ready にしない", async () => {
    const { update } = pending("9.9.9");
    check.mockResolvedValue(update);
    mount();
    await settled("available");

    fireEvent.click(screen.getByTestId("install"));
    await settled("installing");
  });

  it("(S4, E9) 入替が終わってから ready になる", async () => {
    const { update, settle } = pending("9.9.9");
    check.mockResolvedValue(update);
    mount();
    await settled("available");

    fireEvent.click(screen.getByTestId("install"));
    await settled("installing");
    settle(true);
    await settled("ready");
  });

  it("(S4, E10) 取得の後に落ちたら install の失敗になる", async () => {
    const { update, settle } = pending("9.9.9");
    check.mockResolvedValue(update);
    mount();
    await settled("available");

    fireEvent.click(screen.getByTestId("install"));
    await settled("installing");
    settle(false);
    await settled("error");
    expect(screen.getByTestId("detail").textContent).toBe("install:入替に失敗");
  });

  it("(S3, E10) 取得の最中に落ちたら download の失敗になる", async () => {
    check.mockResolvedValue(
      fakeUpdate("9.9.9", async (emit) => {
        emit({ event: "Started", data: { contentLength: 100 } });
        throw new Error("切れた");
      }),
    );
    mount();
    await settled("available");

    fireEvent.click(screen.getByTestId("install"));
    await settled("error");
    expect(screen.getByTestId("detail").textContent).toBe("download:切れた");
  });

  it("(S2, E6) を2回踏んでも取得は1本しか走らない", async () => {
    const { update } = pending("9.9.9");
    check.mockResolvedValue(update);
    mount();
    await settled("available");

    const button = screen.getByTestId("install");
    fireEvent.click(button);
    fireEvent.click(button);
    await settled("installing");
    expect(update.downloadAndInstall).toHaveBeenCalledTimes(1);
  });

  it("押した直後に段が進む。最初のチャンクを待たない", async () => {
    let emitStarted!: () => void;
    const update = fakeUpdate(
      "9.9.9",
      (emit) =>
        new Promise<void>(() => {
          emitStarted = () => emit({ event: "Started", data: { contentLength: 100 } });
        }),
    );
    check.mockResolvedValue(update);
    mount();
    await settled("available");

    fireEvent.click(screen.getByTestId("install"));
    await settled("downloading");
    expect(emitStarted).toBeTypeOf("function");
  });
});

describe("飛ばす／解除", () => {
  it("(S2, E16) 飛ばすと永続され、段は idle へ戻る", async () => {
    check.mockResolvedValue(fakeUpdate("9.9.9", async () => {}));
    mount();
    await settled("available");

    fireEvent.click(screen.getByTestId("skip"));
    await settled("idle");
    await waitFor(() =>
      expect(saveUpdaterState).toHaveBeenLastCalledWith(
        expect.objectContaining({ skippedVersion: "9.9.9" }),
      ),
    );
    expect(screen.getByTestId("skipped").textContent).toBe("9.9.9");
  });

  it("飛ばしても最後に確認できた時刻を消さない", async () => {
    loadUpdaterState.mockResolvedValue({
      skippedVersion: null,
      lastCheckedMs: 111,
    });
    check.mockResolvedValue(fakeUpdate("9.9.9", async () => {}));
    mount();
    await settled("available");

    fireEvent.click(screen.getByTestId("skip"));
    await waitFor(() =>
      expect(saveUpdaterState).toHaveBeenLastCalledWith(
        expect.objectContaining({ skippedVersion: "9.9.9" }),
      ),
    );
    expect(saveUpdaterState.mock.lastCall![0].lastCheckedMs).toBeTypeOf("number");
  });

  it("(E18) 解除すると飛ばす版が消える", async () => {
    loadUpdaterState.mockResolvedValue({
      skippedVersion: "9.9.9",
      lastCheckedMs: 1,
    });
    const update = fakeUpdate("9.9.9", async () => {});
    check.mockResolvedValue(update);
    mount();
    await waitFor(() => expect(update.close).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId("unskip"));
    await waitFor(() => expect(screen.getByTestId("skipped").textContent).toBe("-"));
  });

  it("(S2, E11) 閉じても飛ばす版は増えない", async () => {
    check.mockResolvedValue(fakeUpdate("9.9.9", async () => {}));
    mount();
    await settled("available");

    fireEvent.click(screen.getByTestId("dismiss"));
    await settled("idle");
    expect(screen.getByTestId("skipped").textContent).toBe("-");
  });
});

describe("設定からの確認", () => {
  it("(E17) 更新が無ければ最新版だと答える", async () => {
    mount();
    await waitFor(() => expect(saveUpdaterState).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId("checkNow"));
    await waitFor(() => expect(screen.getByTestId("manual").textContent).toBe("upToDate"));
  });

  it("(E17) 失敗したら押した本人には答える", async () => {
    mount();
    await waitFor(() => expect(saveUpdaterState).toHaveBeenCalled());

    check.mockRejectedValue(new Error("つながらない"));
    fireEvent.click(screen.getByTestId("checkNow"));
    await waitFor(() => expect(screen.getByTestId("manual").textContent).toBe("failed"));
    expect(phase()).toBe("idle");
  });

  it("(E17) 飛ばす版が見つかったことは伝える。告知は出さない", async () => {
    loadUpdaterState.mockResolvedValue({
      skippedVersion: "9.9.9",
      lastCheckedMs: 1,
    });
    mount();
    await waitFor(() => expect(saveUpdaterState).toHaveBeenCalled());

    check.mockResolvedValue(fakeUpdate("9.9.9", async () => {}));
    fireEvent.click(screen.getByTestId("checkNow"));
    await waitFor(() => expect(screen.getByTestId("manual").textContent).toBe("foundButSkipped"));
    expect(phase()).toBe("idle");
  });

  it("(E17) 取得の最中は確認しない", async () => {
    const { update } = pendingInstall("9.9.9");
    check.mockResolvedValue(update);
    mount();
    await settled("available");

    fireEvent.click(screen.getByTestId("install"));
    await settled("installing");

    const before = check.mock.calls.length;
    fireEvent.click(screen.getByTestId("checkNow"));
    await waitFor(() => expect(screen.getByTestId("checking").textContent).toBe("false"));
    expect(check.mock.calls.length).toBe(before);
  });
});

/** `取得と適用` の `pending` と同じもの。describe をまたぐので別に置く */
function pendingInstall(version: string) {
  const update = fakeUpdate(version, async (emit) => {
    emit({ event: "Started", data: { contentLength: 100 } });
    emit({ event: "Finished" });
    await new Promise<void>(() => {});
  });
  return { update };
}
