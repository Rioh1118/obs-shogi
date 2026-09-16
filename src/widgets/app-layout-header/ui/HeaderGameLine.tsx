import {
  clockDisplay,
  clocksOf,
  formatClock,
  isForeignKifuSession,
  liveGameOf,
  tickIntervalMs,
  useGameSession,
  useNow,
  type ClocksView,
  type Side,
} from "@/entities/game-session";
import { sideToColor, useLoadedKifuPath } from "@/entities/game";
import { turnGlyph } from "@/shared/lib/turn";

/**
 * ヘッダの「対局の行」。**走っている対局の残り時間を、どのタブを開いていても出す。**
 *
 * ドックのタブは1度に1枚しか出ない（ADR-0010）ので、時計をタブに置く限り
 * 「解析を見ながら残り時間を知る」ができない。時計は対局が走っている間
 * **常に見えているべき値**で、それはヘッダの性質（ADR-0011 決定2）。
 *
 * **進行は持たない。** 持ち主は `GameSessionProvider`（`RuntimeProviders` に居る）。
 */
function HeaderGameLine() {
  const { view } = useGameSession();
  const loadedKifuPath = useLoadedKifuPath();
  // **動いている時計があるときだけ毎秒描く。** 止まっている時計のために
  // 起こしても出る文字は変わらない。**narrowing より前に呼ぶ**（フックの順）
  const now = useNow(tickIntervalMs(clocksOf(view)));

  const game = liveGameOf(view);
  if (game === null) return null;

  return (
    <div className="app-header__game">
      {/*
        **上が後手・下が先手**という席の並び（`PlayView`）を横に倒したもの。
        左から後手・先手で、盤の並びと同じ向きに読める
      */}
      <GameClock
        side="white"
        name={game.whiteName}
        clocks={game.clocks}
        toMove={game.toMove}
        now={now}
      />
      <span className="app-header__divider" aria-hidden="true" />
      <GameClock
        side="black"
        name={game.blackName}
        clocks={game.clocks}
        toMove={game.toMove}
        now={now}
      />
      {/*
        **行が自分で印を出す。** 対局は棋譜が入れ替わっても走り続けるので、
        別の棋譜を開いている間もこの行は対局の時計を出し続ける。
        黙って出すと、いま盤に出ている棋譜の対局に見える。
        説明の本文は対局タブの帯が持つ（ここは行1つに収める）
      */}
      {isForeignKifuSession(view, loadedKifuPath) && (
        <span className="app-header__game-foreign" title="いま盤に出ている棋譜の対局ではありません">
          別の棋譜
        </span>
      )}
    </div>
  );
}

/**
 * 片側の名前と時計。
 *
 * **手番の印は `toMove` から引く。** 時計の動きを流用すると、裁定待ちや畳み待ちで
 * `running` が `null` になる窓（`ClocksView.running` の doc）で手番が消える。
 */
function GameClock({
  side,
  name,
  clocks,
  toMove,
  now,
}: {
  side: Side;
  name: string;
  clocks: ClocksView | null;
  toMove: Side;
  now: number;
}) {
  const display = clocks === null ? null : clockDisplay(clocks, side, now);

  return (
    <span
      className={`app-header__game-side ${toMove === side ? "app-header__game-side--turn" : ""}`}
    >
      <span className="app-header__game-glyph">{turnGlyph(sideToColor(side))}</span>
      {/*
        **名前だけが譲る。** 高さが行1つぶんに固定なので折り返しは選べず、
        折り返せば時計が枠の外に落ちる —— 「常に見えているべき値」という
        この行の存在理由が死ぬ
      */}
      <span className="app-header__game-name" title={name}>
        {name}
      </span>
      {/*
        **最初のイベントが届くまでは数字を出さない。** 0 で埋めると
        「時間切れ寸前の対局」として描かれる
      */}
      <span className="app-header__game-clock">
        {display === null ? "—" : formatClock(display.mainMs)}
      </span>
      <span className="app-header__game-byoyomi">
        {display === null || display.byoyomiMs === 0 ? "" : formatClock(display.byoyomiMs)}
      </span>
    </span>
  );
}

export default HeaderGameLine;
