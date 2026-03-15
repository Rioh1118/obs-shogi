import { AlertTriangle, CheckCircle, ChevronRight, Circle } from "lucide-react";

export type StepState = "done" | "active" | "warn" | "locked";

type Props = {
  state: StepState;
  title: string;
  summary?: string;
  children?: React.ReactNode;
};

export function StepShell({ state, title, summary, children }: Props) {
  const Icon =
    state === "done"
      ? CheckCircle
      : state === "warn"
        ? AlertTriangle
        : state === "active"
          ? ChevronRight
          : Circle;

  const isExpanded = state === "active" || state === "warn";

  return (
    <div className="aiLibraryTab__step" data-state={state}>
      <div className="aiLibraryTab__stepNum" aria-hidden="true">
        <Icon size={15} />
      </div>
      <div className="aiLibraryTab__stepBody">
        <div className="aiLibraryTab__stepHeader">
          <span className="aiLibraryTab__stepTitle">{title}</span>
          {state === "done" && summary && (
            <span className="aiLibraryTab__stepSummary">{summary}</span>
          )}
        </div>
        {isExpanded && children}
      </div>
    </div>
  );
}
