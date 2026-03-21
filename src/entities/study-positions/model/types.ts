export type StudyPositionState = "inbox" | "active" | "reference" | "done";

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
