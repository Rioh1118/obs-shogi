import { createContext } from "react";
import type {
  CreateStudyPositionInput,
  StudyPosition,
  UpdateStudyPositionInput,
} from "./types";
import type { StudyPositionsState } from "./reducer";

export type StudyPositionsContextType = {
  state: StudyPositionsState;

  load: () => Promise<void>;
  reload: () => Promise<void>;

  addPosition: (input: CreateStudyPositionInput) => Promise<StudyPosition>;
  updatePosition: (input: UpdateStudyPositionInput) => Promise<StudyPosition>;
  deletePosition: (id: string) => Promise<void>;

  getById: (id: string | null | undefined) => StudyPosition | null;
  findBySfen: (sfen: string | null | undefined) => StudyPosition | null;

  selectPosition: (id: string | null) => void;
  clearError: () => void;
};

export const StudyPositionsContext =
  createContext<StudyPositionsContextType | null>(null);
