interface ButtonGroupProps {
  children: React.ReactNode;
  align?: "left" | "right" | "center";
}

function ButtonGroup({ children, align = "right" }: ButtonGroupProps) {
  return (
    <div
      className={`form__group form__group--buttons form__group--buttons-${align}`}
    >
      {children}
    </div>
  );
}

export default ButtonGroup;
