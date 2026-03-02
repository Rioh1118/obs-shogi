export const MARK_TAGS = ["詰み"] as const;
export type MarkTag = (typeof MARK_TAGS)[number];
export type MarkLevel = 0 | 1 | 2 | 3 | 4;

export interface MarkEntry {
  id: string;
  tesuu: number;
  moveText: string;
  level: MarkLevel;
  tags: MarkTag[];
  note: string;
}

/** tesuuPointer -> MarkEntry */
export type FileMarks = Record<string, MarkEntry>;

/** absPath -> FileMarks */
export interface MarksStore {
  files: Record<string, FileMarks>;
}

export interface MarksState {
  store: MarksStore;
  isLoading: boolean;
  error: string | null;
}

export interface MarksContextType {
  state: MarksState;
  getFileMarks: (absPath: string) => FileMarks;
  upsertMark: (
    absPath: string,
    tesuuPointer: string,
    patch: Partial<MarkEntry> & { id: string; tesuu: number; moveText: string },
  ) => Promise<void>;
  deleteMark: (absPath: string, tesuuPointer: string) => Promise<void>;
}
