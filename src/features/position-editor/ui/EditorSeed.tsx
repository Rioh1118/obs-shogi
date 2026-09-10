import { HANDICAP_PRESETS, type HandicapPreset } from "@/entities/kifu/model/handicap";
import Select from "@/shared/ui/Form/Select";

interface EditorSeedProps {
  /** いま選ばれている手合割。組みかけなら `null`（プレースホルダに戻す） */
  handicap: HandicapPreset | null;
  /** いま開いている棋譜の局面を種にできるか */
  canUseCurrentKifu: boolean;
  onPickHandicap: (preset: HandicapPreset) => void;
  onOpenStudyPositions: () => void;
  onUseCurrentKifu: () => void;
}

/**
 * 種を選ぶ行
 *
 * 種は3通り —— 手合割13／登録済みの課題局面／いま開いている棋譜の局面。
 * **駒箱を持たないので、駒の顔ぶれはここで決まりきる**（→ #548）。
 *
 * **確定ボタンは置かない。** 選んだ瞬間に載る。載せる前に「本当に載せるか」を
 * 聞く場面は組みかけのときだけで、それは捨てる確認が受け持つ。
 */
function EditorSeed({
  handicap,
  canUseCurrentKifu,
  onPickHandicap,
  onOpenStudyPositions,
  onUseCurrentKifu,
}: EditorSeedProps) {
  return (
    <div className="pos-editor__seed">
      <div className="pos-editor__seed-select">
        <Select
          label="手合割"
          id="pos-editor-handicap"
          options={HANDICAP_PRESETS}
          // 組みかけのあいだは空にしてプレースホルダへ戻す。**同じ手合割を
          // 選び直せるようにもなる** —— 値が残っていると `onChange` が飛ばない
          value={handicap ?? ""}
          placeholder="手合割から…"
          onChange={onPickHandicap}
        />
      </div>

      <button type="button" className="pos-editor__seed-button" onClick={onOpenStudyPositions}>
        課題局面から
      </button>

      <button
        type="button"
        className="pos-editor__seed-button"
        onClick={onUseCurrentKifu}
        disabled={!canUseCurrentKifu}
        // **押しても何も起きない形を作らない。** 押せない理由をその場に残す
        title={canUseCurrentKifu ? undefined : "棋譜を開いていません"}
      >
        いまの棋譜の局面
      </button>
    </div>
  );
}

export default EditorSeed;
