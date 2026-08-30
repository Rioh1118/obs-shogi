interface ButtonGroupProps {
  children: React.ReactNode;
}

// 並びは右揃えだけ（`Form.scss` の `--buttons`）。軸を持つと、値に対応する規則が
// 無いまま「選べるが効かない」prop になる
function ButtonGroup({ children }: ButtonGroupProps) {
  return <div className="form__group form__group--buttons">{children}</div>;
}

export default ButtonGroup;
