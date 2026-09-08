import { getCurrentWindow } from "@tauri-apps/api/window";
import { useState } from "react";
import { X } from "lucide-react";
import { AppErrorFallbackAction, AppErrorFallbackBody } from "@/shared/ui/AppErrorBoundary";
import "./RootErrorFallback.scss";

type Props = {
  /** 畳まれた範囲の名前。**境界から受け取る。**ここで書き直すとログと画面で名乗りが割れる */
  label: string;
  /** 落ちた原因。ここが出す以外に、利用者が原因を知る手段は無い */
  error: unknown;
  /** 境界の `reset`。落ちた原因が一過性なら、これで元の画面へ戻れる */
  reset: () => void;
};

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
 * 帯の高さ・閉じるボタンの大きさ・色・帯の塗りは `TitleBar` と同じトークンから取る。落ちた瞬間に
 * 掴める領域が伸び縮みしたり赤の色味が変わったりすると、同じ窓の同じボタンだと分からなくなる。
 * **避けているのは部品の再利用であって、スタイルの共有ではない** —— スタイルは
 * `App.tsx` と同じ塊に載るので、この画面が描けている時点で読めていることが確定している。
 *
 * **共有し切れていないものが1つある。** アイコンの `lucide-react` は `TitleBar` と同じものを
 * import しているので、そこが原因で root まで上がった場合はこの画面も同じ例外で落ちる。
 */
export function RootErrorFallback({ label, error, reset }: Props) {
  // **握って黙ると「押しても何も起きないボタン」になる。** この画面は他に手段が無いときの
  // 最後の1つなので、閉じられなかったことは画面に出す
  const [closeFailed, setCloseFailed] = useState(false);

  const close = async () => {
    try {
      await getCurrentWindow().close();
    } catch (cause) {
      console.error("[RootErrorFallback] ウィンドウを閉じられない:", cause);
      setCloseFailed(true);
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
        <AppErrorFallbackBody
          label={label}
          error={error}
          reset={reset}
          hint="再表示で戻らない場合は、ウィンドウを閉じて開き直してください。保存していない入力は失われます。"
          actions={
            /*
              **帯の丸だけに頼らない。** この画面が出る理由は「閉じられない」を直すことなのに、
              12px の色の丸は失敗の直後にいちばん見つけにくい。文字のボタンを本文に並べる
            */
            <AppErrorFallbackAction onClick={close} secondary>
              ウィンドウを閉じる
            </AppErrorFallbackAction>
          }
          notice={
            closeFailed && (
              <p className="root-error-fallback__closeError" role="alert">
                ウィンドウを閉じられませんでした。OS の終了操作（macOS は ⌘Q、Windows は Alt+F4）で
                アプリを終了してください。
              </p>
            )
          }
        />
      </div>
    </div>
  );
}
