// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

import type { EngineFailure, EngineFailureKind, EnginePhase } from "@/entities/engine";
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
const engine = {
  state: { phase: "idle" as EnginePhase, error: null as EngineFailure | null },
  initialize: () => initialize(),
};

/** 失敗の値。**種類だけが文言を決める**ので、理由の文字列は何でもよい */
const failure = (kind: EngineFailureKind, message = "boom"): EngineFailure => ({ kind, message });

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

async function mountWith(phase: EnginePhase, error: EngineFailure | null = null) {
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
    async (next: EnginePhase, nextError: EngineFailure | null = null) => {
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
  test("失敗したら danger の帯を出す", async () => {
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

    const actions = shown().actions ?? [];
    expect(actions).toHaveLength(1);

    await act(async () => {
      await actions[0].run();
    });
    // プリセットを直す場所まで開く。タブを指さないと、押した先で
    // ワークスペースの設定が出る（`SettingsPanel` の既定）
    expect(openModal).toHaveBeenCalledWith("settings", { tab: "engine" });
  });

  /**
   * **同じ設定のままの再試行を勧めない**（#171 の受入条件）。
   * 押しても何も起きないので（同じ runtime では再トライしない）、
   * 書けるのは「設定を直せば自動で起動し直す」まで。
   */
  test("本文は設定を直す道だけを案内する", async () => {
    await mountWith("error", failure("unknown"));

    expect(shown().body).toContain("設定を直せば自動で");
    expect(shown().body).not.toContain("再試行");
  });

  /**
   * **設定を直しても直らない失敗がある**（実行権限が無い、応答しないボリューム）。
   * その回に案内が「設定を確かめてください」で終わっていると、確かめ終えた利用者に
   * 次の一手が残らない——同じ設定では自動でも手動でも起動し直さないので、
   * アプリを再起動する以外に道が無い。
   */
  test("設定に原因が無かった回の一手も書く", async () => {
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
      await (shown().actions ?? [])[0].run();
    });

    expect(openModal).toHaveBeenCalledWith("settings", { tab: "engine" });
    expect(stale).not.toHaveBeenCalled();
  });

  /**
   * **同じ設定のまま直る見込みがある種類にだけ「もう一度起動」を出す**（ADR-0004 の F-9）。
   * 原因が設定にある種類に出すと、押しても同じ結果になり、利用者は押し続ける。
   */
  test.each<[EngineFailureKind, boolean]>([
    ["spawnFailed", false],
    ["notUsi", false],
    ["exitedEarly", false],
    ["invalidValue", false],
    ["other", false],
    ["unknown", false],
    ["quarantined", true],
    ["timedOut", true],
    ["cancelled", true],
  ])("%s に「もう一度起動」を出すか: %s", async (kind, retry) => {
    await mountWith("error", failure(kind));

    const labels = (shown().actions ?? []).map((action) => action.label);
    expect(labels.includes("もう一度起動")).toBe(retry);
    expect(labels).toContain("設定を開く");
  });

  /** 押したら、いまの設定で起動し直す（`useEngine().initialize`） */
  test("「もう一度起動」は起動し直す", async () => {
    await mountWith("error", failure("timedOut"));

    const again = (shown().actions ?? []).find((action) => action.label === "もう一度起動");
    await act(async () => {
      await again?.run();
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
