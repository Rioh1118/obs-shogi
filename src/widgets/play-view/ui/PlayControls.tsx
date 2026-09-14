import { Flag, Square, X } from "lucide-react";
import { useGameSession, type Side } from "@/entities/game-session";
import { gameResultReason } from "../lib/result";
import "./PlayControls.scss";

/**
 * 対局ビューの操作列。**ドックのタブ列の下の段に出る。**
 *
 * 左が「いまどうなっているか」、右が投了・中断・閉じる。
 * **指す操作はここに無い** —— 着手は盤で行う。
 *
 * **押せなくなっても消さない。** 消すと押しどころが状態ごとに動く。
 *
 * **投了を色で示さない。** 暗い面に置ける危険色（`$color-danger-text`）は
 * 暗いカード（#1c2325）に合わせて決めてあり、この段の面では基準を割る。
 * 取り消せない操作であることは、旗の記号と `title` の文言が持つ。
 *
 * 記号は `lucide-react` から取る（このリポジトリの図案はすべてそこ）。
 */
function PlayControls() {
  const { view, resign, abort, close } = useGameSession();

  const live = view.kind === "live";
  // **人が座っている席が1つだけのときしか投げられない。** どちらも人なら
  // 「誰が投了したのか」を選ばせる必要があり、その口をまだ持っていない
  const resignable: Side | null = live && view.humanSides.length === 1 ? view.humanSides[0] : null;

  return (
    <div className="play-controls">
      <div className="play-controls__status">{statusText(view)}</div>

      <div className="play-controls__actions" role="group" aria-label="対局">
        <button
          type="button"
          className="play-controls__iconBtn"
          onClick={() => resignable !== null && void resign(resignable)}
          disabled={resignable === null}
          title={resignTitle(live, resignable)}
        >
          <Flag className="play-controls__icon" />
        </button>
        <button
          type="button"
          className="play-controls__iconBtn"
          onClick={() => void abort()}
          disabled={!live}
          title="対局を中断する（勝敗は付きません）"
        >
          <Square className="play-controls__icon" />
        </button>
        <button
          type="button"
          className="play-controls__iconBtn"
          onClick={() => void close()}
          disabled={view.kind !== "over" && view.kind !== "failed"}
          title="対局を閉じてエンジンを落とす"
        >
          <X className="play-controls__icon" />
        </button>
      </div>
    </div>
  );
}

/** 沈んでいる理由を名乗る。**「押せない」だけを出さない** */
function resignTitle(live: boolean, resignable: Side | null): string {
  if (resignable !== null) return "投了する";
  return live ? "人が座っている席が1つのときだけ投了できます" : "対局中だけ投了できます";
}

function statusText(view: ReturnType<typeof useGameSession>["view"]): string {
  switch (view.kind) {
    case "idle":
      return "対局していません";
    case "starting":
      return "エンジンを起こしています…";
    case "failed":
      return "始められませんでした";
    case "over":
      return `終局 ／ ${gameResultReason(view.result)}`;
    case "live":
      return view.awaitingRuling
        ? "裁定中"
        : `${view.toMove === "black" ? "▲先手" : "△後手"}の手番`;
  }
}

export default PlayControls;
