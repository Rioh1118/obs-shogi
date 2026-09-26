// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

import type { EngineStartFailure, EngineStartFailureKind, EnginePhase } from "@/entities/engine";
import { ENGINE_START_FAILURE_NOTICES, SLOW_START_MS } from "../engineStartFailureNotice";
import type { NotifyRequest } from "@/shared/lib/notification/types";
import type { ModalType, URLParams } from "@/shared/lib/router/useURLParams";

/**
 * エンジンを起動できなかったことを利用者へ届けるのはこの橋
 * （`failure-surfacing.md` の F-9 / #171）。
 *
 * **この橋の外に、エンジンの失敗を描く UI は無い。** ここが黙ると、失敗は
 * どの画面にも出ないまま「解析が始まらない」だけになる。
 */

const initialize = vi.fn<() => Promise<boolean>>();
const cancelStart = vi.fn<() => void>();
const engine = {
  state: { phase: "idle" as EnginePhase, error: null as EngineStartFailure | null },
  initialize: () => initialize(),
  cancelStart: () => cancelStart(),
};

/** 失敗の値。**種類だけが文言を決める**ので、理由の文字列は何でもよい */
const failure = (kind: EngineStartFailureKind, message = "boom"): EngineStartFailure => ({
  kind,
  message,
});

const notify = vi.fn<(request: NotifyRequest) => void>();
const dismissByKey = vi.fn<(key: string) => void>();

/**
 * **実物は render のたびに別物を返しうる。** `openModal` は `searchParams` に依存する
 * `useCallback` なので、URL が動けば同一性が変わる（`useURLParams`）。
 * 固定した1つを返す形にすると、橋が最新を掴めているかを見られない
 */
type OpenModal = (modal: ModalType, extra?: Partial<URLParams>) => void;
let openModal = vi.fn<OpenModal>();

vi.mock("@/entities/engine", () => ({ useEngine: () => engine }));
vi.mock("@/shared/lib/notification/useNotifications", () => ({
  useNotify: () => ({ notify, dismiss: vi.fn(), dismissByKey }),
}));
vi.mock("@/shared/lib/router/useURLParams", () => ({ useURLParams: () => ({ openModal }) }));

const { EngineFailureBridge } = await import("../EngineFailureBridge");

/** **毎回新しい要素を作る。** 同じ要素を渡し直すと React がサブツリーごと畳む */
const app = () => <EngineFailureBridge />;

/**
 * 出した通知。**自分から消える枝をここで落とす**ので、各テストは動作も鍵も
 * そのまま読める（`silent` は見せ方を持たず、自動で消えるトーストは動作を持てない）
 */
function shown(at = 0) {
  const req = notify.mock.calls[at][0];
  if (req.tier === "silent") throw new Error("出さない段で呼んでいる");
  if (req.presentation === "toast") throw new Error("自分から消える見せ方になっている");
  return req;
}

/** 帯の動作を名前で引く。並びに頼ると「もう一度起動」の有無で指す先がずれる */
function action(label: string, at = 0) {
  const found = (shown(at).actions ?? []).find((a) => a.label === label);
  if (!found) throw new Error(`「${label}」が無い`);
  return found;
}

async function mountWith(phase: EnginePhase, error: EngineStartFailure | null = null) {
  engine.state = { phase, error };

  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(app());
  });

  const draw = async () => {
    await act(async () => {
      view.rerender(app());
    });
  };

  return Object.assign(
    /** エンジンの段が動いた、を実物と同じ順序で起こす */
    async (next: EnginePhase, nextError: EngineStartFailure | null = null) => {
      engine.state = { phase: next, error: nextError };
      await draw();
    },
    {
      /** 段は動かさず、画面（URL）だけが動いた回 */
      async redraw() {
        await draw();
      },
    },
  );
}

beforeEach(() => {
  notify.mockClear();
  dismissByKey.mockClear();
  initialize.mockReset();
  initialize.mockResolvedValue(true);
  cancelStart.mockReset();
  openModal = vi.fn<OpenModal>();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("エンジンの起動に失敗したことを届ける橋", () => {
  /**
   * 設定タブを開いていなくても分かること（#171 の受入条件）。
   * **帯**なのは ADR-0004 の割り当てで、解析ペインを開いていない利用者にも届く。
   */
  test("種類が分からない失敗は danger の帯を出す", async () => {
    await mountWith("error", failure("unknown", "Engine initialization failed: no such file"));

    expect(notify).toHaveBeenCalledTimes(1);
    expect(shown().tier).toBe("danger");
    expect(shown().presentation).toBe("banner");
  });

  /**
   * **帯はヘッダを覆う**（`NotificationLayer.scss`）ので、閉じる以外に
   * やることが無い帯を出してはいけない。F-9 の復帰導線は設定（ADR-0004 決定3）。
   */
  test("設定へ送る動作を必ず持たせる", async () => {
    await mountWith("error", failure("unknown"));

    await act(async () => {
      await action("設定を開く").run();
    });
    // プリセットを直す場所まで開く。タブを指さないと、押した先で
    // ワークスペースの設定が出る（`SettingsPanel` の既定）
    expect(openModal).toHaveBeenCalledWith("settings", { tab: "engine" });
  });

  /**
   * 種類が分からない失敗（`unknown` / `other`）は、**直した場所ごとに起動し直す経路を書く**。
   * 設定を直した回は自動で起動し直すが、ファイルや権限を直した回は設定が変わらないので、
   * 「もう一度起動」を押す場所を書かないと行き止まりになる
   */
  test("種類が分からない失敗は、直した場所ごとの起動し直し方を書く", async () => {
    await mountWith("error", failure("unknown"));

    expect(shown().body).toContain("設定を直したときは自動で");
    expect(shown().body).toContain("「もう一度起動」");
  });

  /** それでも起動しない回の最後の一手（種類が分からない失敗） */
  test("種類が分からない失敗は、最後の一手も書く", async () => {
    await mountWith("error", failure("unknown"));

    expect(shown().body).toContain("アプリを再起動");
  });

  /** 内部の語とエンジンの出力を画面に出さない（`NotifyRequest` の `title` / `body`） */
  test("Rust から来た文言を画面に出さない", async () => {
    await mountWith(
      "error",
      failure(
        "exitedEarly",
        "Communication failed: engine exited (last output: Error! : failed to read nn.bin)",
      ),
    );

    expect(`${shown().title}${shown().body}`).not.toContain("Communication failed");
    expect(`${shown().title}${shown().body}`).not.toContain("nn.bin");
  });

  test("起動できていれば何も出さない", async () => {
    await mountWith("ready");

    expect(notify).not.toHaveBeenCalled();
  });

  /**
   * **利用者が実際に踏む筋。** 起動中から失敗へ落ちる。
   * 段を1つだけ与えるテストは、マウント時にしか見ない実装でも全部緑になるので、
   * **失敗へ落ちる切り替え**を踏むのはここだけ（抜ける側は下の「引っ込める」）。
   */
  test("起動中から失敗へ落ちたときに出す", async () => {
    const move = await mountWith("initializing");
    expect(notify).not.toHaveBeenCalled();

    await move("error", failure("unknown"));

    expect(notify).toHaveBeenCalledTimes(1);
  });

  /**
   * 設定を直せば起動し直す（`engine.md` の (S3, E3)）。そのとき帯が残ると、
   * 動いているエンジンの上に「起動できませんでした」が出たまま**ヘッダを覆い続ける**。
   */
  test("起動し直せたら帯を引っ込める", async () => {
    const move = await mountWith("error", failure("unknown"));
    expect(dismissByKey).not.toHaveBeenCalled();

    await move("ready");

    expect(dismissByKey).toHaveBeenCalledTimes(1);
    expect(dismissByKey.mock.calls[0][0]).toBe(shown().dismissKey);
  });

  /**
   * 帯は条件と結び付いているので、**出した取っ手で引っ込められること**が要る。
   * 取っ手が無いと `dismissByKey` の指し先が無く、出しっぱなしになる。
   */
  test("引っ込めるための取っ手を持つ", async () => {
    await mountWith("error", failure("unknown"));

    expect(shown().dismissKey).toEqual(expect.any(String));
  });

  /**
   * **畳む鍵は持たない。** この帯は条件から出ていて2枚目が積まれようがないので、
   * 畳む鍵にすると「1件」が出たまま動かない（`Notification.count`）。
   */
  test("件数の付く鍵は持たない", async () => {
    await mountWith("error", failure("unknown"));

    expect(shown().dedupeKey).toBeUndefined();
  });

  /**
   * **画面を動かしても帯を積み直さない。** `openModal` は URL が変わるたびに別物になるので、
   * effect の依存に入れると cleanup → `notify` が走り、**利用者が閉じた帯が黙って戻る**。
   */
  test("URL が動いただけでは出し直さない", async () => {
    const move = await mountWith("error", failure("unknown"));
    expect(notify).toHaveBeenCalledTimes(1);

    openModal = vi.fn<OpenModal>();
    await move.redraw();

    expect(notify).toHaveBeenCalledTimes(1);
    expect(dismissByKey).not.toHaveBeenCalled();
  });

  /**
   * 依存から外すぶん、**押したときに掴んでいるのは最新でなければならない**。
   * 古いほうを掴むと、押した時点の URL ではなく帯を出した時点の URL に対して
   * `navigate` することになる。
   */
  test("押したときに走るのは、いまの画面の口", async () => {
    const move = await mountWith("error", failure("unknown"));
    const stale = openModal;

    openModal = vi.fn<OpenModal>();
    await move.redraw();

    await act(async () => {
      await action("設定を開く").run();
    });

    expect(openModal).toHaveBeenCalledWith("settings", { tab: "engine" });
    expect(stale).not.toHaveBeenCalled();
  });

  /**
   * 種類ごとの段と「もう一度起動」。**2つは別の軸**（`ENGINE_START_FAILURE_NOTICES` の doc）——
   * `quarantined` は `danger` なのに「もう一度起動」を出す。段から再試行を導く形に畳むと、
   * macOS で許可した後に押すボタンが消え、同じ設定なので自動でも起動しない
   */
  test.each<[EngineStartFailureKind, "warning" | "danger", boolean]>([
    ["spawnFailed", "danger", true],
    ["quarantined", "danger", true],
    ["notUsi", "danger", true],
    ["exitedEarly", "danger", true],
    ["timedOut", "warning", true],
    ["invalidValue", "danger", false],
    ["cancelled", "warning", true],
    ["other", "danger", true],
    ["unknown", "danger", true],
  ])("%s は %s の帯で、「もう一度起動」を出すか: %s", async (kind, tier, retry) => {
    await mountWith("error", failure(kind));

    const labels = (shown().actions ?? []).map((a) => a.label);
    expect(shown().tier).toBe(tier);
    expect(labels.includes("もう一度起動")).toBe(retry);
    expect(labels).toContain("設定を開く");
  });

  /**
   * **行き止まりの帯を作らない。** 「もう一度起動」を出さない種類は、設定を直すしか道が無く、
   * 直せば自動で起動し直す種類でなければならない（本文がそれを言う）。原因が設定の外にも
   * ありうる種類で出さないと、ファイルや権限を直し終えた利用者に押す口が残らない
   */
  test("「もう一度起動」を出さない種類は、設定を直せば自動で起動し直すと言う", () => {
    const withoutRetry = Object.entries(ENGINE_START_FAILURE_NOTICES).filter(
      ([, notice]) => !notice.retry,
    );

    expect(withoutRetry.map(([kind]) => kind)).toEqual(["invalidValue"]);
    for (const [, notice] of withoutRetry) {
      expect(notice.body).toContain("設定を直せば自動でもう一度起動します");
    }
  });

  /** 押したら、いまの設定で起動し直す（`useEngine().initialize`） */
  test("「もう一度起動」は起動し直す", async () => {
    await mountWith("error", failure("timedOut"));

    await act(async () => {
      await action("もう一度起動").run();
    });

    expect(initialize).toHaveBeenCalledTimes(1);
  });

  /**
   * 種類ごとに本文が違うこと。**同じ文言に潰すと、何を直せばよいかが種類から届かない**
   * （macOS が止めたものに「エンジンの場所を確かめて」と案内する）
   */
  test("種類ごとに違う一手を案内する", async () => {
    await mountWith("error", failure("quarantined"));
    const quarantined = shown().body;
    notify.mockClear();
    cleanup();
    await mountWith("error", failure("exitedEarly"));
    const exited = shown().body;

    expect(quarantined).toContain("プライバシーとセキュリティ");
    expect(exited).toContain("評価関数");
    expect(quarantined).not.toBe(exited);
  });
});

describe("起動に時間が掛かっていることを届ける", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * **`readyok` の待ちに上限は無い。** 帯が無いと、答えないエンジンを選んだ回に起動中のまま
   * 何も出ず、止める口もどこにも無い
   */
  test("起動中が長引いたら、止める口を持つ帯を出す", async () => {
    await mountWith("initializing");
    expect(notify).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(SLOW_START_MS);
    });

    expect(notify).toHaveBeenCalledTimes(1);
    expect(shown().tier).toBe("warning");
    await act(async () => {
      await action("起動をやめる").run();
    });
    expect(cancelStart).toHaveBeenCalledTimes(1);
  });

  test("上限の前に起動できたら出さず、出した帯は段を抜けたら引っ込める", async () => {
    const move = await mountWith("initializing");
    await act(async () => {
      vi.advanceTimersByTime(SLOW_START_MS - 1);
    });
    await move("ready");
    await act(async () => {
      vi.advanceTimersByTime(SLOW_START_MS);
    });
    expect(notify).not.toHaveBeenCalled();

    const again = await mountWith("initializing");
    await act(async () => {
      vi.advanceTimersByTime(SLOW_START_MS);
    });
    const key = shown().dismissKey;
    await again("ready");
    expect(dismissByKey).toHaveBeenCalledWith(key);
  });
});
