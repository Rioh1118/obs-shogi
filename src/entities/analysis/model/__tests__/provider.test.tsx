// @vitest-environment happy-dom
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { StrictMode, useEffect } from "react";

import { AnalysisProvider } from "../provider";
import { useAnalysis } from "../useAnalysis";
import { shortenWaits, waits } from "../waits";
import type { AnalysisContextType, PositionSyncAdapter } from "../types";
import type { AnalysisResult } from "@/entities/engine";
import {
  ENGINE_ERROR_MESSAGE,
  ENGINE_FAILED_MESSAGE,
  NO_ENGINE_SELECTED_MESSAGE,
  ENGINE_STARTING_MESSAGE,
  ENGINE_RESTARTED_MESSAGE,
  LISTENERS_FAILED_MESSAGE,
  POSITION_SYNC_FAILED_MESSAGE,
  POSITION_SYNC_TIMEOUT_MESSAGE,
  RELEASE_FAILED_MESSAGE,
  RESTART_FAILED_MESSAGE,
  START_REFUSED_MESSAGE,
  STOP_FAILED_MESSAGE,
} from "../refusals";

const startCore = vi.fn<() => Promise<string>>();
const stopCore = vi.fn<(sessionId?: string, by?: string) => Promise<void>>();

// リスナを実際に登録させたい回だけ true にする。既定を true にすると、
// 全部の回で登録と解除が挟まって、見たい経路が長くなる。
let tauri = false;
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => tauri }));
vi.mock("@/entities/engine/api/tauri", () => ({
  startInfiniteAnalysis: () => startCore(),
  stopAnalysis: (sessionId?: string, by?: string) => stopCore(sessionId, by),
}));
// エンジンの状態。**理由を決めるのは engine 側**（`EngineNotReadyReason`）なので、
// 断りを枝ごとに見るテストはその理由を動かす。
let engine = {
  isReady: true,
  notReadyReason: null as "no-engine" | "starting" | "failed" | null,
};
vi.mock("@/entities/engine", () => ({
  useEngine: () => ({ isReady: engine.isReady, notReadyReason: engine.notReadyReason }),
}));

/** 最後に登録されたリスナ。Rust からの通知を差し込む口。 */
type Listeners = {
  onUpdate: (sessionId: string, result: AnalysisResult) => void;
  onError: (error: string) => void;
};
let listeners: Listeners | null = null;
/** 購読の登録を落としたい回だけ立てる */
let listenerSetupFails = false;
vi.mock("@/entities/engine/api/events", () => ({
  setupAnalysisEventListeners: async (handlers: Listeners) => {
    if (listenerSetupFails) throw new Error("listen failed");
    listeners = handlers;
    return () => {};
  },
}));

const oneCandidate: AnalysisResult = { candidates: [{ rank: 1, pv_line: ["7g7f"] }] };

/** 実時間を進める。打ち切りの判定が Date.now() を見るので偽タイマーは使えない。 */
const advance = (ms: number) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));

/**
 * **上限を跨ぐテストだけ**に付ける持ち時間。
 *
 * 寸法は `shortenWaits` で縮めてあるが（下の `beforeEach`）、それでも1本あたり数百ミリ秒を
 * 実時間で進める。既定の5秒でも足りるはずだが、並走する機械でも取りこぼさない幅を残す。
 * ミリ秒しか進めないテストには付けない——付けると、本当に止まったテストが長く待たされる。
 */
const SLOW = 20_000;

/**
 * 縮めた寸法（`shortenWaits`）。**数字も比も写さない**——写すと片方だけ動かせる。
 *
 * 散文に現物の値を書かないこと。このファイルは `beforeEach` で寸法を縮めるので、
 * **現物の値はどれも当たらない**。
 *
 * **`advance()` の引数まで導く必要は無い。** 上限や間引きを**跨ぐ**待ちだけを
 * `limitMs()` / `flushMs()` から導く。跨がない短い待ち（連打を畳む・応答を1つ進める）は
 * 生の数字でよい——全部を比に直すと、何が寸法に依存しているのか読めなくなる。
 */
const limitMs = () => waits().positionSyncTimeoutMs;
const flushMs = () => waits().resultFlushMs;

function mountAnalysis(initial: PositionSyncAdapter, { strict = false } = {}) {
  const seen: AnalysisContextType[] = [];

  function Probe() {
    const analysis = useAnalysis();
    useEffect(() => {
      seen.push(analysis);
    });
    return null;
  }

  const tree = (sync: PositionSyncAdapter) => {
    const provider = (
      <AnalysisProvider positionSync={sync}>
        <Probe />
      </AnalysisProvider>
    );
    return strict ? <StrictMode>{provider}</StrictMode> : provider;
  };

  const utils = render(tree(initial));
  return {
    async setSync(sync: PositionSyncAdapter) {
      await act(async () => {
        utils.rerender(tree(sync));
      });
    },
    unmount() {
      act(() => {
        utils.unmount();
      });
    },
    get current() {
      return seen[seen.length - 1];
    },
  };
}

const syncPosition = vi.fn<() => Promise<void>>();
const adapter = (currentSfen: string | null, syncedSfen: string | null): PositionSyncAdapter => ({
  currentSfen,
  syncedSfen,
  syncPosition,
});

/**
 * **上限を実時計で待たない。** 現物の `positionSyncTimeoutMs` を跨ぐ待ち方をすると、並走する機械では
 * コードを触っていないコミットがランダムに落ちる。寸法は4つとも**同じ比**で縮むので、
 * 大小の順序（刻み < 間引き < 猶予 < 上限）は現物と同じ。比は `waits.ts` が持つ。
 */
let restoreWaits: () => void = () => {};
beforeEach(() => {
  restoreWaits = shortenWaits();
});
afterEach(() => {
  restoreWaits();
});

beforeEach(() => {
  tauri = false;
  listeners = null;
  startCore.mockReset();
  stopCore.mockReset();
  syncPosition.mockReset();
  startCore.mockResolvedValue("session-1");
  stopCore.mockResolvedValue(undefined);
  syncPosition.mockResolvedValue(undefined);
  engine = { isReady: true, notReadyReason: null };
  listenerSetupFails = false;
});

// **畳まないまま次のテストへ渡さない。** 自動 cleanup は入っていない
// （`vite.config.ts` の test に setup ファイルが無い）ので、`unmount()` を
// 呼ばずに終わったテストの画面は生きたまま残る。残ると同期待ちの打ち切りが
// 上限の後に停止を撃ち、**それが後のテストの中に落ちる**——「畳んだ後は撃たない」
// を見ている検査が、他のテストの置き土産で赤くなる。
afterEach(cleanup);

describe("AnalysisProvider の同期待ちの打ち切り", () => {
  it(
    "打ち切ったらエンジンのセッションも止める",
    async () => {
      const view = mountAnalysis(adapter("P1", "P1"));

      await act(async () => {
        await view.current.startInfiniteAnalysis();
      });
      expect(view.current.state.isAnalyzing).toBe(true);

      // 盤だけ進め、エンジンへの同期は追従させない
      await view.setSync(adapter("P2", "P1"));
      stopCore.mockClear();

      await advance(700);

      expect(view.current.state.error).toBe(POSITION_SYNC_TIMEOUT_MESSAGE);
      expect(view.current.state.isAnalyzing).toBe(false);

      // エラーを出すだけでは足りない。Rust 側のセッションを止めないと
      // 以降の start_infinite_analysis が「Analysis already running」で永久に弾かれる。
      expect(stopCore).toHaveBeenCalled();
    },
    SLOW,
  );

  it(
    "席を握っていないときは、打ち切りで停止を撃たない",
    async () => {
      startCore.mockResolvedValueOnce("session-1");
      startCore.mockImplementation(() => new Promise<string>(() => {}));

      const view = mountAnalysis(adapter("P1", "P1"));
      await act(async () => {
        await view.current.startInfiniteAnalysis();
      });

      // 1手進む。再開は前の席を返し終え、**新しい席の応答待ち**で止まる。
      // ここで席の欄は空。
      await view.setSync(adapter("P2", "P2"));
      await advance(150);

      stopCore.mockClear();

      // もう1手進み、エンジンが追いつかないまま打ち切られる。
      await view.setSync(adapter("P3", "P2"));
      await advance(700);
      expect(view.current.state.error).toBe(POSITION_SYNC_TIMEOUT_MESSAGE);

      // `releaseHeldQuietly` は席を握っていなければ何も撃たない。
      expect(stopCore).not.toHaveBeenCalled();
    },
    SLOW,
  );

  it(
    "前回の待ちの経過時間を次の待ちに持ち越さない",
    async () => {
      const view = mountAnalysis(adapter("P1", "P1"));

      await act(async () => {
        await view.current.startInfiniteAnalysis();
      });

      // 追従しないまま待たせ、打ち切りの手前で止める
      await view.setSync(adapter("P2", "P1"));
      await advance(limitMs() * 0.3);
      await act(async () => {
        await view.current.stopAnalysis();
      });

      // **この空白がこのテストの検出源。** 停止中に上限を越える時間が経つので、
      // 前回の待ちの開始時刻を持ち越すと、次の待ちは1ミリ秒も待たずに打ち切られる。
      // **縮めると検査でなくなる**——縮めても下の2つだけでは上限に届かない。
      await advance(limitMs() * 1.4);
      await view.setSync(adapter("P2", "P2"));
      await act(async () => {
        await view.current.startInfiniteAnalysis();
      });
      expect(view.current.state.isAnalyzing).toBe(true);

      // 1手進める。ここで待ちが始まるので、経過時間はゼロから数え直されなければならない。
      await view.setSync(adapter("P3", "P2"));
      await advance(limitMs() * 0.12);

      expect(view.current.state.error).toBeNull();
      expect(view.current.state.isAnalyzing).toBe(true);
    },
    SLOW,
  );
});

describe("AnalysisProvider の停止", () => {
  it("開始の応答待ちで止めたら、後から返ってきた席を返して始めない", async () => {
    let releaseStart: (sessionId: string) => void = () => {};
    startCore.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          releaseStart = resolve;
        }),
    );

    const view = mountAnalysis(adapter("P1", "P1"));

    // ▶ の応答待ちのまま置く（返ってこないので await しない）
    void view.current.startInfiniteAnalysis();
    await advance(50);

    // ここで ■ を押す。席はまだ手元に無いので、停止は Rust に何も撃てない。
    await act(async () => {
      await view.current.stopAnalysis();
    });

    stopCore.mockClear();
    await act(async () => {
      releaseStart("session-late");
    });
    await advance(50);

    // 世代を見ないと、押した停止が握り潰されて解析が始まる。
    expect(view.current.state.isAnalyzing).toBe(false);
    expect(stopCore).toHaveBeenCalledWith("session-late", "late-start");
  });

  it("同期待ちの間に止めたら、go を出さない", async () => {
    // 盤の局面をエンジンへ送れないまま ▶ を押した状態。`waitUntil` が回る。
    const view = mountAnalysis(adapter("P1", null));

    void view.current.startInfiniteAnalysis().catch(() => {});
    await advance(50);
    expect(startCore).not.toHaveBeenCalled();

    await act(async () => {
      await view.current.stopAnalysis();
    });

    // 待ちが解けても、要らなくなった要求なので go は出さない。
    await view.setSync(adapter("P1", "P1"));
    await advance(100);

    expect(startCore).not.toHaveBeenCalled();
    expect(view.current.state.isAnalyzing).toBe(false);

    // 止めた後に「送れませんでした」を出さない。利用者はもう待っていない。
    expect(view.current.state.error).toBeNull();
  });

  it(
    "打ち切りのエラーを、後から返ってきた再開が消さない",
    async () => {
      const pendingStops: Array<() => void> = [];
      stopCore.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            pendingStops.push(resolve);
          }),
      );

      const view = mountAnalysis(adapter("P1", "P1"));
      await act(async () => {
        await view.current.startInfiniteAnalysis();
      });

      // 1手進む。再開は「前の席を返す」ところで止まる。
      await view.setSync(adapter("P2", "P2"));
      await advance(150);
      expect(pendingStops).toHaveLength(1);

      // もう1手進むが、エンジンは追いつかない。同期待ちが上限で打ち切られる。
      await view.setSync(adapter("P3", "P2"));
      await advance(700);
      expect(view.current.state.error).toBe(POSITION_SYNC_TIMEOUT_MESSAGE);

      // 止まっていた再開が動き出す。`clear_results` は `error` も消すので、
      // 門より前に置くと、利用者に出したばかりの断りが黙って消える。
      await act(async () => {
        pendingStops[0]();
      });
      await advance(100);

      expect(view.current.state.error).toBe(POSITION_SYNC_TIMEOUT_MESSAGE);
    },
    SLOW,
  );

  it("再開の最中に止めたら、後から返ってきた席を返して再開しない", async () => {
    let releaseStart: (sessionId: string) => void = () => {};
    startCore.mockResolvedValueOnce("session-1");
    startCore.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          releaseStart = resolve;
        }),
    );

    const view = mountAnalysis(adapter("P1", "P1"));
    await act(async () => {
      await view.current.startInfiniteAnalysis();
    });

    // 盤とエンジンが揃って1手進む。再開が走り、開始の応答待ちで止まる。
    await view.setSync(adapter("P2", "P2"));
    await advance(150);

    await act(async () => {
      await view.current.stopAnalysis();
    });
    expect(view.current.state.isAnalyzing).toBe(false);

    stopCore.mockClear();
    await act(async () => {
      releaseStart("session-2");
    });
    await advance(50);

    // 世代を見ないと、止めたのに「解析中」へ戻り、Rust では新しい席が走り続ける。
    // 停止ボタンが撃てるのはその時点で握っている古い席までで、この席はここでしか返せない。
    expect(view.current.state.isAnalyzing).toBe(false);
    expect(stopCore).toHaveBeenCalledWith("session-2", "late-restart");
  });
});

describe("AnalysisProvider の結果の照合", () => {
  it("結果の購読に失敗したら、断りを立てる", async () => {
    tauri = true;
    listenerSetupFails = true;

    const view = mountAnalysis(adapter("P1", "P1"));
    await advance(50);
    listenerSetupFails = false;

    // 張り直す口が無いので、断らないと「解析中・候補手0」で永久に固まる。
    expect(view.current.state.error).toBe(LISTENERS_FAILED_MESSAGE);

    // **▶ を押しても `go` を出さない。** 出すと `clear_results` が断りを消し、
    // 「解析中・候補手0・断りも無し」になって唯一の案内が画面から消える。
    await act(async () => {
      await view.current.startInfiniteAnalysis().catch(() => {});
    });
    expect(startCore).not.toHaveBeenCalled();
    expect(view.current.state.error).toBe(LISTENERS_FAILED_MESSAGE);
  });

  it("再開した席で届いた info を、前の席と照らして落とさない", async () => {
    tauri = true;
    let releaseStart: (sessionId: string) => void = () => {};
    startCore.mockResolvedValueOnce("session-1");
    startCore.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          releaseStart = resolve;
        }),
    );

    const view = mountAnalysis(adapter("P1", "P1"));
    await act(async () => {
      await view.current.startInfiniteAnalysis();
    });

    // 盤とエンジンが揃って1手進む。再開が走り、開始の応答待ちで止まる。
    await view.setSync(adapter("P2", "P2"));
    await advance(150);

    // **席を欄に入れるより前**に最初の `info` が届く。Rust は席を作った時点で
    // 配り始めるので、応答が返るより早く着くことがある。
    await act(async () => {
      releaseStart("session-2");
      listeners?.onUpdate("session-2", oneCandidate);
    });
    await advance(150);

    expect(view.current.state.candidates).toHaveLength(1);
  });

  it("席を続けて2つ手放しても、古い方の info を採らない", async () => {
    tauri = true;
    startCore.mockResolvedValueOnce("session-1");

    const view = mountAnalysis(adapter("P1", "P1"));
    await act(async () => {
      await view.current.startInfiniteAnalysis();
    });

    // 1手進める。再開が `session-1` を返し（1つ目の手放し）、開始の応答待ちで止まる。
    let releaseStart: (sessionId: string) => void = () => {};
    startCore.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          releaseStart = resolve;
        }),
    );
    await view.setSync(adapter("P2", "P2"));
    await advance(150);

    // もう1手進めて世代を上げ、返ってきた席を捨てさせる（2つ目の手放し）。
    // 張り直される再開は応答が返らないので、席の欄は空のまま。
    startCore.mockImplementation(() => new Promise<string>(() => {}));
    await view.setSync(adapter("P3", "P3"));
    await advance(150);
    await act(async () => {
      releaseStart("session-2");
    });
    await advance(150);

    // ここで `session-1` の遅れた `info` が届く。覚えているのが1枠だと、
    // `session-2` に上書きされていて `session-1` が通る。
    await act(async () => {
      listeners?.onUpdate("session-1", oneCandidate);
    });
    await advance(150);

    expect(view.current.state.candidates).toHaveLength(0);
  });

  it(
    "▶ の応答待ちにエンジンが落ちたら、その席を握らない",
    async () => {
      let releaseStart: (sessionId: string) => void = () => {};
      startCore.mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            releaseStart = resolve;
          }),
      );

      const view = mountAnalysis(adapter("P1", "P1"));
      const pressed = view.current.startInfiniteAnalysis().catch(() => {});
      await advance(50);

      // 席の往復の最中に、断りが案内している操作（オプションを変えて保存）をする。
      engine = { isReady: false, notReadyReason: "starting" };
      await view.setSync(adapter("P1", null));
      await advance(50);

      // 席が返ってくる。Rust は畳む前に席を全部空けるので、この席は死んでいる。
      await act(async () => {
        releaseStart("s1");
      });
      await pressed;
      await advance(50);

      // 握ると「解析中の表示のまま数字が動かない」に落ちる。**撃たずに捨てる**
      // ——席が空の回の停止は、起こし直したエンジンへ裸の `stop` を書く。
      expect(view.current.state.isAnalyzing).toBe(false);
      expect(stopCore).not.toHaveBeenCalled();

      // **黙らない。** 押した人はまだ画面の前に居る。断りが無いと、停止中の
      // ペインが控えを出すので**押す前と1ドットも変わらない**。
      // まだ戻っていないので、案内は起動待ちのほう（押し直しても効かない）。
      expect(view.current.state.error).toBe(ENGINE_STARTING_MESSAGE);

      // 戻ってきたら ▶ で始められる。
      engine = { isReady: true, notReadyReason: null };
      await view.setSync(adapter("P1", "P1"));
      startCore.mockResolvedValue("s2");
      await act(async () => {
        await view.current.startInfiniteAnalysis();
      });
      expect(view.current.state.isAnalyzing).toBe(true);
    },
    SLOW,
  );

  it("同期待ちの最中にエンジンが落ちたら、その理由で断る", async () => {
    const view = mountAnalysis(adapter("P1", "P1"));

    // 送信は通るが、エンジンは追いつかない（起こし直しの最中）。
    await view.setSync(adapter("P2", "P1"));
    const startedAt = Date.now();
    const pressed = view.current.startInfiniteAnalysis().catch(() => {});
    await advance(50);
    engine = { isReady: false, notReadyReason: "starting" };
    await view.setSync(adapter("P2", "P1"));
    await pressed;
    const elapsed = Date.now() - startedAt;
    await advance(50);

    // **上限まで待たせない。** 待っても追いつかないし、待った末に告げる理由
    // （同期が遅い＝押し直し）はここでは効かない。
    expect(elapsed).toBeLessThan(limitMs() / 2);
    expect(view.current.state.error).toBe(ENGINE_STARTING_MESSAGE);
    expect(startCore).not.toHaveBeenCalled();
  });

  it(
    "解析中にエンジンを起こし直したら、戻ったときに読み直す",
    async () => {
      const view = mountAnalysis(adapter("P1", "P1"));
      await act(async () => {
        await view.current.startInfiniteAnalysis();
      });
      expect(startCore).toHaveBeenCalledTimes(1);

      // 設定でエンジンのオプションを変えて保存した回。**この画面の断りが案内している操作。**
      // Rust は畳む前に席を全部空けるので、こちらが握っている席はもう無い。
      engine = { isReady: false, notReadyReason: "starting" };
      await view.setSync(adapter("P1", null));
      await advance(50);

      // 戻ってくる。投げ済みの印を捨てていないと、**「解析中」の表示のまま数字が
      // 一切動かない**（席は死んだまま握られ、断りも出ない）。
      engine = { isReady: true, notReadyReason: null };
      await view.setSync(adapter("P1", "P1"));
      await advance(300);

      expect(startCore).toHaveBeenCalledTimes(2);
      expect(view.current.state.isAnalyzing).toBe(true);
      // もう無い席へ停止は撃たない（→ `analysis.md` の ※13）。
      expect(stopCore).not.toHaveBeenCalled();
    },
    SLOW,
  );

  it(
    "エンジンを2回続けて起こし直しても、戻ったときに読み直す",
    async () => {
      let releaseStart: (sessionId: string) => void = () => {};

      const view = mountAnalysis(adapter("P1", "P1"));
      await act(async () => {
        await view.current.startInfiniteAnalysis();
      });
      expect(startCore).toHaveBeenCalledTimes(1);

      // 1回目。戻ったところで再開が飛び、その席はまだ返ってこない。
      engine = { isReady: false, notReadyReason: "starting" };
      await view.setSync(adapter("P1", null));
      await advance(50);

      startCore.mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            releaseStart = resolve;
          }),
      );
      engine = { isReady: true, notReadyReason: null };
      await view.setSync(adapter("P1", "P1"));
      await advance(150);
      expect(startCore).toHaveBeenCalledTimes(2);

      // 2回目。**飛んでいる再開の最中**に落ちて戻る。
      engine = { isReady: false, notReadyReason: "starting" };
      await view.setSync(adapter("P1", null));
      await advance(50);
      engine = { isReady: true, notReadyReason: null };
      await view.setSync(adapter("P1", "P1"));
      await advance(50);

      // 飛んでいた席が**最後に**着地する。死んでいるので捨てられ、この経路には
      // 再開を張り直す者が居ない——予約しないと、盤を動かすまで何も起きない。
      await act(async () => {
        releaseStart("dead");
      });
      await advance(300);

      expect(startCore).toHaveBeenCalledTimes(3);
      expect(view.current.state.isAnalyzing).toBe(true);
      expect(view.current.state.error).toBeNull();
    },
    SLOW,
  );

  // **席が返る回と、Rust が断る回は同じ窓に居る。** 畳んでいる最中のエンジンへの
  // 開始は `Err` で返るので、起こし直しの窓は断られるほうが起きやすい。
  it(
    "起こし直しの最中に自動再開が断られても、解析は止まらず戻ったら読み直す",
    async () => {
      const view = mountAnalysis(adapter("P1", "P1"));
      await act(async () => {
        await view.current.startInfiniteAnalysis();
      });

      // 盤が動いて自動再開が走り、その開始が応答を返さないまま止まる。
      let rejectStart: (e: unknown) => void = () => {};
      startCore.mockImplementationOnce(
        () =>
          new Promise<string>((_resolve, reject) => {
            rejectStart = reject;
          }),
      );
      await view.setSync(adapter("P2", "P2"));
      await advance(200);
      expect(startCore).toHaveBeenCalledTimes(2);

      // 往復の最中に、断りが案内している操作（オプションを変えて保存）をする。
      engine = { isReady: false, notReadyReason: "starting" };
      await view.setSync(adapter("P2", null));
      await advance(50);

      // 畳んでいる最中のエンジンは開始を `Err` で返す。
      await act(async () => {
        rejectStart(new Error("engine is shutting down"));
      });
      await advance(50);

      // **止めない。** 止めると `isAnalyzing` が倒れ、戻っても門で降りる
      // ——盤を動かしても解析が返らない。
      expect(view.current.state.isAnalyzing).toBe(true);
      expect(view.current.state.error).toBeNull();

      engine = { isReady: true, notReadyReason: null };
      await view.setSync(adapter("P2", "P2"));
      await advance(300);

      expect(startCore).toHaveBeenCalledTimes(3);
      expect(view.current.state.isAnalyzing).toBe(true);
    },
    SLOW,
  );

  it("起こし直しの最中に ▶ が断られたら、起こし直しの断りを出す", async () => {
    let rejectStart: (e: unknown) => void = () => {};
    startCore.mockImplementationOnce(
      () =>
        new Promise<string>((_resolve, reject) => {
          rejectStart = reject;
        }),
    );

    const view = mountAnalysis(adapter("P1", "P1"));
    const pressed = view.current.startInfiniteAnalysis().catch(() => {});
    await advance(50);

    engine = { isReady: false, notReadyReason: "starting" };
    await view.setSync(adapter("P1", null));
    await advance(50);

    await act(async () => {
      rejectStart(new Error("engine is shutting down"));
    });
    await pressed;
    await advance(50);

    // **「起こし直してください」と言わない**——利用者がいま済ませた操作。
    // まだ戻っていないので起動待ちの案内になる。
    expect(view.current.state.error).toBe(ENGINE_STARTING_MESSAGE);
    expect(view.current.state.error).not.toBe(START_REFUSED_MESSAGE);
  });

  it("席が着く前にエンジンが戻っていたら、押し直しを案内する", async () => {
    let releaseStart: (sessionId: string) => void = () => {};
    startCore.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          releaseStart = resolve;
        }),
    );

    const view = mountAnalysis(adapter("P1", "P1"));
    const pressed = view.current.startInfiniteAnalysis().catch(() => {});
    await advance(50);

    // 落ちて、席が着く前に戻る。
    engine = { isReady: false, notReadyReason: "starting" };
    await view.setSync(adapter("P1", null));
    await advance(50);
    engine = { isReady: true, notReadyReason: null };
    await view.setSync(adapter("P1", "P1"));
    await advance(50);

    await act(async () => {
      releaseStart("dead");
    });
    await pressed;
    await advance(50);

    // **この回だけ「もう一度 ▶」が実際に効く。**
    expect(view.current.state.error).toBe(ENGINE_RESTARTED_MESSAGE);
  });

  it("棋譜を閉じた後に席が着地したら、断りを立てない", async () => {
    let releaseStart: (sessionId: string) => void = () => {};
    startCore.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          releaseStart = resolve;
        }),
    );

    const view = mountAnalysis(adapter("P1", "P1"));
    const pressed = view.current.startInfiniteAnalysis().catch(() => {});
    await advance(50);

    // 棋譜を閉じ、そのうえでエンジンが消える。`landed` はエンジンを先に見るので
    // `"engine-gone"` が返るが、出す先の画面はもう無い。
    await view.setSync(adapter(null, null));
    engine = { isReady: false, notReadyReason: "starting" };
    await view.setSync(adapter(null, null));
    await act(async () => {
      releaseStart("late");
    });
    await pressed;
    await advance(50);

    expect(view.current.state.error).toBeNull();
  });

  it(
    "盤を1手進めてすぐ戻したら、戻した局面を読み直す",
    async () => {
      tauri = true;
      startCore.mockResolvedValueOnce("s1");

      const view = mountAnalysis(adapter("P1", "P1"));
      await act(async () => {
        await view.current.startInfiniteAnalysis();
      });
      expect(view.current.state.analyzedSfen).toBe("P1");

      // 1手進めて、再開が飛んでいる最中に戻す（棋譜で → のあと ←）。
      let releaseRestart: (sessionId: string) => void = () => {};
      startCore.mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            releaseRestart = resolve;
          }),
      );
      await view.setSync(adapter("P2", "P2"));
      await advance(150);
      await view.setSync(adapter("P1", "P1"));

      startCore.mockResolvedValue("s3");
      await act(async () => {
        releaseRestart("s2");
      });
      await advance(300);

      // 読ませたい局面を門の後ろに書くと、盤は P1・エンジンは P2 のまま止まり、
      // **P2 基準の読み筋と評価値が P1 の盤の下に出続ける**（表示は「解析中」、断りも無い）。
      expect(view.current.state.analyzedSfen).toBe("P1");
      expect(view.current.state.isAnalyzing).toBe(true);
      expect(view.current.state.error).toBeNull();
    },
    SLOW,
  );

  it("捨てた席の反映待ちを、いまの局面の結果として出さない", async () => {
    tauri = true;
    startCore.mockResolvedValueOnce("s1");

    const view = mountAnalysis(adapter("P1", "P1"));
    await act(async () => {
      await view.current.startInfiniteAnalysis();
    });

    // 1手進む。再開が `s1` を返し、次の席の応答待ちで止まる。
    let releaseStart: (sessionId: string) => void = () => {};
    startCore.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          releaseStart = resolve;
        }),
    );
    await view.setSync(adapter("P2", "P2"));
    await advance(150);

    // もう1手進む。**エンジンはまだ追いついていない**ので、次の再開は同期待ちで止まり、
    // 画面の候補手を捨てる口を通らない。
    await view.setSync(adapter("P3", "P2"));
    await advance(150);

    // 応答待ちの窓で `s2` の最初の `info` が届く（席が欄に入るより早いので通る）。
    // 間引きのタイマーが起きる前に応答が返り、その席は捨てられる。
    await act(async () => {
      listeners?.onUpdate("s2", oneCandidate);
      releaseStart("s2");
    });
    await advance(150);

    // 捨てた席の反映待ちを残すと、**P2 の評価値と読み筋が、盤が P3 を映したまま
    // 解析結果として出る**（盤がその局面へ戻るとペインのキャッシュにも焼き付く）。
    expect(view.current.state.candidates).toHaveLength(0);
  });

  // **席が返ってきて捨てる回と、Rust に断られる回は同じ窓に居る。** 後始末が枝で割れると、
  // 断られた側だけが反映待ちを落とし忘れる。
  it("開始が断られた回も、反映待ちを残さない", async () => {
    tauri = true;
    startCore.mockResolvedValueOnce("s1");

    const view = mountAnalysis(adapter("P1", "P1"));
    await act(async () => {
      await view.current.startInfiniteAnalysis();
    });

    // 盤が動いて再開が走り、その開始が応答を返さないまま止まる。
    let rejectStart: (e: unknown) => void = () => {};
    startCore.mockImplementationOnce(
      () =>
        new Promise<string>((_resolve, reject) => {
          rejectStart = reject;
        }),
    );
    await view.setSync(adapter("P2", "P2"));
    await advance(150);

    // 席が欄に入る前に `info` が1本届く（`accepts` は欄が空の間どの席も通す）。
    // そのあとエンジンが消え、開始は `Err` で返る。
    await act(async () => {
      listeners?.onUpdate("s2", oneCandidate);
    });
    engine = { isReady: false, notReadyReason: "starting" };
    await view.setSync(adapter("P2", null));
    await advance(50);
    await act(async () => {
      rejectStart(new Error("engine is shutting down"));
    });
    await advance(150);

    // 残すと、死んだエンジンの読み筋が「解析中」の表示のまま commit される
    // （この枝は `stop_analysis` を dispatch しないので `isAnalyzing` は true のまま）。
    expect(view.current.state.candidates).toHaveLength(0);
  });

  // **間引きの1周期を跨がせる。** 枠を落とす形の後始末は、落とす前に
  // タイマーが起きた回を守れない——着地が遅い回だけが素通りする。
  it("席が着くのが間引きより遅くても、捨てた席の結果は出さない", async () => {
    tauri = true;
    startCore.mockResolvedValueOnce("s1");

    const view = mountAnalysis(adapter("P1", "P1"));
    await act(async () => {
      await view.current.startInfiniteAnalysis();
    });

    let rejectStart: (e: unknown) => void = () => {};
    startCore.mockImplementationOnce(
      () =>
        new Promise<string>((_resolve, reject) => {
          rejectStart = reject;
        }),
    );
    await view.setSync(adapter("P2", "P2"));
    await advance(150);

    // 席が欄に入る前に `info` が1本届く（`accepts` は欄が空の間どの席も通す）。
    await act(async () => {
      listeners?.onUpdate("s2", oneCandidate);
    });

    // **間引きより長く待つ。** ここでタイマーが起きる。
    engine = { isReady: false, notReadyReason: "starting" };
    await view.setSync(adapter("P2", null));
    await advance(flushMs() * 6);

    await act(async () => {
      rejectStart(new Error("engine is shutting down"));
    });
    await advance(150);

    expect(view.current.state.candidates).toHaveLength(0);
  });

  it("同期が先に追いついても、猶予より早く取り直さない", async () => {
    startCore.mockResolvedValueOnce("s1");
    const view = mountAnalysis(adapter("P1", "P1"));
    await act(async () => {
      await view.current.startInfiniteAnalysis();
    });

    // 盤と同期が同じ描画で動く。追従の effect は猶予を張った直後に、
    // 同じ再開を 0ms で張り直しに来る——`scheduleRestart` は先頭でタイマーを
    // 消すので、止めないと**猶予そのものが消える**。
    stopCore.mockClear();
    await view.setSync(adapter("P2", "P2"));

    await advance(waits().restartDebounceMs / 5);
    expect(stopCore).not.toHaveBeenCalled();

    await advance(waits().restartDebounceMs * 4);
    expect(stopCore).toHaveBeenCalledWith("s1", "restart");
  });

  it("捨てる停止が落ちて席が欄へ戻っても、その席の結果は出さない", async () => {
    tauri = true;
    startCore.mockResolvedValueOnce("s1");

    // 捨てる停止**だけ**を落とす。再開のための返却は通す——通さないと `isAnalyzing` が
    // 倒れ、`commitLatest` の `analyzing` の門が先に止めてしまい、席の門を見られない。
    stopCore.mockImplementation((_sessionId, by) =>
      by === "late-restart" ? Promise.reject(new Error("ipc lost")) : Promise.resolve(),
    );

    const view = mountAnalysis(adapter("P1", "P1"));
    await act(async () => {
      await view.current.startInfiniteAnalysis();
    });

    // 自動再開の開始を待たせ、その間にもう1手進めて世代を上げる。
    let releaseStart: (sessionId: string) => void = () => {};
    startCore.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          releaseStart = resolve;
        }),
    );
    await view.setSync(adapter("P2", "P2"));
    await advance(150);
    await view.setSync(adapter("P3", "P2"));
    await advance(150);

    // 席が欄に入る前に `info` が1本届き（`accepts` は欄が空の間どの席も通す）、
    // 直後に追い越された席が着く。捨てる停止は落ち、`keepOrForget` が欄へ書き戻す。
    await act(async () => {
      listeners?.onUpdate("s2", oneCandidate);
      releaseStart("s2");
    });
    await advance(150);

    // 書き戻しで席の門は開くが、反映待ちはその手前で落ちている。
    expect(view.current.state.candidates).toHaveLength(0);
  });

  it("捨てる停止の応答を待っている間も、その席の info は採らない", async () => {
    tauri = true;
    startCore.mockResolvedValueOnce("session-1");

    const view = mountAnalysis(adapter("P1", "P1"));
    await act(async () => {
      await view.current.startInfiniteAnalysis();
    });

    // 再開の開始を待たせ、その間にもう1手進めて世代を上げる。
    let releaseStart: (sessionId: string) => void = () => {};
    startCore.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          releaseStart = resolve;
        }),
    );
    await view.setSync(adapter("P2", "P2"));
    await advance(150);
    await view.setSync(adapter("P3", "P3"));
    await advance(150);

    // 追い越された席が返る。捨てる停止は応答待ちのまま。
    stopCore.mockImplementation(() => new Promise<void>(() => {}));
    await act(async () => {
      releaseStart("session-2");
    });
    await advance(50);

    // その席はまだ Rust で読んでいるので `info` を配ってくる。
    await act(async () => {
      listeners?.onUpdate("session-2", oneCandidate);
    });
    await advance(150);

    // 採ると、前の局面の評価値と読み筋が現在の盤面の解析結果として出る。
    expect(view.current.state.candidates).toHaveLength(0);
  });

  it("席を握り直した後でも、その前に手放した席の info は採らない", async () => {
    tauri = true;
    startCore.mockResolvedValueOnce("session-1");
    startCore.mockResolvedValueOnce("session-2");
    startCore.mockImplementation(() => new Promise<string>(() => {}));

    const view = mountAnalysis(adapter("P1", "P1"));
    await act(async () => {
      await view.current.startInfiniteAnalysis();
    });

    // 1手進む。`session-1` を返し、`session-2` を**握る**。
    await view.setSync(adapter("P2", "P2"));
    await advance(150);

    // もう1手進む。`session-2` も返し、次の席は応答が返らない＝欄は空。
    await view.setSync(adapter("P3", "P3"));
    await advance(150);

    // 盤を1手ずつ動かすだけの、いちばん普通の経路。ここで `session-1` の
    // 遅れた `info` が届く。席を握った時点で「採らない」を空にしていると、
    // P1 の評価値と読み筋が、P3 を映した盤の解析結果として出る。
    await act(async () => {
      listeners?.onUpdate("session-1", oneCandidate);
    });
    await advance(150);

    expect(view.current.state.candidates).toHaveLength(0);
  });

  it("捨てた席を握り直しても、その席の info は採らない", async () => {
    tauri = true;
    startCore.mockResolvedValueOnce("session-1");

    const view = mountAnalysis(adapter("P1", "P1"));
    await act(async () => {
      await view.current.startInfiniteAnalysis();
    });

    // 再開の開始を待たせ、その間にもう1手進めて世代を上げる。
    let releaseStart: (sessionId: string) => void = () => {};
    startCore.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          releaseStart = resolve;
        }),
    );
    await view.setSync(adapter("P2", "P2"));
    await advance(150);
    startCore.mockImplementation(() => new Promise<string>(() => {}));
    await view.setSync(adapter("P3", "P3"));
    await advance(150);

    // 追い越された席を捨てにいくが、停止が落ちる。席の欄が空なので握り直される
    // ——Rust にまだ居るなら、畳まれたときに返しにいけるように。
    // 握り直した席を返す次の停止は応答が返らない＝席を握ったままにする。
    stopCore.mockImplementation(() => new Promise<void>(() => {}));
    stopCore.mockRejectedValueOnce(new Error("stop failed"));
    await act(async () => {
      releaseStart("session-2");
    });
    await advance(150);

    // 握り直しても、捨てると決めた事実は消えない。席の照合を先に見ると、
    // 捨てた席が「自分の席」に昇格して `info` が通る。
    await act(async () => {
      listeners?.onUpdate("session-2", oneCandidate);
    });
    await advance(150);

    expect(view.current.state.candidates).toHaveLength(0);
  });

  it("返したばかりの席で届いた info は採らない", async () => {
    tauri = true;
    startCore.mockResolvedValueOnce("session-1");
    startCore.mockImplementation(() => new Promise<string>(() => {}));

    const view = mountAnalysis(adapter("P1", "P1"));
    await act(async () => {
      await view.current.startInfiniteAnalysis();
    });

    // 1手進む。再開は `session-1` を返し終え、新しい席の応答待ちで止まる。
    // この間、席の欄は空。
    await view.setSync(adapter("P2", "P2"));
    await advance(150);

    // 止めたばかりの `session-1` の `info` が遅れて届く。
    await act(async () => {
      listeners?.onUpdate("session-1", oneCandidate);
    });
    await advance(150);

    // 採ると、前の局面の評価値と読み筋が新しい局面の解析結果として盤に出る。
    expect(view.current.state.candidates).toHaveLength(0);
  });
});

describe("AnalysisProvider の開始", () => {
  it("応答待ちの間に押し直しても、開始は1本にする", async () => {
    let releaseStart: (sessionId: string) => void = () => {};
    startCore.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          releaseStart = resolve;
        }),
    );

    const view = mountAnalysis(adapter("P1", "P1"));

    void view.current.startInfiniteAnalysis();
    await advance(50);
    void view.current.startInfiniteAnalysis();
    await advance(50);

    // 2本目は Rust の `take_session` に断られ、その断りは画面に出ない。
    expect(startCore).toHaveBeenCalledTimes(1);

    await act(async () => {
      releaseStart("session-1");
    });
    expect(view.current.state.isAnalyzing).toBe(true);
  });

  it(
    "▶ が席を返している間に局面が無くなったら、始めない",
    async () => {
      const view = mountAnalysis(adapter("P1", "P1"));
      await act(async () => {
        await view.current.startInfiniteAnalysis();
      });

      // 停止が届かず、席を握ったまま「停止中」になる。
      stopCore.mockRejectedValueOnce(new Error("ipc is gone"));
      await act(async () => {
        await view.current.stopAnalysis().catch(() => {});
      });

      // ▶ を押す。席を返す往復の最中に棋譜を閉じる。
      let releaseStop: () => void = () => {};
      stopCore.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            releaseStop = resolve;
          }),
      );
      startCore.mockClear();
      void view.current.startInfiniteAnalysis().catch(() => {});
      await advance(50);

      await view.setSync(adapter(null, null));
      await act(async () => {
        releaseStop();
      });

      // 同期待ちの上限を越えるまで進める（テスト中は縮めた寸法。値は `waits.ts`）。
      // 世代を返却より前に読まないと、ここまで待ってから閉じた棋譜のために断りを積む。
      await advance(limitMs() * 1.4);

      expect(startCore).not.toHaveBeenCalled();
      // 立っているのは届かなかった ■ の断りだけ。閉じた棋譜のぶんは積まれない。
      expect(view.current.state.error).toBe(STOP_FAILED_MESSAGE);
    },
    SLOW,
  );

  it("再開の返却が飛んでいる間に止めても、席への停止は1本にする", async () => {
    const pendingStops: Array<() => void> = [];
    const view = mountAnalysis(adapter("P1", "P1"));
    await act(async () => {
      await view.current.startInfiniteAnalysis();
    });

    stopCore.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          pendingStops.push(resolve);
        }),
    );

    // 1手進む。再開が席を返しにいって止まる。
    await view.setSync(adapter("P2", "P2"));
    await advance(150);
    expect(pendingStops).toHaveLength(1);

    // その最中に ■ を押す。停止も同じ席を返そうとする。
    void view.current.stopAnalysis().catch(() => {});
    await advance(50);

    // 相乗りしないと同じ席へ2本飛び、順序も結末も保証できない。
    expect(pendingStops).toHaveLength(1);
  });

  it(
    "飛んでいる返却が落ちたら、▶ は席を握ったまま go を出さない",
    async () => {
      const view = mountAnalysis(adapter("P1", "P1"));
      await act(async () => {
        await view.current.startInfiniteAnalysis();
      });

      // 同期待ちの打ち切りが席を返しにいく。その応答はまだ来ない。
      let failRelease: (e: Error) => void = () => {};
      stopCore.mockImplementationOnce(
        () =>
          new Promise<void>((_, reject) => {
            failRelease = reject;
          }),
      );
      await view.setSync(adapter("P2", "P1"));
      await advance(700);
      expect(view.current.state.isAnalyzing).toBe(false);

      // 盤とエンジンを揃えておく（同期待ちで止まらないように）。
      await view.setSync(adapter("P2", "P2"));
      startCore.mockClear();
      stopCore.mockClear();

      // その最中に ▶。返却の結末を見ずに相乗りすると、**席を返さないまま** go を出す。
      void view.current.startInfiniteAnalysis().catch(() => {});
      await advance(50);
      await act(async () => {
        failRelease(new Error("ipc is gone"));
      });
      await advance(150);

      expect(stopCore).toHaveBeenCalledWith("session-1", "start");
    },
    SLOW,
  );

  it("押した後に盤が動いたら、動いた先の局面で始める", async () => {
    const view = mountAnalysis(adapter("P1", null));

    void view.current.startInfiniteAnalysis().catch(() => {});
    await advance(50);
    expect(startCore).not.toHaveBeenCalled();

    // 押した局面には追いつかないまま、盤が進んでエンジンもそこへ追いつく。
    await view.setSync(adapter("P2", "P2"));
    await advance(150);

    // 押した瞬間の局面を待ち続けると、上限の後に何も失敗していないのに断りを積む。
    expect(startCore).toHaveBeenCalled();
    expect(view.current.state.analyzedSfen).toBe("P2");
    expect(view.current.state.error).toBeNull();
  });

  it("開始の応答より早く届いた info を、応答の後に出す", async () => {
    tauri = true;
    let releaseStart: (sessionId: string) => void = () => {};
    startCore.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          releaseStart = resolve;
        }),
    );

    const view = mountAnalysis(adapter("P1", "P1"));
    const pressed = act(async () => {
      await view.current.startInfiniteAnalysis().catch(() => {});
    });

    // 席が欄に入る前に最初の `info` が届く。Rust は席を作った時点で配り始める。
    await advance(50);
    await act(async () => {
      listeners?.onUpdate("session-1", oneCandidate);
    });

    // 間引きのタイマーが、開始の応答より先に起きる。
    await advance(flushMs() * 7);
    await act(async () => {
      releaseStart("session-1");
    });
    await pressed;
    await advance(150);

    // 出し直さないと、次の `info` が来るまで「解析中」のまま空のペインが残る
    // ——深い局面ほどその間隔は伸びる。
    expect(view.current.state.isAnalyzing).toBe(true);
    expect(view.current.state.candidates).toHaveLength(1);
  });

  it(
    "再開の開始が飛んでいる間に ■ → ▶ と押しても、Rust に断られない",
    async () => {
      // Rust と同じ相互排除を模す。**席は開始が返る前に取られる**
      // （`bridge.rs` の `start_infinite_analysis_impl`）。
      let taken = false;
      let releaseRestart: (sessionId: string) => void = () => {};
      let nth = 0;
      startCore.mockImplementation(() => {
        nth += 1;
        if (taken) return Promise.reject(new Error("Analysis already running"));
        taken = true;
        // 1本目（手動）と3本目（▶）は即返る。2本目（自動再開）だけが往復の途中で止まる。
        if (nth === 2) {
          return new Promise<string>((resolve) => {
            releaseRestart = resolve;
          });
        }
        return Promise.resolve(`s${nth}`);
      });
      stopCore.mockImplementation(async () => {
        taken = false;
      });
      const view = mountAnalysis(adapter("P1", "P1"));
      await act(async () => {
        await view.current.startInfiniteAnalysis();
      });

      // 盤が動いて自動再開が走り出す。開始の往復は返ってこない（席は Rust が握っている）。
      await view.setSync(adapter("P2", "P2"));
      await advance(150);

      // ■ を押す。席の欄は空なので、ここでは何も撃たない。
      await act(async () => {
        await view.current.stopAnalysis().catch(() => {});
      });

      // その状態で ▶。待たずに頼むと `take_session` に断られ、
      // **数百ミリ秒待てば通る回に「エンジンを起こし直せ」と案内する**ことになる。
      const pressed = view.current.startInfiniteAnalysis().catch(() => {});
      await advance(50);
      await act(async () => {
        releaseRestart("s2");
      });
      await advance(150);
      await pressed;

      expect(view.current.state.error).toBeNull();
      expect(view.current.state.isAnalyzing).toBe(true);
    },
    SLOW,
  );

  it(
    "再開の開始が飛んでいる間にもう1手進んでも、2本目を重ねない",
    async () => {
      // 上と同じ相互排除。**違うのは2手目を ▶ ではなく盤で進めること**
      // ——猶予のタイマーは飛んでいる再開を1つも見ないので、門が無ければ2本目が並ぶ。
      let taken = false;
      let releaseRestart: (sessionId: string) => void = () => {};
      let nth = 0;
      const refused: number[] = [];
      startCore.mockImplementation(() => {
        nth += 1;
        if (taken) {
          refused.push(nth);
          return Promise.reject(new Error("Analysis already running"));
        }
        taken = true;
        if (nth === 2) {
          return new Promise<string>((resolve) => {
            releaseRestart = resolve;
          });
        }
        return Promise.resolve(`s${nth}`);
      });
      stopCore.mockImplementation(async () => {
        taken = false;
      });

      const view = mountAnalysis(adapter("P1", "P1"));
      await act(async () => {
        await view.current.startInfiniteAnalysis();
      });

      // 1手目。自動再開が走り出し、開始の往復で止まる。
      await view.setSync(adapter("P2", "P2"));
      await advance(150);

      // **2手目。** ここで猶予のタイマーが張られ、飛んでいる再開の後ろに予約される。
      await view.setSync(adapter("P3", "P3"));
      await advance(150);

      await act(async () => {
        releaseRestart("s2");
      });
      await advance(150);

      // 重ねると Rust が両方断り、解析は1手目で止まったまま断りが出る。
      expect(refused).toEqual([]);
      expect(view.current.state.error).toBeNull();
      expect(view.current.state.isAnalyzing).toBe(true);
      expect(view.current.state.analyzedSfen).toBe("P3");
    },
    SLOW,
  );

  it("停止が届かなかったら、表示は停止中にしたうえで投げ返す", async () => {
    const view = mountAnalysis(adapter("P1", "P1"));
    await act(async () => {
      await view.current.startInfiniteAnalysis();
    });

    stopCore.mockRejectedValueOnce(new Error("ipc is gone"));
    let settled: "resolved" | "rejected" = "resolved";
    await act(async () => {
      await view.current.stopAnalysis().catch(() => {
        settled = "rejected";
      });
    });

    // 呼び手はこの向きを見て `.catch` を書く。飲むと、席が残った回を誰も知らない。
    expect(settled).toBe("rejected");
    expect(view.current.state.isAnalyzing).toBe(false);
  });

  it.each([
    ["starting", ENGINE_STARTING_MESSAGE],
    ["failed", ENGINE_FAILED_MESSAGE],
    ["no-engine", NO_ENGINE_SELECTED_MESSAGE],
  ] as const)("エンジンが %s のまま押したら、その理由の断りを立てる", async (reason, message) => {
    // ▶ は `disabled` にならない（ヘッダはエンジンの状態を1つも読まない）ので、
    // **起動を待っている人が必ずここへ来る**。「選んでください」と言ってはいけない。
    engine = { isReady: false, notReadyReason: reason };

    const view = mountAnalysis(adapter("P1", "P1"));
    await act(async () => {
      await view.current.startInfiniteAnalysis().catch(() => {});
    });

    expect(view.current.state.error).toBe(message);
    expect(startCore).not.toHaveBeenCalled();
  });

  it("自動再開が落ちたら、▶ を先に案内する断りを立てる", async () => {
    const view = mountAnalysis(adapter("P1", "P1"));
    await act(async () => {
      await view.current.startInfiniteAnalysis();
    });

    // 盤が動いて自動再開が走り、Rust が開始を断る。
    startCore.mockRejectedValueOnce(new Error("Analysis already running"));
    await view.setSync(adapter("P2", "P2"));
    await advance(200);

    // 上流の英文は載せない。まず ▶ を案内する（席は返し終えているので通りうる）。
    expect(view.current.state.error).toBe(RESTART_FAILED_MESSAGE);
    expect(view.current.state.isAnalyzing).toBe(false);
  });

  it("席を返せなかったら、断りを立てる", async () => {
    const view = mountAnalysis(adapter("P1", "P1"));
    await act(async () => {
      await view.current.startInfiniteAnalysis();
    });

    // 停止が Rust に届かない。席は握ったまま、画面は「停止中」になる。
    stopCore.mockRejectedValueOnce(new Error("ipc is gone"));
    await act(async () => {
      await view.current.stopAnalysis().catch(() => {});
    });

    // その席を返せないまま ▶ を押す。断りを立てないと、`console.error` で終わり、
    // #277 が出口を作っても永久に出ない。
    stopCore.mockRejectedValueOnce(new Error("ipc is gone"));
    startCore.mockClear();
    await act(async () => {
      await view.current.startInfiniteAnalysis().catch(() => {});
    });

    expect(view.current.state.error).toBe(RELEASE_FAILED_MESSAGE);
    expect(startCore).not.toHaveBeenCalled();
  });

  it("開始が断られたら、断りを立てる", async () => {
    const view = mountAnalysis(adapter("P1", "P1"));

    startCore.mockRejectedValueOnce(new Error("Analysis already running"));
    await act(async () => {
      await view.current.startInfiniteAnalysis().catch(() => {});
    });

    // #441 が再発したときの症状そのもの。上流の英文はここには出さない。
    expect(view.current.state.error).toBe(START_REFUSED_MESSAGE);
    expect(view.current.state.error).not.toContain("Analysis already running");
    expect(view.current.state.isAnalyzing).toBe(false);
  });

  it("局面の送信そのものが落ちたら、断りを立てる", async () => {
    const view = mountAnalysis(adapter("P1", "P1"));
    syncPosition.mockRejectedValueOnce(new Error("engine is gone"));

    await act(async () => {
      await view.current.startInfiniteAnalysis().catch(() => {});
    });

    // 立てないと `error` が null のまま `console.error` で終わり、画面は
    // 停止中のまま何も変わらない。押し直しても同じところで落ちる。
    expect(view.current.state.error).toBe(POSITION_SYNC_FAILED_MESSAGE);
    expect(view.current.state.isAnalyzing).toBe(false);
    expect(startCore).not.toHaveBeenCalled();
  });

  it("▶ で始め直したら、前の局面の候補手を出さない", async () => {
    tauri = true;
    startCore.mockResolvedValueOnce("session-1");

    const view = mountAnalysis(adapter("P1", "P1"));
    await act(async () => {
      await view.current.startInfiniteAnalysis();
    });
    await act(async () => {
      listeners?.onUpdate("session-1", oneCandidate);
    });
    await advance(150);
    expect(view.current.state.candidates).toHaveLength(1);

    // ■ を押す。候補手は画面に残ったまま（停止中の表示に使う）。
    await act(async () => {
      await view.current.stopAnalysis();
    });

    // 盤を動かして ▶。新しい席の最初の `info` が届くまでの窓で、
    // 消さないと **P1 の評価値と読み筋が P2 の解析結果として出る**
    // ——`AnalysisPane` はその間に P2 の鍵でキャッシュへ焼き付ける。
    startCore.mockResolvedValueOnce("session-2");
    await view.setSync(adapter("P2", "P2"));
    await act(async () => {
      await view.current.startInfiniteAnalysis();
    });

    expect(view.current.state.isAnalyzing).toBe(true);
    expect(view.current.state.analyzedSfen).toBe("P2");
    expect(view.current.state.candidates).toHaveLength(0);
  });

  it("席を握ったまま止まっていたら、▶ で返してから始める", async () => {
    const view = mountAnalysis(adapter("P1", "P1"));
    await act(async () => {
      await view.current.startInfiniteAnalysis();
    });

    // 停止が Rust に届かない。席は握ったまま、画面は「停止中」になる。
    stopCore.mockRejectedValueOnce(new Error("ipc is gone"));
    await act(async () => {
      await view.current.stopAnalysis().catch(() => {});
    });
    expect(view.current.state.isAnalyzing).toBe(false);

    // この状態で ▶。返さずに頼むと Rust に断られ続け、画面から復帰できない。
    stopCore.mockClear();
    startCore.mockClear();
    stopCore.mockResolvedValue(undefined);
    startCore.mockResolvedValue("session-2");
    await act(async () => {
      await view.current.startInfiniteAnalysis();
    });

    expect(stopCore).toHaveBeenCalledWith("session-1", "start");
    expect(startCore).toHaveBeenCalled();
    expect(view.current.state.isAnalyzing).toBe(true);
  });

  it("席を握ったまま止まっていても、局面が無くなったら返す", async () => {
    const view = mountAnalysis(adapter("P1", "P1"));
    await act(async () => {
      await view.current.startInfiniteAnalysis();
    });

    // 停止が届かない。画面は「停止中」、席は握ったまま、エンジンは読み続けている。
    stopCore.mockRejectedValueOnce(new Error("ipc is gone"));
    await act(async () => {
      await view.current.stopAnalysis().catch(() => {});
    });
    expect(view.current.state.isAnalyzing).toBe(false);

    stopCore.mockClear();
    stopCore.mockResolvedValue(undefined);

    // 棋譜を閉じる。`isAnalyzing` で門を作ると、ここで席が置き去りになる。
    await view.setSync(adapter(null, null));
    await advance(50);

    expect(stopCore).toHaveBeenCalledWith("session-1", "no-position");
  });

  it("開始の応答待ちで局面が無くなったら、待つのをやめて始めない", async () => {
    const view = mountAnalysis(adapter("P1", null));

    let settled = false;
    const done = () => {
      settled = true;
    };
    void view.current.startInfiniteAnalysis().then(done, done);
    await advance(50);

    // 席が返る前なので `isAnalyzing` は false。世代を上げないと、閉じた棋譜のために
    // 同期待ちが上限まで回り、その後で「送れませんでした」を積む。
    await view.setSync(adapter(null, null));
    await advance(200);

    expect(settled).toBe(true);
    expect(startCore).not.toHaveBeenCalled();
    expect(view.current.state.error).toBeNull();
  });

  it("返却が飛んでいる最中に局面が無くなっても、席へ2本目を撃たない", async () => {
    const pendingStops: Array<() => void> = [];
    const view = mountAnalysis(adapter("P1", "P1"));
    await act(async () => {
      await view.current.startInfiniteAnalysis();
    });

    stopCore.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          pendingStops.push(resolve);
        }),
    );

    // ■ を押す。停止の応答が返らないまま置く。
    void view.current.stopAnalysis();
    await advance(50);
    expect(pendingStops).toHaveLength(1);

    // その最中に棋譜を閉じる。同じ席へ2本目を撃つと、順序も結末も保証できない。
    await view.setSync(adapter(null, null));
    await advance(50);
    expect(pendingStops).toHaveLength(1);

    // 1本目が成功すれば席は空く。後ろに並んだ分は撃たない。
    await act(async () => {
      pendingStops[0]();
    });
    await advance(50);
    expect(stopCore).toHaveBeenCalledTimes(1);
  });

  it("飛んでいた返却が落ちたら、局面が無くなった側が撃ち直す", async () => {
    const view = mountAnalysis(adapter("P1", "P1"));
    await act(async () => {
      await view.current.startInfiniteAnalysis();
    });

    let failFirst: (e: Error) => void = () => {};
    stopCore.mockImplementationOnce(
      () =>
        new Promise<void>((_, reject) => {
          failFirst = reject;
        }),
    );

    void view.current.stopAnalysis().catch(() => {});
    await advance(50);

    // 応答が返らないうちに棋譜を閉じる。後ろに並ぶだけで、まだ撃たない。
    await view.setSync(adapter(null, null));
    await advance(50);
    stopCore.mockClear();

    // 1本目が落ちる。席は握ったままなので、並んだ側が撃ち直す。
    // 撃ち直さないと、棋譜を閉じた画面には ▶ も ■ も無く、誰も返せない。
    await act(async () => {
      failFirst(new Error("ipc is gone"));
    });
    await advance(50);

    expect(stopCore).toHaveBeenCalledWith("session-1", "no-position");
  });

  it("読む局面が無くなったら、席を返して止める", async () => {
    const view = mountAnalysis(adapter("P1", "P1"));
    await act(async () => {
      await view.current.startInfiniteAnalysis();
    });

    stopCore.mockClear();

    // 棋譜を閉じた。provider は畳まれないが、ペインごと消えるので ▶ も ■ も無くなる。
    await view.setSync(adapter(null, null));
    await advance(50);

    expect(stopCore).toHaveBeenCalledWith("session-1", "no-position");
    expect(view.current.state.isAnalyzing).toBe(false);
  });

  it("捨てた席の停止が飛んでいる間は、次の再開を始めない", async () => {
    const pendingStops: Array<() => void> = [];
    startCore.mockResolvedValueOnce("session-1");

    const view = mountAnalysis(adapter("P1", "P1"));
    await act(async () => {
      await view.current.startInfiniteAnalysis();
    });

    // 再開の開始を待たせ、その間にもう1手進めて世代を上げる。
    let releaseStart: (sessionId: string) => void = () => {};
    startCore.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          releaseStart = resolve;
        }),
    );
    await view.setSync(adapter("P2", "P2"));
    await advance(150);

    stopCore.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          pendingStops.push(resolve);
        }),
    );
    await view.setSync(adapter("P3", "P3"));
    await advance(150);

    startCore.mockClear();
    startCore.mockResolvedValue("session-3");

    // 追い越された席が返ってくる。捨てる停止が飛び、その応答はまだ来ない。
    await act(async () => {
      releaseStart("session-2");
    });
    await advance(150);
    expect(stopCore).toHaveBeenCalledWith("session-2", "late-restart");

    // 捨てる停止が飛んでいる間に次の go を出すと、Rust の席がまだ空いていない。
    expect(startCore).not.toHaveBeenCalled();
  });
});

describe("AnalysisProvider のアンマウント", () => {
  it("後ろに並んだ返却が飛んでいる間は、畳まれても指さない停止を撃たない", async () => {
    const view = mountAnalysis(adapter("P1", "P1"));
    await act(async () => {
      await view.current.startInfiniteAnalysis();
    });

    stopCore.mockClear();
    let failFirst: (e: unknown) => void = () => {};
    let releaseSecond: () => void = () => {};
    stopCore
      .mockImplementationOnce(
        () =>
          new Promise<void>((_, reject) => {
            failFirst = reject;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            releaseSecond = resolve;
          }),
      );

    // 棋譜を閉じる。1本目が飛ぶ。
    await view.setSync(adapter(null, null));
    expect(stopCore).toHaveBeenCalledTimes(1);

    // 1本目が落ちる。席は握ったままなので、並んでいた側が撃ち直す。
    await act(async () => {
      failFirst(new Error("ipc is gone"));
      await Promise.resolve();
    });
    expect(stopCore).toHaveBeenCalledTimes(2);

    // 2本目が飛んでいる最中に畳まれる。指さない停止は席を全部空けるので、
    // 重ねると開始と競って「席は空・エンジンは探索中」を作る（#463）。
    view.unmount();
    await advance(50);
    expect(stopCore.mock.calls).not.toContainEqual([undefined, "unmount"]);

    await act(async () => {
      releaseSecond();
    });
  });

  it(
    "畳んだ後に捨てる停止が落ちて席が戻ってきたら、その席も返す",
    async () => {
      tauri = true;
      startCore.mockResolvedValueOnce("s1");

      // 捨てる停止**だけ**を落とす。落ちた席は `keepOrForget` が欄へ書き戻す。
      let failDiscard: (e: unknown) => void = () => {};
      stopCore.mockImplementation((_sessionId, by) =>
        by === "late-restart"
          ? new Promise<void>((_, reject) => {
              failDiscard = reject;
            })
          : Promise.resolve(),
      );

      const view = mountAnalysis(adapter("P1", "P1"));
      await act(async () => {
        await view.current.startInfiniteAnalysis();
      });

      // 盤を2手進める。1手目の席は追い越され、着地したところで捨てられる。
      let releaseStart: (sessionId: string) => void = () => {};
      startCore.mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            releaseStart = resolve;
          }),
      );
      await view.setSync(adapter("P2", "P2"));
      await advance(150);
      await view.setSync(adapter("P3", "P2"));
      await advance(150);
      await act(async () => {
        releaseStart("s2");
      });
      await advance(150);

      // 捨てる停止が飛んでいる最中に畳まれる。ここで席の欄は空。
      stopCore.mockClear();
      view.unmount();
      await advance(50);

      // **その後で停止が落ちる。** 席が欄へ戻るので、返す者が要る
      // ——ここで取り残すと Rust に席が残り、以後の解析が全部断られる（#441）。
      await act(async () => {
        failDiscard(new Error("ipc is gone"));
        await Promise.resolve();
      });
      await advance(50);

      expect(stopCore.mock.calls).toContainEqual([undefined, "unmount"]);
    },
    SLOW,
  );

  it(
    "畳まれた後に着地した席の停止が落ちても、その席を返し直す",
    async () => {
      tauri = true;

      // ▶ の開始を往復の途中で止める。**着地するのは畳んだ後。**
      let releaseStart: (sessionId: string) => void = () => {};
      startCore.mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            releaseStart = resolve;
          }),
      );

      const view = mountAnalysis(adapter("P1", "P1"));
      const pressed = view.current.startInfiniteAnalysis().catch(() => {});
      await advance(50);

      // 畳まれた時点で席の欄は空。飛んでいる停止も無い。
      stopCore.mockClear();
      view.unmount();
      await advance(50);
      expect(stopCore).not.toHaveBeenCalled();

      // ここで席が着地し、捨てる停止が落ちる——`keepOrForget` が欄へ書き戻す。
      stopCore.mockRejectedValue(new Error("ipc is gone"));
      await act(async () => {
        releaseStart("session-late");
      });
      await advance(150);
      await pressed;

      // 書き戻した席を返し直さないと、Rust に残ったままになる（#441）。
      expect(stopCore.mock.calls).toContainEqual([undefined, "unmount"]);

      // **撃ち直しは1回だけ。** この停止も落ち続けるので、回数を持たないと
      // 書き戻しと撃ち直しが回り続ける。
      await advance(300);
      expect(stopCore.mock.calls.filter((c) => c[1] === "unmount")).toHaveLength(1);
    },
    SLOW,
  );

  it("解析中に畳まれたら、エンジンのセッションを返す", async () => {
    const view = mountAnalysis(adapter("P1", "P1"));

    await act(async () => {
      await view.current.startInfiniteAnalysis();
    });
    expect(view.current.state.isAnalyzing).toBe(true);

    stopCore.mockClear();
    view.unmount();

    // 返さないと Rust の `active_sessions` に席が残り、以降どの解析も
    // 「Analysis already running」で断られる。エンジンを畳み直すまで戻れない。
    expect(stopCore).toHaveBeenCalledTimes(1);

    // 指さない理由は `docs/state-transitions/analysis.md` ※12。ここで見るのは
    // 「指していないこと」だけ。
    expect(stopCore).toHaveBeenCalledWith(undefined, "unmount");
  });

  it("同期待ちの最中に畳まれたら、待つのをやめる", async () => {
    const view = mountAnalysis(adapter("P1", null));

    let settled = false;
    const done = () => {
      settled = true;
    };
    void view.current.startInfiniteAnalysis().then(done, done);
    await advance(50);

    view.unmount();

    // **上限に届かないうちに見る**（畳んだら待つのをやめる）。合計を上限の半分より
    // 十分下に置くこと——半分まで使うと、遅い機械では抜けていない回まで緑になる。
    await advance(limitMs() * 0.2);

    // 抜けないと、畳まれた画面のために `syncedSfen` を上限いっぱい見続ける。
    expect(settled).toBe(true);
    expect(startCore).not.toHaveBeenCalled();
  });

  it("席を受け取った直後、state に載る前に畳まれても、席を返す", async () => {
    let releaseStart: (sessionId: string) => void = () => {};
    startCore.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          releaseStart = resolve;
        }),
    );

    const view = mountAnalysis(adapter("P1", "P1"));

    // 応答待ちのまま置く（返ってこないので await しない）
    void view.current.startInfiniteAnalysis();
    await advance(50);

    stopCore.mockClear();

    // **`act` で包まない。** 包むと effect が流れて `state` の写しが更新され、
    // 見たい窓——dispatch と unmount が同じバッチに入り、写しが一度も
    // 更新されないまま畳まれる回——を踏めなくなる。
    releaseStart("session-late");
    await Promise.resolve();

    view.unmount();

    // 席の在処を `state` の写しから導くと、ここで「席は無い」と読んで
    // 何も撃たず、Rust に席が残る。
    expect(stopCore).toHaveBeenCalled();
  });

  it("返せなかった席を握り直して、畳まれたときにもう一度返す", async () => {
    let releaseStart: (sessionId: string) => void = () => {};
    startCore.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          releaseStart = resolve;
        }),
    );

    const view = mountAnalysis(adapter("P1", "P1"));
    void view.current.startInfiniteAnalysis();
    await advance(50);

    // 止めた後に席が返ってくる。返しにいくが、その停止が届かない。
    await act(async () => {
      await view.current.stopAnalysis();
    });
    stopCore.mockRejectedValueOnce(new Error("ipc is gone"));
    await act(async () => {
      releaseStart("session-late");
    });
    await advance(50);
    expect(stopCore).toHaveBeenCalledWith("session-late", "late-start");

    stopCore.mockClear();
    stopCore.mockResolvedValue(undefined);
    view.unmount();

    // 握り直していないと、席の存在を知る者が居ないまま画面が消える。
    expect(stopCore).toHaveBeenCalledTimes(1);
  });

  it("エラーで席を握ったまま止まっていても、▶ で返してから始める", async () => {
    tauri = true;
    const view = mountAnalysis(adapter("P1", "P1"));
    await act(async () => {
      await view.current.startInfiniteAnalysis();
    });

    // Rust からのエラー通知で S6（`isAnalyzing` は落ちるが席は握ったまま）。
    // **この通知は現物では飛ばない**（`provider.tsx` の注記）。ここでは S6 を作る道具。
    await act(async () => {
      listeners?.onError("engine died");
    });
    // 上流の英文は `state.error` には出さない（`console.error` にだけ残す）。
    expect(view.current.state.error).toBe(ENGINE_ERROR_MESSAGE);
    expect(view.current.state.isAnalyzing).toBe(false);

    stopCore.mockClear();
    startCore.mockClear();
    startCore.mockResolvedValue("session-2");

    await act(async () => {
      await view.current.startInfiniteAnalysis();
    });

    // 席を返さずに頼むと `take_session` が断り、S6 から抜けられない（#120 の形）。
    expect(stopCore).toHaveBeenCalledWith("session-1", "start");
    expect(view.current.state.isAnalyzing).toBe(true);
  });

  it("エラーで止まって見えていても、畳まれたら席を返す", async () => {
    tauri = true;
    const view = mountAnalysis(adapter("P1", "P1"));

    await act(async () => {
      await view.current.startInfiniteAnalysis();
    });

    // Rust からのエラー通知。`isAnalyzing` は落ちるが、席は握ったまま
    // （`set_error` は席の欄に触らない）。
    await act(async () => {
      listeners?.onError("engine died");
    });
    expect(view.current.state.isAnalyzing).toBe(false);

    stopCore.mockClear();
    view.unmount();

    expect(stopCore).toHaveBeenCalledTimes(1);
  });

  it("解析していないまま畳まれたら、停止を撃たない", async () => {
    // StrictMode は mount 直後に setup → cleanup → setup を走らせる。
    // ここで撃つと、席を持っていないのに停止が飛ぶ。
    const view = mountAnalysis(adapter("P1", "P1"), { strict: true });
    expect(stopCore).not.toHaveBeenCalled();

    view.unmount();
    expect(stopCore).not.toHaveBeenCalled();
  });

  it("開始の応答が畳まれた後に返ってきたら、その席を返す", async () => {
    let releaseStart: (sessionId: string) => void = () => {};
    startCore.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          releaseStart = resolve;
        }),
    );

    const view = mountAnalysis(adapter("P1", "P1"));

    // 応答待ちのまま置く。await しない（返ってこないので）。
    void view.current.startInfiniteAnalysis();
    await advance(50);

    // 畳んだ時点ではまだ席を握っていない（開始の応答が返っていない）。
    // 後始末は門で止まる。
    view.unmount();
    stopCore.mockClear();

    await act(async () => {
      releaseStart("session-late");
    });
    await advance(50);

    // 返さないと、誰も見ていない解析が Rust の席に居座り続ける。
    expect(stopCore).toHaveBeenCalledWith("session-late", "late-start");
  });

  it("再開の開始が畳まれた後に返ってきたら、その席を返す", async () => {
    let releaseStart: (sessionId: string) => void = () => {};
    startCore.mockResolvedValueOnce("session-1");
    startCore.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          releaseStart = resolve;
        }),
    );

    const view = mountAnalysis(adapter("P1", "P1"));
    await act(async () => {
      await view.current.startInfiniteAnalysis();
    });

    // 盤とエンジンが揃って進む。再開が走り、開始の応答待ちで止まる。
    await view.setSync(adapter("P2", "P2"));
    await advance(150);

    view.unmount();
    stopCore.mockClear();

    await act(async () => {
      releaseStart("session-2");
    });
    await advance(50);

    // 畳んだ時点で握っている席は無い——古い方は再開が先に返している。
    // 後始末は門で止まるので、この席を返せるのはここだけ。
    expect(stopCore).toHaveBeenCalledWith("session-2", "late-restart");
  });

  it("同期の追いつきで張ったタイマーを、アンマウントで止める", async () => {
    const view = mountAnalysis(adapter("P1", "P1"));

    await act(async () => {
      await view.current.startInfiniteAnalysis();
    });

    // 盤だけ進める。再開待ちのタイマーが張られ、望む局面が P2 になる。
    await view.setSync(adapter("P2", "P1"));

    // 盤を戻し、同時にエンジンが P2 へ追いつく。局面を見る effect は
    // 「解析済みと同じ局面」で早期 return するので、この回は cleanup を登録しない。
    // 追いつきを見る effect は、そこへタイマーを張る。
    await view.setSync(adapter("P1", "P2"));

    startCore.mockClear();

    view.unmount();

    // 畳んだ時点の後始末（席を返す停止）は数に入れない。ここで見たいのは
    // 「タイマーが後から動かないこと」だけ。
    stopCore.mockClear();
    await advance(200);

    // 残っていると、畳まれた後にエンジンへ go を出し、window の無くなった
    // テスト環境ではタイマー自身が投げる。
    expect(startCore).not.toHaveBeenCalled();
    expect(stopCore).not.toHaveBeenCalled();
  });

  it("同じインスタンスに effect が張り直されても、自動再開は死なない", async () => {
    // StrictMode は setup → cleanup → setup を1つのインスタンスに走らせる。
    // 畳まれた印を cleanup で立てるだけだと、そこで立った印が残る。
    const view = mountAnalysis(adapter("P1", "P1"), { strict: true });

    await act(async () => {
      await view.current.startInfiniteAnalysis();
    });

    startCore.mockClear();

    // 盤とエンジンが揃って1手進む。自動再開が走るはず。
    await view.setSync(adapter("P2", "P2"));
    await advance(400);

    expect(startCore).toHaveBeenCalled();
    expect(view.current.state.isAnalyzing).toBe(true);
  });

  it("停止の応答を待っている間に畳まれたら、そのまま go を出さない", async () => {
    // **待たせている停止を1本ずつ持つ。** 変数1つに上書きしていくと、
    // 畳んだときの後始末で撃たれる停止が同じ変数を奪い、下で解いているのが
    // 「再開が待っている停止」でなくなる——再開は止まったままなので
    // テストは通り続けるが、見たかった経路は踏まなくなる。
    const pendingStops: Array<() => void> = [];
    stopCore.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          pendingStops.push(resolve);
        }),
    );

    const view = mountAnalysis(adapter("P1", "P1"));
    await act(async () => {
      await view.current.startInfiniteAnalysis();
    });

    // 1手進める。再開は「前のセッションの停止待ち」で止まる。
    await view.setSync(adapter("P2", "P2"));
    await advance(150);

    // 再開はここで止まっている
    expect(pendingStops).toHaveLength(1);

    view.unmount();
    startCore.mockClear();

    await act(async () => {
      pendingStops[0]();
    });
    await advance(50);

    expect(startCore).not.toHaveBeenCalled();
  });

  it("再開の応答が畳まれた後に返っても、タイマーを張り直さない", async () => {
    let releaseStart: (sessionId: string) => void = () => {};
    startCore.mockResolvedValueOnce("session-1");
    startCore.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          releaseStart = resolve;
        }),
    );

    const view = mountAnalysis(adapter("P1", "P1"));
    await act(async () => {
      await view.current.startInfiniteAnalysis();
    });

    // 盤とエンジンが揃って進む。再開が走り出し、エンジンの応答待ちで止まる。
    await view.setSync(adapter("P2", "P2"));
    await advance(150);

    // 待っている間にもう1手進む。応答が返った後に張り直す予約だけが積まれる。
    await view.setSync(adapter("P3", "P3"));
    await advance(150);

    view.unmount();

    startCore.mockClear();
    stopCore.mockClear();

    await act(async () => {
      releaseStart("session-2");
    });
    await advance(50);

    expect(startCore).not.toHaveBeenCalled();

    // 撃たれる停止は、返ってきた席を返す1本だけ。**次の再開の前置きではない。**
    // 前置きなら、その後に go が続く。
    expect(stopCore).toHaveBeenCalledTimes(1);
    expect(stopCore).toHaveBeenCalledWith("session-2", "late-restart");
  });
});
