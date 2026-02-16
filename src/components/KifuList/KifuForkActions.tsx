import { memo, useCallback } from "react";
import "./KifuForkActions.scss";

type Props = {
  busy: boolean;

  canUp: boolean;
  canDown: boolean;

  onUp: () => void;
  onDown: () => void;
  onDelete: () => void;
};

const KifuForkActions = memo(function KifuForkActions({
  busy,
  canUp,
  canDown,
  onUp,
  onDown,
  onDelete,
}: Props) {
  const stop = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
  }, []);

  const onClickUp = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      stop(e);
      if (busy || !canUp) return;
      onUp();
    },
    [stop, busy, canUp, onUp],
  );

  const onClickDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      stop(e);
      if (busy || !canDown) return;
      onDown();
    },
    [stop, busy, canDown, onDown],
  );

  const onClickDelete = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      stop(e);
      if (busy) return;
      onDelete();
    },
    [stop, busy, onDelete],
  );

  return (
    <div className="kifu-forkactions" role="none">
      <button
        type="button"
        className="kifu-forkactions__btn"
        disabled={busy || !canUp}
        title="上へ"
        aria-label="上へ"
        onPointerDown={onClickUp}
      >
        ↑
      </button>

      <button
        type="button"
        className="kifu-forkactions__btn"
        disabled={busy || !canDown}
        title="下へ"
        aria-label="下へ"
        onPointerDown={onClickDown}
      >
        ↓
      </button>

      <button
        type="button"
        className="kifu-forkactions__btn kifu-forkactions__btn--danger"
        disabled={busy}
        title="削除"
        aria-label="削除"
        onPointerDown={onClickDelete}
      >
        🗑
      </button>
    </div>
  );
});

export default KifuForkActions;
