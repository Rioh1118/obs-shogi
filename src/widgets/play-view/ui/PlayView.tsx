import {
  useGameSession,
  type ClocksView,
  type GameSessionView,
  type Side,
} from "@/entities/game-session";
import { sideToColor, useLoadedKifuPath } from "@/entities/game";
import { turnGlyph } from "@/shared/lib/turn";
import { clockDisplay, formatClock, tickIntervalMs } from "../lib/clock";
import { useNow } from "../lib/useNow";
import { gameResultLabel, gameResultReason } from "../lib/result";
import "./PlayView.scss";

/**
 * 対局ビューの本体。**進行を持たない。**
 *
 * 持ち主は `GameSessionProvider`（`RuntimeProviders` に居る）。ここがそれを持つと、
 * タブを離れた瞬間に裁定を返す者が居なくなり、対局が `RULING_TIMEOUT` で畳まれる
 * （`docs/spec/screens/play-view.md`）。
 *
 * **盤は無い。** 盤は `AppLayout` のものが現局面で、定跡ビューが盤を外したのと同じ理由。
 */
function PlayView() {
  const { view } = useGameSession();
  const loadedKifuPath = useLoadedKifuPath();
  const now = useNow(tickIntervalMs(clocksOf(view)));

  if (view.kind === "idle") {
    return (
      <div className="play-view play-view--slate">
        <p className="play-view__lead">対局していません</p>
        <p className="play-view__sub">
          ツリーの行の時計の印か、棋譜を開いていないときの「対局する」から始められます。
          始めた対局の進行と結果がここに出ます。
        </p>
        {/*
          **出来事が届かないことを黙らない。** この状態で対局を始めると、
          手が決まっても裁定を返す者が居ないので必ずアプリの異常で畳まれる
        */}
        {view.eventsUnavailable !== null && (
          <p className="play-view__band" role="alert">
            対局の進行を受け取れません。対局を始めても進まないので、アプリを再起動してください（
            {view.eventsUnavailable}）
          </p>
        )}
      </div>
    );
  }

  if (view.kind === "starting") {
    return (
      <div className="play-view play-view--slate">
        {/*
          **「開いています」を出し続ける。** 評価関数の重いエンジンでは数十秒かかり、
          取り消す口も無い。無言で待たせると押し損ねたと読まれる
        */}
        <p className="play-view__lead" role="status">
          エンジンを起こしています…
        </p>
        <p className="play-view__sub">読み込みの重いエンジンでは時間がかかります。</p>
      </div>
    );
  }

  if (view.kind === "failed") {
    return (
      <div className="play-view play-view--slate">
        <p className="play-view__lead">対局を始められませんでした</p>
        {/*
          **原因を断言しない。** 設定の誤りと内部の取り落としが同じ形で届くので、
          「エンジンのパスを直せ」と言い切ると外れた回に行き止まる
        */}
        <p className="play-view__band" role="alert">
          {view.message}
        </p>
        {/*
          **閉じるエンジンは残っていない。** Rust は起動に失敗した対局を台帳に載せず、
          起こしたプロセスも自分で落とす。「閉じる」はこの面を片付けるだけ
        */}
        <p className="play-view__sub">
          設定を見直してから、もう一度始めてください。「閉じる」でこの面を片付けます。
        </p>
      </div>
    );
  }

  const foreign = view.kifuPath !== loadedKifuPath;

  if (view.kind === "over") {
    return (
      <div className="play-view play-view--slate">
        {foreign && <ForeignNote />}
        <p className="play-view__result">{gameResultLabel(view.result, view)}</p>
        <p className="play-view__reason">
          {gameResultReason(view.result)} ／ {view.usiMoves.length}手
        </p>
        {/*
          **終わり方を言い直さない。** どう終わったかは理由の欄が言う。
          **帯は消せない** —— 判定が投げて `endGameByRule` が通った回は理由が
          「規則による終局（判定できなかった…）」までしか言えず、
          **投げた中身を出せる欄がここしか無い**
        */}
        {view.rulingFailure !== null && (
          <p className="play-view__band" role="alert">
            アプリが裁定を返せませんでした（{view.rulingFailure}）
          </p>
        )}
        {/* **終局と一緒に消さない。** 抜けている手があることは、開き直しても分からない */}
        {view.boardFailure !== null && (
          <p className="play-view__band" role="alert">
            途中から手を棋譜へ書けていません（{view.boardFailure}）
          </p>
        )}
        {/*
          **棋譜に残っていないことを言い続ける。** 特殊手を挿す経路がまだ無いので、
          この結果は画面にしか無い（開き直すと消える）
        */}
        {/*
          **エンジンを落とせなかったことを黙らない。** 終局した時点で進行の側が
          落とすので押し直す人が居ない —— 出さないと起きたままのプロセスに気づけない
        */}
        {view.closeFailure !== null && (
          <p className="play-view__band" role="alert">
            エンジンを終了できませんでした（{view.closeFailure}）
          </p>
        )}
        <p className="play-view__sub">結果は棋譜に書けていません。</p>
      </div>
    );
  }

  return (
    <div className="play-view">
      {foreign && <ForeignNote />}
      {/*
        **「中断されます」と書かない。** その語は利用者が中断を押したときのもので
        （ADR-0011 決定1）、ここで待っている終局は理由が「アプリの異常」になる
      */}
      {view.rulingFailure !== null && (
        <p className="play-view__band" role="alert">
          裁定を返せませんでした。このままだと「アプリの異常」で終局します（{view.rulingFailure}）
        </p>
      )}
      {/*
        **対局が止まっていないことを先に言う。** 止まったのは棋譜だけで、
        エンジンは指し続ける。「失敗しました」だけを出すと、
        対局そのものが壊れたと読んで中断されてしまう
      */}
      {view.boardFailure !== null && (
        <p className="play-view__band" role="alert">
          手を棋譜へ書けていません。対局は続いていますが、この先の手は棋譜に残りません（
          {view.boardFailure}）
        </p>
      )}

      <div className="play-view__seats">
        <Seat
          side="white"
          name={view.whiteName}
          clocks={view.clocks}
          toMove={view.toMove}
          now={now}
        />
        <Seat
          side="black"
          name={view.blackName}
          clocks={view.clocks}
          toMove={view.toMove}
          now={now}
        />
      </div>

      <p className="play-view__progress">
        {view.usiMoves.length}手
        {view.awaitingRuling && <span className="play-view__pending">裁定中</span>}
      </p>
    </div>
  );
}

/** 席1つ。**上が後手・下が先手**で盤の並びに合わせる */
function Seat({
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
    <div className={`play-view__seat ${toMove === side ? "play-view__seat--turn" : ""}`}>
      <span className="play-view__side">{turnGlyph(sideToColor(side))}</span>
      <span className="play-view__name" title={name}>
        {name}
      </span>
      {/*
        **最初のイベントが届くまでは数字を出さない。** 0 で埋めると
        「時間切れ寸前の対局」として描かれる
      */}
      <span className="play-view__clock">
        {display === null ? "—" : formatClock(display.mainMs)}
      </span>
      <span className="play-view__byoyomi">
        {display === null || display.byoyomiMs === 0 ? "" : formatClock(display.byoyomiMs)}
      </span>
    </div>
  );
}

/**
 * 盤に出ている棋譜と、対局の棋譜が違うときの一言。
 *
 * **対局は棋譜が入れ替わっても走り続ける**ので、別の棋譜を開いている間も
 * このビューには前の対局が出る。黙って出すと、いま見ている棋譜の対局に見える。
 */
function ForeignNote() {
  return (
    <p className="play-view__band play-view__band--note">
      いま盤に出ている棋譜の対局ではありません
    </p>
  );
}

/** 時計を持っている状態だけが持つ。**描き直す間隔はこれで決まる** */
function clocksOf(view: GameSessionView): ClocksView | null {
  if (view.kind === "live") return view.clocks;
  if (view.kind === "over") return view.clocks;
  return null;
}

export default PlayView;
