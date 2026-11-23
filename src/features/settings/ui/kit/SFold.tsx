import { useId, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import "./SSection.scss";
import "./SFold.scss";

type Props = {
  title: string;
  description?: string;
  /** 押すまでの開閉。**やり残しがあるときだけ開く** */
  defaultOpen: boolean;
  children: ReactNode;
};

/** 済んだら閉じておく説明の節。一度押したら、押した側の開閉に従う */
export default function SFold({ title, description, defaultOpen, children }: Props) {
  const titleId = useId();
  const bodyId = useId();
  const [pressed, setPressed] = useState<boolean | null>(null);
  const isOpen = pressed ?? defaultOpen;

  return (
    <section className="sui-section sui-fold" aria-labelledby={titleId}>
      <h3 className="sui-fold__head">
        <button
          type="button"
          className="sui-fold__button"
          aria-expanded={isOpen}
          aria-controls={bodyId}
          onClick={() => setPressed(!isOpen)}
        >
          {isOpen ? (
            <ChevronDown size={14} aria-hidden="true" />
          ) : (
            <ChevronRight size={14} aria-hidden="true" />
          )}
          <span className="sui-fold__title" id={titleId}>
            {title}
          </span>
          {description && <span className="sui-fold__desc">{description}</span>}
        </button>
      </h3>

      {isOpen && (
        <div className="sui-section__body" id={bodyId}>
          {children}
        </div>
      )}
    </section>
  );
}
