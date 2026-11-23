import { useId, type ReactNode } from "react";
import "./SSection.scss";

type Props = {
  title?: ReactNode;
  /** 題に添える件数。節の名前には入れない */
  count?: number;
  /** 題に添える1語（`SettingsBadge`） */
  badge?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
};

/** 設定の1つの話題。箱で囲まず、隣の話題との境は線と余白で分ける */
export default function SSection({ title, count, badge, description, actions, children }: Props) {
  // 見出しを節の名前にする。名前の無い `<section>` は landmark として引けない
  const titleId = useId();

  return (
    <section className="sui-section" aria-labelledby={title ? titleId : undefined}>
      {(title || actions) && (
        <header className="sui-section__head">
          {title && (
            <div className="sui-section__titles">
              <h3 className="sui-section__title" id={titleId}>
                {title}
              </h3>
              {count !== undefined && <span className="sui-section__count">{count}</span>}
              {badge}
            </div>
          )}
          {actions && <div className="sui-section__actions">{actions}</div>}
          {description && <p className="sui-section__desc">{description}</p>}
        </header>
      )}

      <div className="sui-section__body">{children}</div>
    </section>
  );
}
