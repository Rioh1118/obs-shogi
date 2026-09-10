import { useEffect, useMemo, useRef, useState } from "react";
import { buildPreviewDataFromSfen } from "@/entities/position/lib/buildPreviewDataFromSfen";
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
  const [at, setAt] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

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

  // 絞り込みで行が減ると、下見していた位置が一覧の外へ出る。
  // 外へ出たまま ↑↓ を押すと、何も無い場所を指したままプレビューが空になる
  useEffect(() => {
    setAt((current) => (current < shown.length ? current : 0));
  }, [shown.length]);

  const looking = shown[at] ?? null;
  const preview = useMemo(
    () => (looking ? buildPreviewDataFromSfen(looking.sfen) : null),
    [looking],
  );

  return (
    <div
      className="pos-editor__picker"
      // 一覧に焦点が無くても ↑↓ で下見できるようにする。器の中でこの面だけが出ている
      tabIndex={-1}
      ref={listRef}
      onKeyDown={(e) => {
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
        e.preventDefault();
        setAt((current) => {
          const next = current + (e.key === "ArrowDown" ? 1 : -1);
          return Math.max(0, Math.min(shown.length - 1, next));
        });
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

        <div className="pos-editor__picker-rows" role="listbox" aria-label="課題局面">
          {shown.length === 0 ? (
            <p className="pos-editor__picker-empty">
              {positions.length === 0
                ? "課題局面がまだありません。"
                : "この条件に合う課題局面はありません。"}
            </p>
          ) : (
            shown.map((position, index) => (
              <div
                key={position.id}
                className={`pos-editor__picker-row${index === at ? " is-looking" : ""}`}
                role="option"
                aria-selected={index === at}
                onMouseEnter={() => setAt(index)}
                onClick={() => onPick(position)}
              >
                <span className="pos-editor__picker-label">
                  {position.label || "（タイトルなし）"}
                </span>
                <span className="pos-editor__picker-state">
                  {studyPositionStateLabel(position.state)}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="pos-editor__picker-detail">
        <PreviewPane previewData={preview} />
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
