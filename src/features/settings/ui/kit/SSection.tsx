import { useId, type ReactNode } from "react";
import "./SSection.scss";

type Props = {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;

  className?: string;
  tone?: "default" | "danger" | "warn";
};

const cx = (...xs: Array<string | false | null | undefined>) => xs.filter(Boolean).join(" ");

export default function SSection({
  title,
  description,
  actions,
  children,
  className,
  tone = "default",
}: Props) {
  // 見出しを節の名前にする。**名前の無い `<section>` は landmark として引けない**ので、
  // 支援技術からも、名前で節を絞るテストからも、中身が同じ塊として扱えない
  const titleId = useId();

  return (
    <section
      className={cx("sui-section", className)}
      data-tone={tone}
      aria-labelledby={title ? titleId : undefined}
    >
      {(title || actions) && (
        <header className="sui-section__head">
          <div className="sui-section__titles">
            {title && (
              <div className="sui-section__title" id={titleId}>
                {title}
              </div>
            )}
            {description && <div className="sui-section__desc">{description}</div>}
          </div>
          {actions && <div className="sui-section__actions">{actions}</div>}
        </header>
      )}

      <div className="sui-section__body">{children}</div>
    </section>
  );
}
