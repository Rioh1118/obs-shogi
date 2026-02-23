import { type ReactNode } from "react";
import "./SSection.scss";

type Props = {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;

  className?: string;
  tone?: "default" | "danger" | "warn";
};

const cx = (...xs: Array<string | false | null | undefined>) =>
  xs.filter(Boolean).join(" ");

export default function SSection({
  title,
  description,
  actions,
  children,
  className,
  tone = "default",
}: Props) {
  return (
    <section className={cx("sui-section", className)} data-tone={tone}>
      {(title || actions) && (
        <header className="sui-section__head">
          <div className="sui-section__titles">
            {title && <div className="sui-section__title">{title}</div>}
            {description && (
              <div className="sui-section__desc">{description}</div>
            )}
          </div>
          {actions && <div className="sui-section__actions">{actions}</div>}
        </header>
      )}

      <div className="sui-section__body">{children}</div>
    </section>
  );
}
