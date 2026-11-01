import Button from "@/shared/ui/Button/Button";

/**
 * AI ライブラリを読み直すボタン。見える語はエンジンの「もう一度読み込む」と同じなので、読み上げでは
 * 何を読み直すかを名指す。走査が返らないドライブでも閉じずに探し直せるよう、読み込み中も押せる（`busy`）。
 */
export default function RescanButton({
  loading,
  onClick,
}: {
  loading: boolean;
  onClick: () => void;
}) {
  return (
    <Button size="sm" onClick={onClick} busy={loading} aria-label="AI ライブラリをもう一度読み込む">
      もう一度読み込む
    </Button>
  );
}
