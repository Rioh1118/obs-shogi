import { getCurrentWindow } from "@tauri-apps/api/window";
import { AppErrorFallbackBody } from "@/shared/ui/AppErrorBoundary";

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
 * 寸法と色を直値で書いているのも依存を増やさないため。`AppErrorBoundary` の既定の
 * fallback と同じ理由で、トークンを解決するスタイルに頼らずに出せる形にしてある。
 * **帯の高さを `$titlebar-height` に合わせる必要は無い** —— この画面では
 * モーダルの overlay のように帯の高さを見て位置を決めるものが1つも描かれない。
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
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        background: "#1c2325",
        color: "rgba(255,255,255,0.7)",
        fontSize: "1.3rem",
      }}
    >
      {/* ウィンドウを動かせる唯一の帯。閉じるボタンだけドラッグから外す */}
      <div
        data-tauri-drag-region
        style={{
          height: "2.6rem",
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          padding: "0 1.2rem",
          background: "rgba(0,0,0,0.3)",
          userSelect: "none",
        }}
      >
        <button
          type="button"
          onClick={close}
          aria-label="ウィンドウを閉じる"
          data-tauri-drag-region="false"
          style={{
            width: "1.2rem",
            height: "1.2rem",
            padding: 0,
            border: "none",
            borderRadius: "50%",
            background: "#ff5f57",
            cursor: "pointer",
          }}
        />
      </div>

      <div style={{ flex: 1, minHeight: 0 }}>
        <AppErrorFallbackBody reset={retry} />
      </div>
    </div>
  );
}
