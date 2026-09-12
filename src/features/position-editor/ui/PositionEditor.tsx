import { useCallback, useEffect, useMemo, useState, type MutableRefObject } from "react";
import { Color } from "shogi.js";
import { DEFAULT_HANDICAP, type HandicapPreset } from "@/entities/kifu/model/handicap";
import { inspectPosition } from "@/entities/position/lib/inspectPosition";
import {
  pieceAt,
  stateFromPreset,
  stateFromSfen,
  type Square,
} from "@/entities/position/lib/positionDraft";
import type { StudyPosition } from "@/entities/study-positions/model/types";
import ConfirmDialog from "@/shared/ui/ConfirmDialog";
import { usePositionDraft } from "../model/usePositionDraft";
import EditorBoard from "./EditorBoard";
import EditorGhost from "./EditorGhost";
import EditorCreateForm from "./EditorCreateForm";
import EditorNotice from "./EditorNotice";
import EditorSeed from "./EditorSeed";
import EditorStand from "./EditorStand";
import EditorStudyPicker from "./EditorStudyPicker";
import EditorTurn from "./EditorTurn";
import "./PositionEditor.scss";

/** 組む面のどちらが出ているか。インポートの面は器（`create-file`）が持つ */
export type EditorFace = "board" | "study";

interface PositionEditorProps {
  /** いま出ている面。**器が1つの変数で持つ**ので、ここでは受け取るだけ */
  face: EditorFace;
  onFaceChange: (face: EditorFace) => void;
  /**
   * 器が別のタブを出しているあいだ
   *
   * **外さずに隠す。** 外すと組みかけが確認を1つも通さずに消える
   * （状態遷移表の I×X9「組んだものは残る」）。掴んだままにもしない ——
   * 隠れているあいだに掴みが残ると、戻ってきた盤が B1/B2 で始まる。
   */
  hidden?: boolean;
  /**
   * 作成中かどうかを器へ知らせる
   *
   * 器はこのあいだタブを沈める（状態遷移表の W は X9 を受け付けない）。
   * 沈めないと、送信の途中で面が外れて**失敗が出る場所ごと消える**。
   */
  onSubmittingChange?: (submitting: boolean) => void;
  /** ツリーから開いたときの保存先。ようこそ画面から開くと来ない */
  initialDir?: string;
  /** 作成が通ったとき。器を閉じるのは器の仕事 */
  onCreated?: () => void;
  /**
   * 器を閉じてよいか、器がこの面に問うための門
   *
   * **閉じる口は3つある**（Esc・覆いの押下・「やめる」）。段を面の中だけで持つと、
   * 焦点が面の外にある経路と覆いの押下が素通りして、**組みかけが確認なしに消える**。
   * 器が1つの口（`Modal` の `onClose`）へ寄せ、そこからここを通す。
   *
   * `true` を返したら面が引き取った（確認を出したか、止めた）。
   */
  closeGuard?: MutableRefObject<(() => boolean) | null>;
  /** 確認を通したうえで実際に閉じる */
  onClose?: () => void;
  /** 種にできる課題局面。provider はこの面から読まない */
  studyPositions?: StudyPosition[];
}

/**
 * 初期局面を組む面
 *
 * **置き場は盤と駒台2つの3つだけ。** 駒箱を持たないので、駒の顔ぶれは種が決める
 * （→ #548）。3つに閉じると、玉3枚・駒余り・歩19枚が構造的に作れない。
 *
 * 駒台は**盤の左右**に置き、後手を盤の上端、先手を下端に揃える（対局中の盤と同じ位置）。
 * 中央に揃えると、どちらの駒台かが位置から読めなくなる。
 *
 * 開いた瞬間は平手。**空盤から始めない** —— 駒箱が無いので、空盤に置くと
 * そこから駒を1枚も足せない。
 */
function PositionEditor({
  face,
  onFaceChange,
  hidden = false,
  studyPositions = [],
  initialDir,
  onCreated = () => undefined,
  closeGuard,
  onClose = () => undefined,
  onSubmittingChange,
}: PositionEditorProps) {
  const {
    state,
    held,
    pressSquare,
    pressStand,
    flipSquare,
    toggleTurn,
    release,
    loadSeed,
    isDirty,
  } = usePositionDraft(() => stateFromPreset(DEFAULT_HANDICAP));

  // 作成中は Esc の段の**外**にある（止められないので無視する）。
  // 旗をここへ上げるのは、段を判定するのがこの面だから
  const [isSubmitting, setIsSubmitting] = useState(false);
  const reportSubmitting = useCallback(
    (submitting: boolean) => {
      setIsSubmitting(submitting);
      onSubmittingChange?.(submitting);
    },
    [onSubmittingChange],
  );

  // 隠れているあいだは掴みを持ち越さない（状態遷移表の B1/B2 × X9「掴みを離す」）
  useEffect(() => {
    if (hidden) release();
  }, [hidden, release]);

  /**
   * 組みかけを捨てる確認
   *
   * **組みかけのときだけ出す。** 種を選び直すときも閉じるときも同じ。
   * 聞きすぎると、聞かれること自体が意味を失う。
   */
  const [pending, setPending] = useState<{ subtitle: string; run: () => void } | null>(null);

  /** 組みかけなら確認してから実行する */
  const confirmIfDirty = useCallback(
    (subtitle: string, run: () => void) => {
      if (!isDirty) {
        run();
        return;
      }
      setPending({ subtitle, run });
    },
    [isDirty],
  );

  // ホバーは局面ではなく見ている場所。`usePositionDraft` に混ぜると、
  // ポインタを動かすたびに組みかけの判定が走る
  const [hovered, setHovered] = useState<Square | null>(null);

  // 最後に載せた手合割。**組みかけになったら忘れる**（プレースホルダへ戻す）ので、
  // 局面そのものからは引けない
  const [handicap, setHandicap] = useState<HandicapPreset | null>(DEFAULT_HANDICAP);

  // 局面が変わったときだけ数え直す。`inspectPosition` は 81 升を7周以上なめる
  // （空盤・二歩は先後で2周・行き所のない駒・玉の枚数を2周・玉の位置・王手の判定）ので、
  // ポインタを動かすたびに走らせない
  const inspection = useMemo(() => inspectPosition(state), [state]);

  const pickHandicap = useCallback(
    (preset: HandicapPreset) => {
      confirmIfDirty("別の手合割を載せると、いま組んでいる局面は消えます。", () => {
        loadSeed(stateFromPreset(preset));
        setHandicap(preset);
      });
    },
    [confirmIfDirty, loadSeed],
  );

  /**
   * 課題局面の面へ移る
   *
   * **掴んでいる駒は離す。** 掴んだまま移れると `face === "study"` かつ
   * `held !== null` という、状態の表に無い組み合わせができる。そこで Esc を押すと
   * 段2（離す）が段3（盤へ戻る）より先に効くのに、**掴んでいること自体が画面に出ていない**
   * （ゴーストは盤の面でしか描かない）ので、押しても何も起きないように見える。
   */
  const openStudyPositions = useCallback(() => {
    release();
    onFaceChange("study");
  }, [release, onFaceChange]);

  const useStudyPosition = useCallback(
    (position: StudyPosition) => {
      const seed = stateFromSfen(position.sfen);
      // 読めない SFEN は種にしない。黙って盤へ戻すと、種が変わっていないのに
      // 別の局面が載ったように見える。面に留めれば、その行が選べないことが画面から読める
      if (!seed) return;

      confirmIfDirty("この課題局面を載せると、いま組んでいる局面は消えます。", () => {
        loadSeed(seed);
        setHandicap(null);
        onFaceChange("board");
      });
    },
    [confirmIfDirty, loadSeed, onFaceChange],
  );

  /**
   * 器を閉じてよいか
   *
   * 段0（作成中は止められないので閉じさせない）と段4（組みかけなら確認）を持つ。
   * **Esc も覆いの押下も「やめる」も、必ずここを通る。**
   */
  const guardClose = useCallback((): boolean => {
    if (isSubmitting) return true;
    if (!isDirty) return false;
    setPending({ subtitle: "閉じると、いま組んでいる局面は消えます。", run: onClose });
    return true;
  }, [isSubmitting, isDirty, onClose]);

  useEffect(() => {
    if (!closeGuard) return;
    closeGuard.current = guardClose;
    return () => {
      closeGuard.current = null;
    };
  }, [closeGuard, guardClose]);

  /** 面の中の「やめる」も同じ門を通す */
  const requestClose = useCallback(() => {
    if (guardClose()) return;
    onClose();
  }, [guardClose, onClose]);

  /**
   * Esc の段
   *
   * **内側から順に畳む。** 段が1つずれると、組んだものが黙って消えるか、
   * 逆に何も組んでいないのに毎回確認が出て、確認そのものが読まれなくなる。
   *
   * **この受け口が持つのは段0〜段3だけ。** 器を閉じる段（段4・段5）は
   * `closeGuard` を通って器の `Modal` の `onClose` が受け持つ。
   * ここで畳んだ段は `preventDefault()` で降ろす ——
   * **`stopPropagation()` は使わない**（`document` まで届かないと
   * `defaultPrevented` の判定に到達せず、畳むものが無いときも無反応になる）。
   *
   * 受け口を DOM の要素側に置くのは、**面の器が焦点を持っているあいだだけ畳みたい**ため。
   * `document` に足すと、面が出ていない器（インポートの面）でも Escape を拾ってしまう。
   *
   * **そのために面の器が焦点を持てる必要がある**（下の `tabIndex={-1}`）。
   * 升も駒台も焦点を持てないので、押したときブラウザは最も近い焦点を持てる祖先へ
   * 焦点を移す。面の器が焦点を持てないと、その祖先は `Modal` のカード ——
   * つまり**この面の外**になり、合成イベントの経路に載らないので受け口が呼ばれない。
   * 組みかけにできる操作（盤を押す・手番を変える）はどれもこの面の中にあるので、
   * 器が焦点を持てさえすれば、畳むべきときには必ず経路に載る。
   */
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      // 変換中の Escape は「変換を取り消す」であって、面を畳む合図ではない
      if (event.key !== "Escape" || event.nativeEvent.isComposing) return;

      // 段0: 作成中。止められないので無視する
      if (isSubmitting) {
        event.preventDefault();
        return;
      }
      // 段1: 確認が出ている。**降ろさずに通す。**
      //
      // React の合成イベントは DOM ではなく React の木を伝うので、確認（`#modal-root` へ
      // portal している）の中で押した Escape も**ここへ届く**。ここで降ろすと、
      // 確認自身の器が `document` で受け取るときには既に `defaultPrevented` で、
      // **Esc では確認が閉じられなくなる**（残る出口はオーバーレイの押下だけ）。
      // 重なった器のうち最上位だけが閉じる仕組みは `Modal` の `isTop()` が持っている
      if (pending !== null) return;
      // 段2: 掴んでいる駒を離す
      if (held !== null) {
        event.preventDefault();
        release();
        return;
      }
      // 段3: 課題局面の面から盤の面へ戻る
      if (face === "study") {
        event.preventDefault();
        onFaceChange("board");
        return;
      }
      // 段4・段5 はここでは見ない。**器の `Modal` の `onClose` が受け持つ** ——
      // 閉じる口は Esc だけでなく覆いの押下と「やめる」もあり、そのうち2つは
      // この受け口を通らない。段を3箇所に写すと、写し忘れた口から組みかけが消える
    },
    [isSubmitting, pending, held, face, release, onFaceChange],
  );

  const confirmView = pending && (
    <ConfirmDialog
      title="組んだ局面は保存されません。"
      subtitle={pending.subtitle}
      confirmLabel="捨てる"
      // フォームの「やめる」（器ごと閉じる）と同じ語にしない。**戻り先が違う** ——
      // こちらは組みかけの盤へ帰るだけ。同じ語だと、どちらを押しても
      // 同じところへ戻ると読める
      cancelLabel="組み続ける"
      onConfirm={() => {
        const run = pending.run;
        setPending(null);
        run();
      }}
      onCancel={() => setPending(null)}
    />
  );

  const heldPiece =
    held === null
      ? null
      : held.from === "hand"
        ? { kind: held.kind, color: held.color }
        : pieceAt(state, held.sq);

  const onStudyFace = face === "study";

  /**
   * 出口に書く手合割。**並べ替えたら `null`**
   *
   * **画面に出す名前（`handicap`）と分ける。** 意味が違う ——
   * 種を選ぶ行が出すのは「何をもとに組んだか」で、載せた手合割の名前は直した後も残す。
   * こちらが答えるのは「`initial` に `{preset}` と書いてよいか」で、
   * 1升でも動かしたら**盤面そのものを書かないと直した配置が黙って落ちる**。
   *
   * **画面には出さない。** 出口が変わったことを名前に添えると、
   * 種を選ぶ行が「いま何が載っているか」と「何が書かれるか」の2つを名乗ることになる。
   * ここが答えるのは後者だけ。
   */
  const handicapForOutput = isDirty ? null : handicap;

  return (
    <div className="pos-editor" tabIndex={-1} hidden={hidden} onKeyDown={handleKeyDown}>
      {/*
        課題局面の面は盤と入れ替えるが、**フォームは外さずに隠す。**
        外すと、ファイル名も先手名もタグも、一覧を覗いて戻っただけで消える
      */}
      {onStudyFace && (
        <div className="pos-editor__main">
          <EditorStudyPicker
            positions={studyPositions}
            onPick={useStudyPosition}
            onBack={() => onFaceChange("board")}
          />
        </div>
      )}
      {/*
        作成中は組む側を止める。**止まっていることを見せて止める** ——
        受け付けないだけだと「押しても何も起きない」（不変条件2）になる。
        `inert` は焦点も拾わないので、Tab で沈んだ盤に入り込むこともない
      */}
      <div
        className={`pos-editor__main${isSubmitting ? " is-busy" : ""}`}
        inert={isSubmitting}
        hidden={onStudyFace}
      >
        <EditorSeed
          handicap={handicap}
          onPickHandicap={pickHandicap}
          onOpenStudyPositions={openStudyPositions}
        />

        <div className="pos-editor__position">
          <EditorTurn color={state.color} onToggle={toggleTurn} />

          <div className="pos-editor__stand-slot pos-editor__stand-slot--gote">
            <EditorStand
              state={state}
              color={Color.White}
              held={held}
              hovered={hovered}
              onPressStand={pressStand}
            />
          </div>
          <EditorBoard
            state={state}
            held={held}
            hovered={hovered}
            illegalSquares={inspection.illegalSquares}
            onPressSquare={pressSquare}
            onFlipSquare={flipSquare}
            onHoverSquare={setHovered}
          />
          <div className="pos-editor__stand-slot pos-editor__stand-slot--sente">
            <EditorStand
              state={state}
              color={Color.Black}
              held={held}
              hovered={hovered}
              onPressStand={pressStand}
            />
          </div>
        </div>

        {/* **盤の面の中に置く。** 外に置くと、掴んだまま面を移ったときに
            課題局面の一覧の上へ駒が1つ浮いたまま残る */}
        {heldPiece && <EditorGhost kind={heldPiece.kind} color={heldPiece.color} />}
      </div>

      <div className="pos-editor__side" hidden={onStudyFace}>
        <EditorNotice issues={inspection.issues} />
        <EditorCreateForm
          state={state}
          handicap={handicapForOutput}
          initialDir={initialDir}
          onCreated={onCreated}
          onCancel={requestClose}
          onSubmittingChange={reportSubmitting}
        />
      </div>

      {confirmView}
    </div>
  );
}

export default PositionEditor;
