import { FolderOpen } from "lucide-react";
import type { BookOpenTarget } from "../lib/openTargets";
import "./BookEmpty.scss";

type Props = {
  fromPreset: readonly BookOpenTarget[];
  recent: readonly BookOpenTarget[];
  onOpen: (path: string) => void;
  onBrowse: () => void;
};

/**
 * 定跡を開いていないときの画面。
 *
 * **押せる一覧を出す。**「定跡を開いてください」とだけ出すと、AI 開発者が
 * いちばん見たい1件（いま回しているエンジンが食っている定跡）まで
 * ダイアログでパスを辿らせることになる。
 *
 * **起動時に勝手に開き直さない。** 定跡は GB 級になりうるので、
 * 開くのは必ず押されてから。
 */
function BookEmpty({ fromPreset, recent, onOpen, onBrowse }: Props) {
  const list = (label: string, targets: readonly BookOpenTarget[]) =>
    targets.length > 0 && (
      <section className="book-empty__group">
        <h3 className="book-empty__label">{label}</h3>
        <ul className="book-empty__list">
          {targets.map((target) => (
            <li key={target.path}>
              <button
                type="button"
                className="book-empty__item"
                onClick={() => onOpen(target.path)}
                title={target.path}
              >
                <span className="book-empty__name">{target.name}</span>
                <span className="book-empty__note">{target.note}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    );

  return (
    <div className="book-empty">
      <p className="book-empty__lead">定跡を開くと、現局面の候補手がここに出ます。</p>

      {list("このエンジンの定跡", fromPreset)}
      {list("最近開いた定跡", recent)}

      <button type="button" className="book-empty__browse" onClick={onBrowse}>
        <FolderOpen className="book-empty__icon" />
        別の定跡を開く…
      </button>
    </div>
  );
}

export default BookEmpty;
