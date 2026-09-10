/**
 * 課題局面の状態と、画面に出す語
 *
 * **並びに意味がある。** 絞り込みのタブがこの順で並ぶので、
 * 「未整理から片付けていく」という読み方が順序から出る。
 *
 * 型を一覧から導くのは、綴りが型に在るのに一覧に無い状態を作らないため。
 * 語だけを写すと、状態を1つ足したときに増えるのが片方だけになる
 * （実際、この一覧は画面3箇所に写されていた）。
 */
export const STUDY_POSITION_STATES = [
  { value: "inbox", label: "未整理" },
  { value: "active", label: "研究中" },
  { value: "reference", label: "資料" },
  { value: "done", label: "完了" },
] as const;

export type StudyPositionState = (typeof STUDY_POSITION_STATES)[number]["value"];

/** 状態から画面に出す語を引く。知らない綴りは「未整理」に倒す */
export function studyPositionStateLabel(state: string): string {
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
