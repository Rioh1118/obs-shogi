import { HANDICAP_PRESETS, type HandicapPreset } from "@/entities/kifu/model/handicap";
import Select from "@/shared/ui/Form/Select";

interface EditorSeedProps {
  /**
   * いま載っている種の手合割。課題局面から載せたなら `null`
   *
   * **組みかけになっても消さない。** 消すと「何をもとに組んだのか」が画面から消えて、
   * 平手を直した形なのか駒落ちを直した形なのかが読めなくなる。
   */
  handicap: HandicapPreset | null;
  onPickHandicap: (preset: HandicapPreset) => void;
  onOpenStudyPositions: () => void;
}

/**
 * 種を選ぶ行
 *
 * 種は2通り —— 手合割13と、登録済みの課題局面。
 * **駒箱を持たないので、駒の顔ぶれはここで決まりきる**（→ #548）。
 *
 * **確定ボタンは置かない。** 選んだ瞬間に載る。載せる前に「本当に載せるか」を
 * 聞く場面は組みかけのときだけで、それは捨てる確認が受け持つ。
 *
 * 押せるものは2つだけなので、出どころを選ぶ段（分節）を挟まない ——
 * 挟むと押す回数が増えるだけになる。
 */
function EditorSeed({ handicap, onPickHandicap, onOpenStudyPositions }: EditorSeedProps) {
  return (
    <div className="pos-editor__seed">
      <div className="pos-editor__seed-select">
        <Select
          label="種"
          id="pos-editor-handicap"
          options={HANDICAP_PRESETS}
          value={handicap ?? ""}
          placeholder="手合割から…"
          onChange={onPickHandicap}
        />
      </div>

      <button type="button" className="pos-editor__seed-button" onClick={onOpenStudyPositions}>
        課題局面から…
      </button>
    </div>
  );
}

export default EditorSeed;
