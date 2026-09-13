// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { Err, Ok, type Result } from "@/shared/lib/result";
import type { BookError, BookInfo, BookLine, BookMove } from "@/entities/book/model/types";
import type { BookContextType, BookViewState } from "../context";
import { BookProvider } from "../provider";
import { useBook } from "../useBook";

/** 返すのを止めておける約束。**返る順を作る口** */
function deferred<T>() {
  let settle!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

const info = (handle: number, path: string): BookInfo => ({
  handle,
  path,
  format: "yaneuraouDb",
  positionCount: 1,
  droppedFields: 0,
});

const move = (usi: string): BookMove => ({
  usiMove: usi,
  ponder: null,
  value: null,
  depth: null,
  count: null,
});

const line = (usi: string, plies: number): BookLine => ({
  usiMove: usi,
  plies,
  stopped: "outOfBook",
});

const failure = (code: BookError["code"]): BookError => ({
  code,
  message: `${code} のテスト`,
  path: null,
});

type LookupResult = Result<BookMove[], BookError>;
type WalkResult = Result<BookLine[], BookError>;

/** 定跡（ハンドル）と局面ごとに、引きを止めておくための約束 */
const lookups = new Map<string, ReturnType<typeof deferred<LookupResult>>>();
const walks = new Map<string, ReturnType<typeof deferred<WalkResult>>>();
const closed: number[] = [];
let orphans: BookInfo[] = [];
/** 開くたびに別のハンドルを配る。**同じ値を配ると定跡の取り違えが観測できない** */
let nextHandle = 0;
/** 開くのを失敗させたい回だけ立てる */
let openFails: BookError | null = null;

function pending<T>(store: Map<string, ReturnType<typeof deferred<T>>>, key: string) {
  const found = store.get(key);
  if (found) return found;
  const fresh = deferred<T>();
  store.set(key, fresh);
  return fresh;
}

const at = (handle: number, sfen: string) => `${handle}:${sfen}`;

vi.mock("../../api/commands", () => ({
  openBook: (path: string) =>
    Promise.resolve(openFails ? Err(openFails) : Ok(info(++nextHandle, path))),
  lookupBookMoves: (handle: number, sfen: string) =>
    pending<LookupResult>(lookups, at(handle, sfen)).promise,
  walkBookLines: (handle: number, sfen: string) =>
    pending<WalkResult>(walks, at(handle, sfen)).promise,
  closeBook: (handle: number) => {
    closed.push(handle);
    return Promise.resolve(Ok(undefined));
  },
  listBooks: () => Promise.resolve(orphans),
}));

let seen: BookContextType | null = null;

function Probe() {
  seen = useBook();
  return null;
}

function mount(sfen: string | null) {
  return render(
    <BookProvider currentSfen={sfen}>
      <Probe />
    </BookProvider>,
  );
}

function at_(sfen: string | null) {
  return (
    <BookProvider currentSfen={sfen}>
      <Probe />
    </BookProvider>
  );
}

/** 開いて、引きが走り始めるところまで進める。返るのは配られたハンドル */
async function openAt(sfen: string, path = "/books/a.db") {
  const view = mount(sfen);
  await act(async () => {
    await seen!.openBook(path);
  });
  return { view, handle: nextHandle };
}

/** 表に出ている行の指し手 */
function rowMoves(view: BookViewState): string[] {
  return view.kind === "rows" ? view.rows.map((r) => r.move.usiMove) : [];
}

beforeEach(() => {
  lookups.clear();
  walks.clear();
  closed.length = 0;
  orphans = [];
  nextHandle = 0;
  openFails = null;
  seen = null;
});

afterEach(() => cleanup());

describe("定跡の provider", () => {
  it("定跡を開くまでは何も引かない", async () => {
    mount("sfen-a");
    await act(async () => {});

    expect(lookups.size).toBe(0);
    expect(seen!.info).toBeNull();
    expect(seen!.view.kind).toBe("closed");
  });

  it("開いた局面の候補手を、辿る前に出す", async () => {
    const { handle } = await openAt("sfen-a");

    await act(async () => {
      pending<LookupResult>(lookups, at(handle, "sfen-a")).settle(Ok([move("7g7f")]));
    });

    expect(rowMoves(seen!.view)).toEqual(["7g7f"]);
    // **辿り終える前に行が出ること。** 待たせると、局面を進めるたびに表が空に見える
    expect(seen!.view.kind === "rows" && seen!.view.rows[0].line.state).toBe("pending");
  });

  it("辿り終えると「この先」だけが埋まる", async () => {
    const { handle } = await openAt("sfen-a");
    await act(async () => {
      pending<LookupResult>(lookups, at(handle, "sfen-a")).settle(Ok([move("7g7f")]));
    });
    await act(async () => {
      pending<WalkResult>(walks, at(handle, "sfen-a")).settle(Ok([line("7g7f", 9)]));
    });

    const row = seen!.view.kind === "rows" ? seen!.view.rows[0] : null;
    expect(row?.line).toEqual({ state: "walked", line: line("7g7f", 9) });
  });

  /**
   * **辿るのに失敗した行を「まだ辿っている」に見せない。**
   *
   * 同じ `null` に潰していた版では、辿るのをやめた後も全行が `…`（「定跡の先を
   * 辿っています」）を出し続けた。利用者には重い処理がまだ走っているようにしか
   * 見えず、待てば埋まると読む。局面を動かすまで解けない。
   */
  it("辿るのに失敗しても行は残り、列は「まだ」に見えない", async () => {
    const { handle } = await openAt("sfen-a");
    await act(async () => {
      pending<LookupResult>(lookups, at(handle, "sfen-a")).settle(Ok([move("7g7f")]));
    });
    await act(async () => {
      pending<WalkResult>(walks, at(handle, "sfen-a")).settle(Err(failure("io")));
    });

    expect(rowMoves(seen!.view)).toEqual(["7g7f"]);
    expect(seen!.view.kind === "rows" && seen!.view.rows[0].line.state).toBe("failed");
    expect(seen!.error?.code).toBe("io");
  });

  /**
   * **引けなかったことを「定跡に載っていない」と言わない。**
   *
   * 定跡ビューを見に来る理由そのものなので、この画面でいちばん誤解が高くつく。
   * 利用者は「この定跡はこの局面を持っていない」という*事実*として読む。
   */
  it("引くのに失敗した局面は、載っていないのと別の状態になる", async () => {
    const { handle } = await openAt("sfen-a");

    await act(async () => {
      pending<LookupResult>(lookups, at(handle, "sfen-a")).settle(Err(failure("invalid_sfen")));
    });

    expect(seen!.view.kind).toBe("unavailable");
    expect(seen!.error?.code).toBe("invalid_sfen");
  });

  it("引けて空なら、載っていないと言う", async () => {
    const { handle } = await openAt("sfen-a");

    await act(async () => {
      pending<LookupResult>(lookups, at(handle, "sfen-a")).settle(Ok([]));
    });

    expect(seen!.view.kind).toBe("absent");
  });

  /**
   * **表に出ている行は、いま盤に出ている局面のもの**（`book-view.md` 不変条件1 / ※A）。
   *
   * 遅れて届いた結果を当てる変異（`cancelled` を見ない）はここで落ちる。
   * 定跡の候補手はどの局面でもそれらしく見えるので、**出てしまうと画面からは
   * 誤りだと分からない。**
   */
  it("局面が動いた後に届いた引きは捨てる", async () => {
    const { view, handle } = await openAt("sfen-a");

    view.rerender(at_("sfen-b"));

    // 先に投げた sfen-a の引きが、局面が動いた後で返る
    await act(async () => {
      pending<LookupResult>(lookups, at(handle, "sfen-a")).settle(Ok([move("7g7f")]));
    });

    expect(seen!.view.kind).toBe("looking");

    await act(async () => {
      pending<LookupResult>(lookups, at(handle, "sfen-b")).settle(Ok([move("2g2f")]));
    });

    expect(rowMoves(seen!.view)).toEqual(["2g2f"]);
  });

  /**
   * **遅れて届いた古い結果が、先に届いた新しい結果を消さないこと。**
   *
   * 行を配るところで局面を突き合わせているので、古い結果を**書いてしまっても**
   * 画面には出ない。壊れるのは、新しい結果が既に入っている後に古い結果が
   * 上書きしたとき。そのとき表は古い行を出すのではなく**空になる**ので、
   * 利用者からは「定跡に無い局面」と見分けが付かない。
   */
  it("先に届いた新しい結果を、遅れて届いた古い結果が上書きしない", async () => {
    const { view, handle } = await openAt("sfen-a");

    view.rerender(at_("sfen-b"));

    await act(async () => {
      pending<LookupResult>(lookups, at(handle, "sfen-b")).settle(Ok([move("2g2f")]));
    });
    expect(rowMoves(seen!.view)).toEqual(["2g2f"]);

    await act(async () => {
      pending<LookupResult>(lookups, at(handle, "sfen-a")).settle(Ok([move("7g7f")]));
    });

    expect(rowMoves(seen!.view)).toEqual(["2g2f"]);
  });

  /**
   * **前の定跡から引いた行を、新しい定跡の行として出さない。**
   *
   * 開き直した直後は局面が同じままなので、局面だけで突き合わせると素通りする。
   * `cancelled` が立つのは effect の掃除＝再レンダが commit された時点で、
   * `openBook` が定跡を差し替えた時点ではない。その隙間に前の定跡の引きが返る。
   *
   * **どの定跡から来た行かは画面から確かめようが無い**ので、出てしまうと気づけない。
   */
  it("開き直した直後に、前の定跡から引いた行が出ない", async () => {
    const first = await openAt("sfen-a");

    await act(async () => {
      await seen!.openBook("/books/b.db");
    });

    // 前の定跡（handle 1）の引きが、差し替わった後で返る
    await act(async () => {
      pending<LookupResult>(lookups, at(first.handle, "sfen-a")).settle(Ok([move("7g7f")]));
    });

    expect(seen!.view.kind).toBe("looking");
    expect(rowMoves(seen!.view)).toEqual([]);
  });

  it("局面が動くと、前の局面の行は残さずに引き直す", async () => {
    const { view, handle } = await openAt("sfen-a");
    await act(async () => {
      pending<LookupResult>(lookups, at(handle, "sfen-a")).settle(Ok([move("7g7f")]));
    });
    expect(seen!.view.kind).toBe("rows");

    view.rerender(at_("sfen-b"));
    await act(async () => {});

    expect(seen!.view.kind).toBe("looking");
  });

  /**
   * **引き始める前に「載っていない」と読める frame を通らない。**
   *
   * `isLooking` を state に持っていた版では、定跡が入ったレンダと effect が
   * 走るレンダの間に「引き終えて空」に見える commit が挟まっていた。
   */
  it("定跡が入った瞬間から、引いている最中として出る", async () => {
    const frames: string[] = [];
    function Recorder() {
      frames.push(useBook().view.kind);
      return null;
    }

    render(
      <BookProvider currentSfen="sfen-a">
        <Probe />
        <Recorder />
      </BookProvider>,
    );
    await act(async () => {
      await seen!.openBook("/books/a.db");
    });

    expect(frames).not.toContain("absent");
    expect(frames).toContain("looking");
  });

  it("開いている最中は、開こうとしているパスを出す", async () => {
    openFails = null;
    mount("sfen-a");

    // 解決させずにレンダだけ進める
    let opening!: Promise<unknown>;
    await act(async () => {
      opening = seen!.openBook("/books/big.db");
    });
    await act(async () => {
      await opening;
    });

    // 開き終わっているので `opening` は抜けている
    expect(seen!.view.kind).not.toBe("opening");
  });

  it("開けなかったら、定跡を開いていない状態に留まる", async () => {
    openFails = failure("unsupported_format");
    mount("sfen-a");

    await act(async () => {
      await seen!.openBook("/books/a.bin");
    });

    expect(seen!.info).toBeNull();
    expect(seen!.view.kind).toBe("closed");
    expect(seen!.error?.code).toBe("unsupported_format");
    // 開けていないので引きにも行かない
    expect(lookups.size).toBe(0);
  });

  /** 閉じないとハンドルとメモリが積み上がる（`book-view.md` 不変条件3） */
  it("開き直すと、前の定跡を閉じる", async () => {
    const { handle } = await openAt("sfen-a");
    await act(async () => {
      await seen!.openBook("/books/b.db");
    });

    expect(closed).toContain(handle);
  });

  it("閉じると行も消える", async () => {
    const { handle } = await openAt("sfen-a");
    await act(async () => {
      pending<LookupResult>(lookups, at(handle, "sfen-a")).settle(Ok([move("7g7f")]));
    });

    await act(async () => {
      seen!.close();
    });

    expect(seen!.info).toBeNull();
    expect(seen!.view.kind).toBe("closed");
  });

  /**
   * **webview が作り直されると、前の版が開いたハンドルを閉じる者が居なくなる。**
   * 起動時に拾わないと、定跡ぶんのメモリがプロセスの終わりまで残る。
   */
  it("起動時に、前の版が残したハンドルを閉じる", async () => {
    orphans = [info(7, "/books/orphan.db"), info(8, "/books/orphan2.db")];

    mount(null);
    await act(async () => {});

    expect(closed).toEqual([7, 8]);
  });

  it("棋譜が盤から降りると、引く先が無いことを言う", async () => {
    const { view, handle } = await openAt("sfen-a");
    await act(async () => {
      pending<LookupResult>(lookups, at(handle, "sfen-a")).settle(Ok([move("7g7f")]));
    });

    view.rerender(at_(null));
    await act(async () => {});

    // **「引いています」と言わない。** 引く先が無いので待っても何も起きない
    expect(seen!.view.kind).toBe("noPosition");
  });

  it("定跡の外で起きた失敗も帯に載る", async () => {
    mount("sfen-a");

    await act(async () => {
      seen!.reportError(failure("unknown"));
    });

    expect(seen!.error?.code).toBe("unknown");
  });
});
