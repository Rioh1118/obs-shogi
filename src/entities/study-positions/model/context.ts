import { createContext } from "react";
import type {
  CreateStudyPositionInput,
  StudyPosition,
  StudyPositionsState,
  UpdateStudyPositionInput,
} from "./types";

export type StudyPositionsContextType = {
  state: StudyPositionsState;

  addPosition: (input: CreateStudyPositionInput) => Promise<StudyPosition>;
  updatePosition: (input: UpdateStudyPositionInput) => Promise<StudyPosition>;
  deletePosition: (id: string) => Promise<void>;

  findBySfen: (sfen: string | null | undefined) => StudyPosition | null;
};

export const StudyPositionsContext = createContext<StudyPositionsContextType | null>(null);
