// 良い例：主要な操作は primary を1つだけ。残りは secondary。値は CSS 変数だけ。
import { Button } from '../../implementations/react/Button/index.js';
import './button-usage.css';

export function ButtonUsage() {
  return (
    <form className="lm-example-actions" aria-label="変更の保存">
      <Button variant="secondary">キャンセル</Button>
      <Button variant="primary" type="submit">
        変更を保存する
      </Button>
    </form>
  );
}
