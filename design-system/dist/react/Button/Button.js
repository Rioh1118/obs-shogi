import { jsx } from "react/jsx-runtime";
import "./Button.css";
function Button({ variant = "primary", type = "button", className, children, ...rest }) {
  const classes = ["lm-button", `lm-button--${variant}`, className].filter(Boolean).join(" ");
  return /* @__PURE__ */ jsx("button", { type, className: classes, ...rest, children });
}
export {
  Button
};
