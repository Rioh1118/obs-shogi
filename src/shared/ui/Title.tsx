import type { ComponentPropsWithoutRef, ElementType } from "react";
import "./Title.scss";

type TitleVariant = "hero" | "header";

type Props<T extends ElementType = "h1"> = {
  as?: T;
  variant?: TitleVariant;
  obsText?: string;
  shogiText?: string;
  className?: string;
} & Omit<ComponentPropsWithoutRef<T>, "as" | "children">;

function Title<T extends ElementType = "h1">({
  as,
  variant = "hero",
  obsText = "obs",
  shogiText = "shogi",
  className,
  ...rest
}: Props<T>) {
  const Comp = (as ?? "h1") as ElementType;

  return (
    <Comp
      className={["title", `title--${variant}`, className]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      <span className="title__obs">{obsText}</span>
      <span className="title__shogi">{shogiText}</span>
    </Comp>
  );
}

export default Title;
