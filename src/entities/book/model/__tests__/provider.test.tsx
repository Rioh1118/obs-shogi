// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { Ok, type Result } from "@/shared/lib/result";
import type { BookError, BookInfo, BookLine, BookMove } from "../types";
import type { BookContextType } from "../context";
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

type LookupResult = Result<BookMove[], BookError>;
type WalkResult = Result<BookLine[], BookError>;

/** 局面ごとに、引きを止めておくための約束 */
const lookups = new Map<string, ReturnType<typeof deferred<LookupResult>>>();
const walks = new Map<string, ReturnType<typeof deferred<WalkResult>>>();
const closed: number[] = [];
let orphans: BookInfo[] = [];

function pending<T>(store: Map<string, ReturnType<typeof deferred<T>>>, sfen: string) {
  const found = store.get(sfen);
  if (found) return found;
  const fresh = deferred<T>();
  store.set(sfen, fresh);
  return fresh;
}

vi.mock("../../api/commands", () => ({
  openBook: (path: string) => Promise.resolve(Ok(info(1, path))),
  lookupBookMoves: (_handle: number, sfen: string) => pending<LookupResult>(lookups, sfen).promise,
  walkBookLines: (_handle: number, sfen: string) => pending<WalkResult>(walks, sfen).promise,
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

/** 開いて、引きが走り始めるところまで進める */
async function openAt(sfen: string) {
  const view = mount(sfen);
  await act(async () => {
    await seen!.openBook("/books/a.db");
  });
  return view;
}

beforeEach(() => {
  lookups.clear();
  walks.clear();
  closed.length = 0;
  orphans = [];
  seen = null;
});

afterEach(() => cleanup());

describe("定跡の provider", () => {
  it("定跡を開くまでは何も引かない", async () => {
    mount("sfen-a");
    await act(async () => {});

    expect(lookups.size).toBe(0);
    expect(seen!.info).toBeNull();
    expect(seen!.rows).toEqual([]);
  });

  it("開いた局面の候補手を、辿る前に出す", async () => {
    await openAt("sfen-a");

    await act(async () => {
      pending<LookupResult>(lookups, "sfen-a").settle(Ok([move("7g7f")]));
    });

    expect(seen!.rows.map((r) => r.move.usiMove)).toEqual(["7g7f"]);
    // **辿り終える前に行が出ること。** 待たせると、局面を進めるたびに表が空に見える
    expect(seen!.rows[0].line).toBeNull();
    expect(seen!.isLooking).toBe(false);
  });

  it("辿り終えると「この先」だけが埋まる", async () => {
    await openAt("sfen-a");
    await act(async () => {
      pending<LookupResult>(lookups, "sfen-a").settle(Ok([move("7g7f")]));
    });
    await act(async () => {
      pending<WalkResult>(walks, "sfen-a").settle(Ok([line("7g7f", 9)]));
    });

    expect(seen!.rows[0].line?.plies).toBe(9);
  });

  /**
   * **表に出ている行は、いま盤に出ている局面のもの**（`book-view.md` 不変条件1 / ※A）。
   *
   * 遅れて届いた結果を当てる変異（`cancelled` を見ない）はここで落ちる。
   * 定跡の候補手はどの局面でもそれらしく見えるので、**出てしまうと画面からは
   * 誤りだと分からない。**
   */
  it("局面が動いた後に届いた引きは捨てる", async () => {
    const view = await openAt("sfen-a");

    view.rerender(
      <BookProvider currentSfen="sfen-b">
        <Probe />
      </BookProvider>,
    );

    // 先に投げた sfen-a の引きが、局面が動いた後で返る
    await act(async () => {
      pending<LookupResult>(lookups, "sfen-a").settle(Ok([move("7g7f")]));
    });

    expect(seen!.rows).toEqual([]);

    // いまの局面の結果は出る
    await act(async () => {
      pending<LookupResult>(lookups, "sfen-b").settle(Ok([move("2g2f")]));
    });

    expect(seen!.rows.map((r) => r.move.usiMove)).toEqual(["2g2f"]);
  });

  /**
   * **遅れて届いた古い結果が、先に届いた新しい結果を消さないこと。**
   *
   * 上の「捨てる」だけでは足りない —— 行を配るところで局面を突き合わせているので、
   * 古い結果を**書いてしまっても**画面には出ない。壊れるのは、新しい結果が既に
   * 入っている後に古い結果が上書きしたとき。そのとき表は**古い行を出すのではなく、
   * 空になる**（どの局面のものでもない行として落とされる）ので、
   * 利用者からは「定跡に無い局面」と見分けが付かない。
   */
  it("先に届いた新しい結果を、遅れて届いた古い結果が上書きしない", async () => {
    const view = await openAt("sfen-a");

    view.rerender(
      <BookProvider currentSfen="sfen-b">
        <Probe />
      </BookProvider>,
    );

    await act(async () => {
      pending<LookupResult>(lookups, "sfen-b").settle(Ok([move("2g2f")]));
    });
    expect(seen!.rows.map((r) => r.move.usiMove)).toEqual(["2g2f"]);

    await act(async () => {
      pending<LookupResult>(lookups, "sfen-a").settle(Ok([move("7g7f")]));
    });

    expect(seen!.rows.map((r) => r.move.usiMove)).toEqual(["2g2f"]);
  });

  it("局面が動くと、前の局面の行は残さずに引き直す", async () => {
    const view = await openAt("sfen-a");
    await act(async () => {
      pending<LookupResult>(lookups, "sfen-a").settle(Ok([move("7g7f")]));
    });
    expect(seen!.rows).toHaveLength(1);

    view.rerender(
      <BookProvider currentSfen="sfen-b">
        <Probe />
      </BookProvider>,
    );
    await act(async () => {});

    expect(seen!.rows).toEqual([]);
    expect(seen!.isLooking).toBe(true);
  });

  /** 閉じないとハンドルとメモリが積み上がる（`book-view.md` 不変条件3） */
  it("開き直すと、前の定跡を閉じる", async () => {
    await openAt("sfen-a");
    await act(async () => {
      await seen!.openBook("/books/b.db");
    });

    expect(closed).toContain(1);
  });

  it("閉じると行も消える", async () => {
    await openAt("sfen-a");
    await act(async () => {
      pending<LookupResult>(lookups, "sfen-a").settle(Ok([move("7g7f")]));
    });

    await act(async () => {
      seen!.close();
    });

    expect(seen!.info).toBeNull();
    expect(seen!.rows).toEqual([]);
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

  it("棋譜が盤から降りると、引く先が無くなって行が消える", async () => {
    const view = await openAt("sfen-a");
    await act(async () => {
      pending<LookupResult>(lookups, "sfen-a").settle(Ok([move("7g7f")]));
    });

    view.rerender(
      <BookProvider currentSfen={null}>
        <Probe />
      </BookProvider>,
    );
    await act(async () => {});

    expect(seen!.rows).toEqual([]);
    expect(seen!.isLooking).toBe(false);
  });
});
