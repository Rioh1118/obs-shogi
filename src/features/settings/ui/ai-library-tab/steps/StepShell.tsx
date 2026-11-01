import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle, ChevronRight, Circle, type LucideIcon } from "lucide-react";

import type { StepState } from "@/features/settings/lib/setupSteps";

const STEP_ICON: Record<StepState, LucideIcon> = {
  done: CheckCircle,
  active: ChevronRight,
  warn: AlertTriangle,
  locked: Circle,
};

type Props = {
  state: StepState;
  title: string;
  summary: string;
  children: ReactNode;
};

export function StepShell({ state, title, summary, children }: Props) {
  const Icon = STEP_ICON[state];
  const isExpanded = state === "active" || state === "warn";

  return (
    <div className="setupGuide__step" data-state={state}>
      <div className="setupGuide__stepNum" aria-hidden="true">
        <Icon size={15} />
      </div>
      <div className="setupGuide__stepBody">
        <div className="setupGuide__stepHeader">
          <span className="setupGuide__stepTitle">{title}</span>
          {state === "done" && <span className="setupGuide__stepSummary">{summary}</span>}
        </div>
        {isExpanded && children}
      </div>
    </div>
  );
}
