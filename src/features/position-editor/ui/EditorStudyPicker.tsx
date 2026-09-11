import { useEffect, useMemo, useRef, useState } from "react";
import { buildPreviewDataFromSfen } from "@/entities/position/lib/buildPreviewDataFromSfen";
import { stateFromSfen } from "@/entities/position/lib/positionDraft";
import PreviewPane from "@/entities/position/ui/PositionPreviewPane";
import {
  STUDY_POSITION_STATES,
  studyPositionStateLabel,
  type StudyPosition,
  type StudyPositionState,
} from "@/entities/study-positions/model/types";
import Select from "@/shared/ui/Form/Select";

interface EditorStudyPickerProps {
  positions: StudyPosition[];
  onPick: (position: StudyPosition) => void;
  onBack: () => void;
}

/**
 * 状態の絞り込み。空文字は「絞らない」
 *
 * `Select` は選択肢の値しか返さないので、`""` もここに並べておけば
 * 呼び手側でキャストが要らない
 */
const STATE_OPTIONS: readonly { value: StudyPositionState | ""; label: string }[] = [
  { value: "", label: "全ての状態" },
  ...STUDY_POSITION_STATES,
];

/**
 * 課題局面から種を選ぶ面
 *
 * **確定ボタンを置かない。行を押した瞬間に載って盤の面へ戻る。**
 * 下見（どんな局面か見るだけ）はホバーと ↑↓ が受け持つので、
 * 「選ぶ」と「決める」を2手に割る必要が無い。
 *
 * 一覧が空のときに「登録してください」と書かない —— ここから登録する導線が無いので、
 * 書いても行き止まりになる。何が無いのかだけを言う。
 */
function EditorStudyPicker({ positions, onPick, onBack }: EditorStudyPickerProps) {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<StudyPositionState | "">("");
  const [lookingId, setLookingId] = useState<string | null>(null);
  const faceRef = useRef<HTMLDivElement>(null);

  // 面に入ったら焦点を移す。**移さないと ↑↓ が効かない** ——
  // 「課題局面から」のボタンは面へ入った時点で消えるので、`Modal` が焦点を
  // タブへ引き戻し、この受け口は合成イベントの経路から外れる
  useEffect(() => {
    faceRef.current?.focus();
  }, []);

  /**
   * 盤に載せられない課題局面
   *
   * `study_positions.json` は Rust 側に SFEN の検査が無いので、読めない綴りが入りうる。
   * **押しても何も起きない行にしない** —— 押す前に沈めて、理由をその場に残す。
   */
  const unusable = useMemo(() => {
    const bad = new Set<string>();
    for (const p of positions) if (!stateFromSfen(p.sfen)) bad.add(p.id);
    return bad;
  }, [positions]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return positions.filter((p) => {
      if (state !== "" && p.state !== state) return false;
      if (needle === "") return true;
      return (
        p.label.toLowerCase().includes(needle) ||
        p.description.toLowerCase().includes(needle) ||
        p.tags.some((tag) => tag.toLowerCase().includes(needle))
      );
    });
  }, [positions, query, state]);

  // **下見は行そのもので覚える。** 位置で覚えると、絞り込みで件数が変わらないまま
  // 中身が入れ替わったときに、押していない別の局面へ黙って移る
  const looking = shown.find((p) => p.id === lookingId) ?? shown[0] ?? null;
  const at = looking ? shown.indexOf(looking) : -1;
  const preview = useMemo(
    () => (looking ? buildPreviewDataFromSfen(looking.sfen) : null),
    [looking],
  );

  return (
    <div
      className="pos-editor__picker"
      // 一覧に焦点が無くても ↑↓ で下見できるようにする。器の中でこの面だけが出ている
      tabIndex={-1}
      ref={faceRef}
      onKeyDown={(e) => {
        // 入力欄ではキャレット移動・IME 候補操作を優先する
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const step = e.key === "ArrowDown" ? 1 : -1;
          const next = Math.max(0, Math.min(shown.length - 1, at + step));
          setLookingId(shown[next]?.id ?? null);
          return;
        }

        // **鍵盤で始めたら鍵盤で終われること。** ↑↓ で下見だけできて決める口が無いと、
        // 鍵盤だけの利用者は種を1つも選べない。沈めた行は押下と同じで受け付けない
        if (e.key === "Enter" && looking && !unusable.has(looking.id)) {
          e.preventDefault();
          onPick(looking);
        }
      }}
    >
      <div className="pos-editor__picker-list">
        <div className="pos-editor__picker-filters">
          <input
            className="pos-editor__picker-search"
            value={query}
            placeholder="ラベル・メモ・タグを検索"
            aria-label="課題局面を検索"
            onChange={(e) => setQuery(e.target.value)}
          />
          <Select
            label="状態"
            id="pos-editor-study-state"
            options={STATE_OPTIONS}
            value={state}
            onChange={setState}
          />
        </div>

        <div
          className="pos-editor__picker-rows"
          role="listbox"
          aria-label="課題局面"
          aria-activedescendant={looking ? `pos-editor-study-${looking.id}` : undefined}
        >
          {shown.length === 0 ? (
            <p className="pos-editor__picker-empty">
              {positions.length === 0
                ? "課題局面がまだありません。"
                : "この条件に合う課題局面はありません。"}
            </p>
          ) : (
            shown.map((position, index) => {
              const broken = unusable.has(position.id);
              return (
                <div
                  key={position.id}
                  id={`pos-editor-study-${position.id}`}
                  className={[
                    "pos-editor__picker-row",
                    index === at && "is-looking",
                    broken && "is-broken",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  role="option"
                  aria-selected={index === at}
                  aria-disabled={broken}
                  title={
                    broken ? "保存されている局面の綴りが壊れていて、盤に載せられません" : undefined
                  }
                  onMouseEnter={() => setLookingId(position.id)}
                  onClick={broken ? undefined : () => onPick(position)}
                >
                  <span className="pos-editor__picker-label">
                    {position.label || "（タイトルなし）"}
                  </span>
                  <span className="pos-editor__picker-state">
                    {broken ? "読めません" : studyPositionStateLabel(position.state)}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="pos-editor__picker-detail">
        {looking && unusable.has(looking.id) ? (
          <p className="pos-editor__picker-empty">
            この課題局面は盤に載せられません。保存されている局面の綴りが壊れています。
          </p>
        ) : (
          <PreviewPane previewData={preview} />
        )}
        <div className="pos-editor__picker-foot">
          <button type="button" className="pos-editor__seed-button" onClick={onBack}>
            戻る
          </button>
        </div>
      </div>
    </div>
  );
}

export default EditorStudyPicker;
