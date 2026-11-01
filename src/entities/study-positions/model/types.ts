/**
 * 課題局面の状態と、画面に出す語
 *
 * 絞り込みのタブがこの順で並ぶ。「未整理から片付けていく」という読み方が順序から出る。
 *
 * 型はこの一覧から導く。綴りが型に在るのに一覧に無い状態を作らないため。
 */
export const STUDY_POSITION_STATES = [
  { value: "inbox", label: "未整理" },
  { value: "active", label: "研究中" },
  { value: "reference", label: "資料" },
  { value: "done", label: "完了" },
] as const;

export type StudyPositionState = (typeof STUDY_POSITION_STATES)[number]["value"];

/**
 * 状態から画面に出す語を引く。
 *
 * `??` の先は `find` の戻り値を畳むためのもの。知らない綴りのファイルは
 * `load_study_positions` が parse で断るので、ここへ来ない。
 */
export function studyPositionStateLabel(state: StudyPositionState): string {
  return (
    STUDY_POSITION_STATES.find((s) => s.value === state)?.label ?? STUDY_POSITION_STATES[0].label
  );
}

export type StudyPosition = {
  id: string;
  sfen: string;
  label: string;
  description: string;
  state: StudyPositionState;
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

export type StudyPositionsFile = {
  positions: StudyPosition[];
};

export type StudyPositionsState = {
  positions: StudyPosition[];
  /** 最後の読み書きの失敗。画面の読み手はまだ無い（`docs/state-transitions/failure-surfacing.md` の F-11） */
  error: string | null;
};

export type CreateStudyPositionInput = {
  sfen: string;
  label: string;
  description: string;
  state: StudyPositionState;
  tags: string[];
};

export type UpdateStudyPositionInput = {
  id: string;
  sfen?: string;
  label?: string;
  description?: string;
  state?: StudyPositionState;
  tags?: string[];
};
