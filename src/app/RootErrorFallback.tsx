import { getCurrentWindow } from "@tauri-apps/api/window";
import { X } from "lucide-react";
import { AppErrorFallbackBody } from "@/shared/ui/AppErrorBoundary";
import "./RootErrorFallback.scss";

/**
 * root の境界が最後に出す画面。
 *
 * **ここが出ているとき、`TitleBar` は一緒に消えている。** ウィンドウ枠は自前で描いていて
 * （`src-tauri/tauri.conf.json` の `decorations: false`）、その `TitleBar` は
 * `RuntimeShell` の中に居るので、例外が root まで上がった時点で落ちている。
 * ドラッグ領域と閉じるボタンをこの画面が**自分で**持たないと、利用者に残るのは強制終了だけになる。
 *
 * **`TitleBar` を再利用しない。** 枠そのものが落ちて root まで来た場合に、同じものを
 * 描き直せば同じ例外でこの画面も落ち、境界の外へ抜けて白い窓に戻る。同じ理由で
 * `getCurrentWindow()` はレンダで呼ばず押されたときだけ呼ぶ。Tauri の API が
 * 使えなくてもドラッグ領域は生き、ウィンドウを動かすことはできる。
 *
 * 帯の高さと閉じるボタンの色は `TitleBar` と同じトークンから取る。落ちた瞬間に掴める領域が
 * 伸び縮みしたり赤の色味が変わったりすると、同じ窓の同じボタンだと分からなくなる。
 * **避けているのは部品の再利用であって、スタイルの共有ではない** —— スタイルは
 * `App.tsx` と同じ塊に載るので、この画面が描けている時点で読めていることが確定している。
 */

type Props = {
  /** 境界の `reset`。落ちた原因が一過性なら、これで元の画面へ戻れる */
  retry: () => void;
};

export function RootErrorFallback({ retry }: Props) {
  const close = async () => {
    try {
      await getCurrentWindow().close();
    } catch (error) {
      console.error("[RootErrorFallback] ウィンドウを閉じられない:", error);
    }
  };

  return (
    <div className="root-error-fallback">
      {/* この画面でウィンドウを動かせる唯一の帯。閉じるボタンだけドラッグから外す */}
      <div className="root-error-fallback__chrome" data-tauri-drag-region>
        <button
          type="button"
          className="root-error-fallback__close"
          onClick={close}
          aria-label="ウィンドウを閉じる"
          data-tauri-drag-region="false"
        >
          <X size={12} strokeWidth={3} />
        </button>
      </div>

      <div className="root-error-fallback__body">
        <AppErrorFallbackBody reset={retry} />
      </div>
    </div>
  );
}
