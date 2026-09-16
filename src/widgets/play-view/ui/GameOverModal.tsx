import { useState } from "react";

import { useGameSession, type GameId } from "@/entities/game-session";
import { sideToColor } from "@/entities/game";
import { turnLabel } from "@/shared/lib/turn";
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
 * **出すのは結末と、閉じる口ひとつだけ。** エンジンを落とすのは進行の側の仕事で
 * （終局した時点で自分で落とす）、ここに置くと**利用者が押すまでプロセスが残る**。
 * 口を2つ並べると、**どちらが何を畳むのか**——この面だけか、対局ごとか——が
 * 押す前に読めない。畳む対象が1つしか無いなら、選ばせる理由も無い。
 *
 * **`failed` は出さない。** 始め損ねた対局は落とす相手が居ないうえ、
 * 押した直後の `modal=game-start` の上に重なる（断りは V4 の帯が出す）。
 *
 * **`GameSessionProvider` の内側に置くこと**（`useGameSession` を読む）。
 */
export function GameOverModal() {
  const { view } = useGameSession();

  /**
   * 見終わった対局。**`gameId` で控える。**
   *
   * 真偽で持つと、次の対局が終わったときに**下ろしたままの旗**が残って
   * 2局目以降の終局が一度も出ない。
   */
  const [dismissed, setDismissed] = useState<GameId | null>(null);

  const over = view.kind === "over" ? view : null;
  if (over === null || over.gameId === dismissed) return null;

  /** 閉じる。**畳むのはこの面だけ** —— 結末は対局タブに残り、盤はそのまま触れる */
  const dismiss = () => setDismissed(over.gameId);

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

        {/* 席2つ。**盤の並びに合わせて上が後手** */}
        <dl className="game-over__seats">
          <div className="game-over__seat">
            <dt>{turnLabel(sideToColor("white"))}</dt>
            <dd>{over.whiteName}</dd>
          </div>
          <div className="game-over__seat">
            <dt>{turnLabel(sideToColor("black"))}</dt>
            <dd>{over.blackName}</dd>
          </div>
        </dl>

        {/*
          **終わり方を言い直さない。** どう終わったかは理由の欄が言う。
          **帯は消せない** —— 判定が投げて `endGameByRule` が通った回は理由が
          「規則による終局（判定できなかった…）」までしか言えず、
          **投げた中身を出せる欄がここしか無い**
        */}
        {over.rulingFailure !== null && (
          <p className="game-over__band" role="alert">
            アプリが裁定を返せませんでした（{over.rulingFailure}）
          </p>
        )}
        {over.boardFailure !== null && (
          <p className="game-over__band" role="alert">
            途中から手を棋譜へ書けていません（{over.boardFailure}）
          </p>
        )}

        {/*
          **エンジンを落とせなかったことを黙らない。** 落とすのは進行の側で、
          押し直す利用者が居ない —— 出さないと起きたままのプロセスに気づけない
        */}
        {over.closeFailure !== null && (
          <p className="game-over__band" role="alert">
            エンジンを終了できませんでした（{over.closeFailure}）
          </p>
        )}

        {/* **棋譜に残っていないことを言い続ける。** この結果は画面にしか無い（#115） */}
        <p className="game-over__sub">結果は棋譜に書けていません。閉じると棋譜を並べ直せます。</p>

        <ButtonGroup>
          <Button type="button" tone="primary" onClick={dismiss}>
            閉じる
          </Button>
        </ButtonGroup>
      </div>
    </Modal>
  );
}

export default GameOverModal;
