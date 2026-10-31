import { useCallback, useEffect, useRef, useState } from "react";
import type { EngineStatus } from "@/entities/analysis";
import type { EngineFailureNotice } from "@/entities/engine";
import { EngineStatusDetail } from "./EngineStatusDetail";

/** 状態ごとの語と印。**経過時間を添えるのは読んでいる間と読み終えた後だけ** */
const STATUS_VIEW: Record<EngineStatus, { word: string; mark: string; timer: boolean }> = {
  "no-engine": { word: "エンジンなし", mark: "idle", timer: false },
  starting: { word: "起動中…", mark: "idle", timer: false },
  "standing-by": { word: "待機中", mark: "idle", timer: false },
  analyzing: { word: "検討中", mark: "analyzing", timer: true },
  finished: { word: "検討完了", mark: "idle", timer: true },
  unresponsive: { word: "応答なし", mark: "warning", timer: false },
  exited: { word: "エンジン終了", mark: "danger", timer: false },
  failed: { word: "起動失敗", mark: "danger", timer: false },
  cancelled: { word: "起動を中止しました", mark: "danger", timer: false },
};

const formatElapsed = (seconds: number): string => {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};

/**
 * 操作列の左。**状態を語で言い、読んでいる間は局面を読み始めてからの実時間を添える。**
 * 局面が変わると 0 に戻り、読み終えたら止まった時点の値で止まる。
 */
export function EngineStatusLabel({
  status,
  currentSfen,
  notice = null,
  lastOutput = null,
  onOpenSettings = () => {},
}: {
  status: EngineStatus;
  currentSfen: string | null;
  /** 語を押して出す文。**あるときだけ語が押せる**（V6 V7 V8） */
  notice?: EngineFailureNotice | null;
  lastOutput?: string | null;
  onOpenSettings?: () => void;
}) {
  const view = STATUS_VIEW[status];
  const searching = status === "analyzing";
  const showsTimer = view.timer;
  const [elapsed, setElapsed] = useState(0);
  const startedAtRef = useRef<number | null>(null);
  const lastSfenRef = useRef<string | null>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const closeDetail = useCallback(() => setAnchor(null), []);

  // 文が無くなったら閉じる。残すと、次の失敗で押していないのに古い位置で開く
  const hasNotice = notice !== null;
  useEffect(() => {
    if (!hasNotice) setAnchor(null);
  }, [hasNotice]);

  useEffect(() => {
    if (!searching) {
      startedAtRef.current = null;
      // 時計を出さない状態に入ったら値を捨てる。捨てないと、同じ局面で読み直してすぐ終わった回は
      // `検討中` を1描画も通らないので、前に読んだ時間が `検討完了` に出る。`検討完了` の値は残す
      if (!showsTimer) setElapsed(0);
      return;
    }

    if (startedAtRef.current === null) {
      startedAtRef.current = Date.now();
      setElapsed(0);
    }
    const timer = setInterval(() => {
      if (startedAtRef.current === null) return;
      setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [searching, showsTimer]);

  useEffect(() => {
    if (currentSfen === lastSfenRef.current) return;
    lastSfenRef.current = currentSfen;
    if (searching) startedAtRef.current = Date.now();
    setElapsed(0);
  }, [currentSfen, searching]);

  return (
    <div className="analysis-controls__status">
      <span className={`analysis-controls__dot analysis-controls__dot--${view.mark}`}></span>
      {notice ? (
        <button
          className="analysis-controls__status-text analysis-controls__status-text--button"
          aria-expanded={anchor !== null}
          onClick={(event) => {
            const { currentTarget } = event;
            setAnchor((open) => (open ? null : currentTarget.getBoundingClientRect()));
          }}
        >
          {view.word}
        </button>
      ) : (
        <span className="analysis-controls__status-text">{view.word}</span>
      )}
      {notice && anchor && (
        <EngineStatusDetail
          notice={notice}
          lastOutput={lastOutput}
          anchor={anchor}
          onOpenSettings={() => {
            closeDetail();
            onOpenSettings();
          }}
          onClose={closeDetail}
        />
      )}
      {view.timer && <span className="analysis-controls__timer">{formatElapsed(elapsed)}</span>}
    </div>
  );
}
