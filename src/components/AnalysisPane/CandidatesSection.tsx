import { type ConvertedMove } from "@/utils/sfenConverter";
import "./CandidatesSection.scss";
import MoveSequence from "./MoveSequence";
import type { Evaluation } from "@/commands/engine/types";

interface CandidatesSectionProps {
  candidateSequences: ConvertedMove[][];
  candidateEvaluations: (Evaluation | null)[];
  maxCandidates?: number;
}

function CandidatesSection({
  candidateSequences,
  candidateEvaluations,
  maxCandidates = 7,
}: CandidatesSectionProps) {
  const displayCandidates = candidateSequences.slice(0, maxCandidates);
  return (
    <section className="candidates-section">
      {displayCandidates.map((moves, index) => (
        <MoveSequence
          key={`candidate-${index}`}
          moves={moves}
          variant="candidate"
          evaluation={candidateEvaluations[index]}
        />
      ))}
      {candidateSequences.length === 0 && (
        <p className="candidates-section__empty">候補手なし</p>
      )}
    </section>
  );
}

export default CandidatesSection;
