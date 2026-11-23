import { Loader2 } from "lucide-react";
import ModalHead from "@/shared/ui/ModalHead";
import "./PositionSearchModalHeader.scss";

type Props = {
  title: string;
  isSearching: boolean;
};

export default function PositionSearchModalHeader({ title, isSearching }: Props) {
  return (
    <ModalHead title={title}>
      {isSearching && (
        <span className="pos-search__spinner" title="検索中" aria-live="polite">
          <Loader2 size={16} className="pos-search__spinIcon" />
        </span>
      )}
    </ModalHead>
  );
}
