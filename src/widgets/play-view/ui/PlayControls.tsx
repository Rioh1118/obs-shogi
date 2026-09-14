import { useEffect, useState } from "react";
import { Flag, Square, X } from "lucide-react";
import { useGameSession, type GameSessionView, type Side } from "@/entities/game-session";
import type { AsyncResult } from "@/shared/lib/result";
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
  const { view, resign, abort, closeSession } = useGameSession();

  /**
   * 押した操作が断られたときの文言。
   *
   * **ここに出す。** 断られた操作は状態を1つも動かさないので、
   * 対局の状態を描く帯（`PlayView`）には出る場がない —— 押した本人に、
   * 押した場所で返す。
   */
  const [refusal, setRefusal] = useState<string | null>(null);

  // 状態が動いたなら、前の断りはもう当てはまらない
  useEffect(() => {
    setRefusal(null);
  }, [view.kind]);

  const run = (action: () => AsyncResult<void>) => {
    void action().then((result) => {
      setRefusal(result.success ? null : result.error);
    });
  };

  const live = view.kind === "live";
  // **人が座っている席が1つだけのときしか投げられない。** どちらも人なら
  // 「誰が投了したのか」を選ばせる必要があり、その口をまだ持っていない
  const resignable: Side | null = live && view.humanSides.length === 1 ? view.humanSides[0] : null;
  const closable = view.kind === "over" || view.kind === "failed";

  return (
    <div className="play-controls">
      <div className="play-controls__status">
        {refusal === null ? (
          statusText(view)
        ) : (
          <span className="play-controls__refusal" role="alert">
            {refusal}
          </span>
        )}
      </div>

      <div className="play-controls__actions" role="group" aria-label="対局">
        <button
          type="button"
          className="play-controls__iconBtn"
          onClick={() => resignable !== null && run(() => resign(resignable))}
          disabled={resignable === null}
          title={resignTitle(live, resignable)}
        >
          <Flag className="play-controls__icon" />
        </button>
        <button
          type="button"
          className="play-controls__iconBtn"
          onClick={() => run(abort)}
          disabled={!live}
          title="対局を中断する（勝敗は付きません）"
        >
          <Square className="play-controls__icon" />
        </button>
        <button
          type="button"
          className="play-controls__iconBtn"
          onClick={() => run(closeSession)}
          disabled={!closable}
          title={closeTitle(view)}
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

/**
 * 「閉じる」の名乗り。**始め損ねた対局には落とすエンジンが居ない**
 * （Rust は起動に失敗した対局を台帳に載せず、プロセスも自分で落とす）ので、
 * そこで「エンジンを落とす」と名乗ると嘘になる。
 */
function closeTitle(view: GameSessionView): string {
  switch (view.kind) {
    case "over":
      return "対局を閉じてエンジンを落とす";
    case "failed":
      return "この対局を片付けて、やり直せるようにする";
    default:
      return "終局してから閉じられます";
  }
}

function statusText(view: GameSessionView): string {
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
