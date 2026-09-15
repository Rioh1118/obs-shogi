import { useCallback, useState } from "react";

import { useGameSession, type GameId } from "@/entities/game-session";
import Button from "@/shared/ui/Button/Button";
import ButtonGroup from "@/shared/ui/Form/ButtonGroup";
import Modal from "@/shared/ui/Modal";

import { gameResultLabel, gameResultReason } from "../lib/result";
import "./GameOverModal.scss";

/**
 * 終局を知らせる面。
 *
 * **出来事で開く。URL には出さない。** 対局の終わりは `game-event` で届く一度きりの
 * 出来事で、再読み込みしても同じ状態には戻らない（走っていた対局が居ない）。
 * `modal=` に載せると**開けない面を指す URL**が残る。
 * 状態から開く対話は既にこの層に居る（`FileConflictDialog` / `KifuReadErrorDialog`）。
 *
 * **エンジンを落とす口をここにも置く。** 終局は探索を畳まないので、`close_game` を
 * 通すまでプロセスは起きたまま。押す場所がドックの対局タブにしか無いと、
 * **タブを開いていない人は終局に気づかないまま**エンジンを残す。
 *
 * **`failed` は出さない。** 始め損ねた対局は落とす相手が居ないうえ、
 * 押した直後の `modal=game-start` の上に重なる（断りは V4 の帯が出す）。
 *
 * **`GameSessionProvider` の内側に置くこと**（`useGameSession` を読む）。
 */
export function GameOverModal() {
  const { view, closeSession } = useGameSession();

  /**
   * 見終わった対局。**`gameId` で控える。**
   *
   * 真偽で持つと、次の対局が終わったときに**下ろしたままの旗**が残って
   * 2局目以降の終局が一度も出ない。
   */
  const [dismissed, setDismissed] = useState<GameId | null>(null);
  const [pending, setPending] = useState(false);
  /** 閉じられなかった理由。**押した場所に返す**（他に出す場がない） */
  const [refusal, setRefusal] = useState<string | null>(null);

  const close = useCallback(() => {
    setRefusal(null);
    setPending(true);
    // **結果を控えてから読む。** `void closeSession().then(...)` と続けて書くと、
    // 戻り値の読み落としを見る走査が「読まずに撃った」形として拾う（`.then` を見ていない）
    const closed = closeSession();

    void closed.then((result) => {
      setPending(false);
      // **成功したら何も消さない。** 対局が `idle` になるとこの面ごと消える
      if (!result.success) setRefusal(result.error);
    });
  }, [closeSession]);

  const over = view.kind === "over" ? view : null;
  if (over === null || over.gameId === dismissed) return null;

  /** 盤を見る。**対局は `over` のまま残す**（エンジンはドックの「閉じる」で落とせる） */
  const dismiss = () => {
    if (!pending) setDismissed(over.gameId);
  };

  return (
    <Modal
      onClose={dismiss}
      label="対局が終わりました"
      theme="dark"
      variant="dialog"
      size="sm"
      scroll="none"
    >
      <div className="game-over">
        <p className="game-over__result">{gameResultLabel(over.result, over)}</p>
        <p className="game-over__reason">
          {gameResultReason(over.result)} ／ {over.usiMoves.length}手
        </p>

        {/*
          **裁定を返せなかったことを終局と一緒に消さない。** 畳まれた対局の理由は
          利用者の中断と同じ値で届く（#362）ので、消すと「アプリが裁定を返せなかった」を
          言える欄が1つも無くなる
        */}
        {over.rulingFailure !== null && (
          <p className="game-over__band" role="alert">
            アプリが裁定を返せなかったため中断されました（{over.rulingFailure}）
          </p>
        )}
        {over.boardFailure !== null && (
          <p className="game-over__band" role="alert">
            途中から手を棋譜へ書けていません（{over.boardFailure}）
          </p>
        )}

        {/* **棋譜に残っていないことを言い続ける。** この結果は画面にしか無い（#115） */}
        <p className="game-over__sub">結果は棋譜に書けていません。</p>

        {refusal !== null && (
          <p className="game-over__band" role="alert">
            {refusal}
          </p>
        )}

        {/*
          **投げている間は両方沈める。** 「閉じる」は探索を畳めないエンジンで
          十数秒かかるのに画面が変わらないので、効いていないと読んで押し直され、
          2発目の断り（英文と UUID）が成功した1発目の上に貼り付く
        */}
        <ButtonGroup>
          <Button
            type="button"
            tone="primary"
            onClick={close}
            isLoading={pending}
            disabled={pending}
          >
            {pending ? "閉じています..." : "閉じる"}
          </Button>
          <Button type="button" onClick={dismiss} disabled={pending}>
            盤を見る
          </Button>
        </ButtonGroup>

        <p className="game-over__sub">
          「盤を見る」を選ぶと、エンジンは起きたまま残ります（対局タブの「閉じる」で落とせます）。
        </p>
      </div>
    </Modal>
  );
}

export default GameOverModal;
