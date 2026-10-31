import { useEffect, useRef } from "react";
import type { EngineFailureNotice } from "@/entities/engine";
import Button from "@/shared/ui/Button/Button";
import "./EngineStatusDetail.scss";

type Props = {
  notice: EngineFailureNotice;
  /** エンジンが最後に出した行。受けたままの形。無ければ欄を出さない */
  lastOutput: string | null;
  /** 語の位置。ドックは `overflow: hidden` なので、画面に対して置く */
  anchor: DOMRect;
  onOpenSettings: () => void;
  onClose: () => void;
};

/**
 * 操作列の語を押すと出る小さな面。**帯を閉じた後に理由へ戻る口はここだけ**で、普段は画面を使わない
 * （`docs/spec/features/engine-standardization.md` の「エンジンの状態」）。
 */
export function EngineStatusDetail({ notice, lastOutput, anchor, onOpenSettings, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const closeOutside = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="engine-status-detail"
      role="dialog"
      aria-label={notice.title}
      style={{ left: anchor.left, bottom: window.innerHeight - anchor.top + 4 }}
    >
      <p className="engine-status-detail__title">{notice.title}</p>
      <p className="engine-status-detail__body">{notice.body}</p>
      {lastOutput && <pre className="engine-status-detail__output">{lastOutput}</pre>}
      <Button size="sm" motion={false} onClick={onOpenSettings}>
        設定を開く
      </Button>
    </div>
  );
}
