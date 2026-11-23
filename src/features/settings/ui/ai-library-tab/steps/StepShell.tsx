import type { ReactNode } from "react";

import type { StepState } from "@/features/settings/lib/setupSteps";

/** 段階の状態の語。番号だけでは、いまどこかが読めない */
const STATE_WORD: Record<StepState, string | null> = {
  done: "済み",
  active: null,
  warn: "注意",
  locked: null,
};

type Props = {
  state: StepState;
  title: string;
  summary: string;
  children: ReactNode;
};

/** 手順の1段階。いまの段階だけ中身を出し、済んだ段階は結果だけを添える */
export function StepShell({ state, title, summary, children }: Props) {
  const isExpanded = state === "active" || state === "warn";
  const word = STATE_WORD[state];

  return (
    <li className="setupGuide__step" data-state={state}>
      <div className="setupGuide__stepHeader">
        <span className="setupGuide__stepTitle">{title}</span>
        {word && <span className="setupGuide__stepWord">{word}</span>}
        {state === "done" && <span className="setupGuide__stepSummary">{summary}</span>}
      </div>
      {isExpanded && <div className="setupGuide__stepBody">{children}</div>}
    </li>
  );
}
