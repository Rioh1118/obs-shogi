import { useState } from "react";
import { bookNoticeTier, DEFAULT_BOOK_SORT, useBook, type BookSort } from "@/entities/book";
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
 * 開いている定跡と引いた行は `BookProvider` が持つ。**この画面は持たない** ——
 * 持つと、別のタブへ移るたびに定跡が閉じて開き直される
 * （→ `docs/state-transitions/book-view.md` ※B）。
 */
function BookView() {
  const { info, rows, isLooking, error } = useBook();
  const { view: gameView, state: gameState } = useGame();
  const { config } = useAppConfig();
  const { state: presetsState } = useEnginePresets();
  const { open, browse, isOpening } = useBookOpening();

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

  return (
    <section className="book-view">
      {/*
        **表を消さずに添える。** 先を辿るのに失敗しても候補手は引けているので、
        表ごと消すと読める行まで見えなくなる。閉じる口は持たない
        （`InlineNotice` の doc）
      */}
      {error && (
        <div className="book-view__notice">
          <InlineNotice
            tier={bookNoticeTier(error.code)}
            title="定跡を読めませんでした"
            body={error.path ? `${error.message}（${error.path}）` : error.message}
          />
        </div>
      )}

      {info === null ? (
        <BookEmpty
          fromPreset={targets.fromPreset}
          recent={targets.recent}
          disabled={isOpening}
          onOpen={(path) => void open(path)}
          onBrowse={() => void browse()}
        />
      ) : (
        <BookTable
          rows={rows}
          sfen={gameView.currentSfen}
          baseTesuu={gameState.cursor?.tesuu ?? 0}
          sort={sort}
          onSort={setSort}
          empty={isLooking ? "引いています…" : "この局面はこの定跡にありません"}
        />
      )}
    </section>
  );
}

export default BookView;
