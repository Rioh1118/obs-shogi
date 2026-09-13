import { FolderOpen, X } from "lucide-react";
import { bookFileName, useBook } from "@/entities/book";
import { useBookOpening } from "../model/useBookOpening";
import "./BookControls.scss";

/**
 * 定跡ビューの操作列。**ドックのタブ列の下の段に出る。**
 *
 * 左が「いま何を開いているか」、右が開く／閉じる。
 *
 * **収録局面数に「全部」と読ませない。** 出しているのは*定跡が持っている局面の数*で、
 * *この局面の候補手の数*でも*読み切った数*でもない
 * （→ `docs/state-transitions/book-view.md` 不変条件4）。
 *
 * 記号は `lucide-react` から取る（このリポジトリの図案はすべてそこ）。
 */
function BookControls() {
  const { info, view, close } = useBook();
  const { browse } = useBookOpening();
  const isOpening = view.kind === "opening";

  return (
    <div className="book-controls">
      <div className="book-controls__status">
        {/*
          **開いている最中を「開いていません」と言わない。** `open_book` は上限も
          進捗も中断も持たない（#197）ので、GB 級では数分このままになる。
          その間ずっと事実でない一文を出していると、押し損ねたと読まれる。

          **一文と `role="status"` は本体の側だけ**（`BookView` の `__busy`）。
          両方に置くと同じ文が上下に並び、live region が2つ同じ段に居ることになる。
          ここは他の状態と同じく「いま何を開いているか」だけを出す
        */}
        {view.kind === "opening" ? (
          <span className="book-controls__busy" title={view.path}>
            {bookFileName(view.path)}
          </span>
        ) : info === null ? (
          <span className="book-controls__idle">定跡を開いていません</span>
        ) : (
          <>
            <span className="book-controls__name" title={info.path}>
              {bookFileName(info.path)}
            </span>
            <span className="book-controls__count">{positionCount(info.positionCount)}</span>
            {/*
              **読み損ねた欄があることを言い続ける。** 0 でないなら、表の
              評価値・深さ・出現回数の `—` は「もともと無い」ではなく「読み損ねた」
            */}
            {info.droppedFields !== null && info.droppedFields > 0 && (
              <span
                className="book-controls__dropped"
                title="欄がずれている行がある。表の「—」は、もともと無いのか読み損ねたのかを区別できない"
              >
                読めない欄 {info.droppedFields.toLocaleString()}
              </span>
            )}
          </>
        )}
      </div>

      <div className="book-controls__actions" role="group" aria-label="定跡">
        <button
          type="button"
          className="book-controls__iconBtn"
          onClick={() => void browse()}
          disabled={isOpening}
          title="定跡を開く"
        >
          <FolderOpen className="book-controls__icon" />
        </button>
        <button
          type="button"
          className="book-controls__iconBtn"
          onClick={close}
          disabled={info === null && !isOpening}
          title={isOpening ? "開くのをやめる" : "定跡を閉じる"}
        >
          <X className="book-controls__icon" />
        </button>
      </div>
    </div>
  );
}

/**
 * 収録局面数の表示。
 *
 * **数えられない形式は `null`。** 0 は「本当に0局面」なので、同じ綴りにすると
 * 局面数の書かれていない定跡が「空の定跡」に見える。
 */
function positionCount(count: number | null): string {
  return count === null ? "局面数は数えられない形式" : `${count.toLocaleString()} 局面`;
}

export default BookControls;
