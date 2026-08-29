import Button from "@/shared/ui/Button/Button";
import FsErrorView from "@/entities/file-tree/ui/FsErrorView";
import { fsErrorTier, type FsError } from "@/entities/file-tree/api/error";

interface Props {
  error: FsError;
  onRetry: () => void;
  onDismiss?: () => void;
  isRetrying?: boolean;
  /**
   * ツリーが1本も無いときの逃げ道。
   * 何をすれば直るかは失敗ごとに違うので、動作ごと受け取る（ADR-0004）。
   */
  fallback?: { label: string; run: () => void };
}

/**
 * ファイル操作とツリー取得の失敗を、復帰路つきで出す。
 *
 * 再読み込みを出すかは段が決める。読み直しても直らない失敗に出すと、
 * 押しても何も変わらないので利用者は押し続ける。
 *
 * 逃げ道は段では決めない。**渡されているなら段に関わらず並べる。**
 * ルートが消えたときの `not_found` は「読み直せば追いつく」ので `warning` だが、
 * 読み直す先が消えているので必ず失敗する。段で切ると、この一番よく起きる
 * 経路だけが行き止まりになる。
 *
 * 失敗した操作そのものはやり直せない。内容が state に残らないため
 * （`already_exists` のみ `conflict` として保持される）。
 */
export default function FileTreeErrorNotice({
  error,
  onRetry,
  onDismiss,
  isRetrying,
  fallback,
}: Props) {
  const canRetry = fsErrorTier(error.code) === "warning";

  return (
    <FsErrorView
      error={error}
      actions={
        <>
          {onDismiss && (
            <Button onClick={onDismiss} disabled={isRetrying}>
              閉じる
            </Button>
          )}
          {/* 両方出るときは、直る見込みのある読み直しを主にする */}
          {fallback && (
            <Button tone={canRetry ? "neutral" : "primary"} onClick={fallback.run}>
              {fallback.label}
            </Button>
          )}
          {canRetry && (
            <Button tone="primary" onClick={onRetry} disabled={isRetrying}>
              {isRetrying ? "読み込み中..." : "再読み込み"}
            </Button>
          )}
        </>
      }
    />
  );
}
