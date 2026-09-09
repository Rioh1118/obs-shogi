// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

import type { EnginePhase } from "@/entities/engine";
import type { NotifyRequest } from "@/shared/lib/notification/types";
import type { ModalType, URLParams } from "@/shared/lib/router/useURLParams";

/**
 * エンジンを起動できなかったことを利用者へ届けるのはこの橋
 * （`failure-surfacing.md` の F-9 / #171）。
 *
 * **`engine.state.error` には読み手が居ない。** ここが黙ると、失敗は
 * どの画面にも出ないまま「解析が始まらない」だけになる。
 */

const engine = { state: { phase: "idle" as EnginePhase, error: null as string | null } };

const notify = vi.fn<(request: NotifyRequest) => void>();
const dismissByKey = vi.fn<(key: string) => void>();
const openModal = vi.fn<(modal: ModalType, extra?: Partial<URLParams>) => void>();

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

async function mountWith(phase: EnginePhase, error: string | null = null) {
  engine.state = { phase, error };

  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(app());
  });

  /** エンジンの段が動いた、を実物と同じ順序で起こす */
  return async (next: EnginePhase, nextError: string | null = null) => {
    engine.state = { phase: next, error: nextError };
    await act(async () => {
      view.rerender(app());
    });
  };
}

beforeEach(() => {
  notify.mockClear();
  dismissByKey.mockClear();
  openModal.mockClear();
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
    await mountWith("error", "Engine initialization failed: no such file");

    expect(notify).toHaveBeenCalledTimes(1);
    expect(shown().tier).toBe("danger");
    expect(shown().presentation).toBe("banner");
  });

  /**
   * **帯はヘッダを覆う**（`NotificationLayer.scss`）ので、閉じる以外に
   * やることが無い帯を出してはいけない。F-9 の復帰導線は設定（ADR-0004 決定3）。
   */
  test("設定へ送る動作を必ず持たせる", async () => {
    await mountWith("error", "boom");

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
    await mountWith("error", "boom");

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
    await mountWith("error", "boom");

    expect(shown().body).toContain("アプリを再起動");
  });

  /** 内部の語を画面に出さない（`NotifyRequest` の `title` / `body`） */
  test("Rust から来た文言を画面に出さない", async () => {
    await mountWith("error", "Engine initialization failed: NotInitialized");

    expect(`${shown().title}${shown().body}`).not.toContain("Engine initialization failed");
  });

  test("起動できていれば何も出さない", async () => {
    await mountWith("ready");

    expect(notify).not.toHaveBeenCalled();
  });

  /**
   * **利用者が実際に踏む筋。** 起動中から失敗へ落ちる。
   * マウント時にしか見ない実装でも上の4本は緑になるので、切り替えを踏むのはここだけ。
   */
  test("起動中から失敗へ落ちたときに出す", async () => {
    const move = await mountWith("initializing");
    expect(notify).not.toHaveBeenCalled();

    await move("error", "boom");

    expect(notify).toHaveBeenCalledTimes(1);
  });

  /**
   * 設定を直せば起動し直す（`engine.md` の (S3, E3)）。そのとき帯が残ると、
   * 動いているエンジンの上に「起動できませんでした」が出たまま**ヘッダを覆い続ける**。
   */
  test("起動し直せたら帯を引っ込める", async () => {
    const move = await mountWith("error", "boom");
    expect(dismissByKey).not.toHaveBeenCalled();

    await move("ready");

    expect(dismissByKey).toHaveBeenCalledTimes(1);
    expect(dismissByKey.mock.calls[0][0]).toBe(shown().dedupeKey);
  });

  /**
   * 帯は条件と結び付いているので、**出した鍵で引っ込められること**が要る。
   * 鍵が無いと `dismissByKey` の指し先が無く、出しっぱなしになる。
   */
  test("引っ込めるための鍵を持つ", async () => {
    await mountWith("error", "boom");

    expect(shown().dedupeKey).toEqual(expect.any(String));
  });
});
