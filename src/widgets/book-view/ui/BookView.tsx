import { useState, type ReactNode } from "react";
import {
  bookFileName,
  bookNoticeTier,
  DEFAULT_BOOK_SORT,
  useBook,
  type BookFailure,
  type BookSort,
  type BookViewState,
} from "@/entities/book";
import { useAppConfig } from "@/entities/app-config";
import { useEnginePresets } from "@/entities/engine-presets/model/useEnginePresets";
import { useGame } from "@/entities/game";
import InlineNotice from "@/shared/ui/notification/InlineNotice";
import { bookOpenTargets } from "../lib/openTargets";
import { useBookOpening } from "../model/useBookOpening";
import BookEmpty from "./BookEmpty";
import BookTable from "./BookTable";
import "./BookView.scss";

/**
 * 定跡ビューの本体。**ドックのタブの1枚**（ADR-0010）。
 *
 * **盤を持たない。** 盤は AppLayout のものが現局面で、ここが出すのはその局面に
 * 対する指し手の一覧。「その手の先も定跡にあるか」は2枚目の盤ではなく列で出す
 * （→ `docs/spec/features/book.md`）。
 *
 * 開いている定跡と引いた行は `BookProvider` が持つ。置き場の制約は
 * `app/providers/gates/BookPositionGate.tsx` の doc。
 */
function BookView() {
  const { info, view, failure } = useBook();
  const { view: gameView, state: gameState } = useGame();
  const { config } = useAppConfig();
  const { state: presetsState } = useEnginePresets();
  const { open, browse } = useBookOpening();

  // 並べ替えは**この画面の持ち物**。局面を跨いで保つが、設定には残さない ——
  // 「いま何で並べて見ているか」は作業中の視点であって、恒久的な構成ではない
  const [sort, setSort] = useState<BookSort>(DEFAULT_BOOK_SORT);

  const preset = presetsState.presets.find((p) => p.id === presetsState.selectedPresetId) ?? null;
  const targets = bookOpenTargets({
    // **`bookEnabled` が偽なら出さない。** 綴りは残っていても、そのプリセットは
    // エンジンに定跡を食わせていない
    presetBookPath: preset?.bookEnabled ? preset.bookFilePath : null,
    presetName: preset?.label ?? null,
    recents: config?.book_recent_paths,
    openPath: info?.path ?? null,
  });

  const table = (empty: string, rows: Parameters<typeof BookTable>[0]["rows"] = []) => (
    <BookTable
      rows={rows}
      sfen={gameView.currentSfen}
      baseTesuu={gameState.cursor?.tesuu ?? 0}
      sort={sort}
      onSort={setSort}
      empty={empty}
    />
  );

  /**
   * **1つの値から出す。** 真偽値を並べると、引くのに失敗した回に
   * 「この局面はこの定跡にありません」と断言する形が作れてしまう。
   */
  const body = (state: BookViewState): ReactNode => {
    switch (state.kind) {
      case "closed":
        return (
          <BookEmpty
            fromPreset={targets.fromPreset}
            recent={targets.recent}
            onOpen={(path) => void open(path)}
            onBrowse={() => void browse()}
          />
        );

      case "opening":
        // **何を開いているかを出す。** GB 級は数分返らないので、
        // 無効になったボタンだけでは、押し損ねたと読まれる
        return (
          <p className="book-view__busy" role="status">
            {bookFileName(state.path)} を開いています…
          </p>
        );

      case "noPosition":
        return table("盤に局面がありません。棋譜を開くと、その局面の候補手が出ます");

      case "looking":
        return table("引いています…");

      case "absent":
        return table("この局面はこの定跡にありません");

      // **「載っていない」と混ぜない。** 引けていないので、定跡の中身は分からない
      case "unavailable":
        return table("この局面は引けませんでした");

      case "rows":
        return table("", state.rows);
    }
  };

  return (
    <section className="book-view">
      {/*
        **本体を消さずに添える。** 先を辿るのに失敗しても候補手は引けているので、
        表ごと消すと読める行まで見えなくなる。閉じる口は持たない（`InlineNotice` の doc）
      */}
      {failure && (
        <div className="book-view__notice">
          <InlineNotice
            tier={bookNoticeTier(failure)}
            title={NOTICE_TITLES[failure.origin]}
            body={
              failure.error.path
                ? `${failure.error.message}（${failure.error.path}）`
                : failure.error.message
            }
          />
        </div>
      )}

      {body(view)}
    </section>
  );
}

/**
 * 失敗の題。**落ちた操作から引く。画面の状態からは引かない。**
 *
 * 状態から引くと、行が並んでいるところで定跡を開き損ねた回に
 * 「定跡の先を辿れませんでした」が付き、**題と本文が1つの帯の中で食い違う。**
 *
 * **`Record` なので、綴りを足して題を足さないと tsc が落ちる。**
 */
const NOTICE_TITLES: Record<BookFailure["origin"], string> = {
  open: "定跡を開けませんでした",
  lookup: "この局面を引けませんでした",
  // 引けてはいるので「読めませんでした」と言わない。落ちたのは先を辿る側だけ
  walk: "定跡の先を辿れませんでした",
  external: "定跡の操作を開始できませんでした",
};

export default BookView;
