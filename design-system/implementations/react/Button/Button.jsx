import './Button.css';

/**
 * Button — 見本実装（React + 素の CSS）。
 * 使い分けとアクセシビリティの規則は design_system/components/button.md が正本。
 * ここに書くのは、その規則を React で満たすための実装だけ。
 *
 * @param {object} props
 * @param {'primary'|'secondary'} [props.variant='primary'] 1画面に primary は1つまで
 * @param {'button'|'submit'|'reset'} [props.type='button']
 * @param {boolean} [props.disabled]
 */
export function Button({ variant = 'primary', type = 'button', className, children, ...rest }) {
  const classes = ['lm-button', `lm-button--${variant}`, className].filter(Boolean).join(' ');
  return (
    <button type={type} className={classes} {...rest}>
      {children}
    </button>
  );
}
