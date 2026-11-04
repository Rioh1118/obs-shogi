import type { ReactNode } from "react";
import { AppConfigProvider } from "@/entities/app-config";
import { NotificationProvider } from "@/shared/lib/notification/provider";
import NotificationLayer from "@/shared/ui/notification/NotificationLayer";

/**
 * 起動した時から在る器。通知の置き場と、それを描く層と、設定を張る。
 *
 * 通知は設定より外に置く。起動できていない画面でも失敗は出る（設定の読み込みに
 * 失敗したことは起動画面に出る）ので、`AppConfigProvider` の内側に置くと、
 * いちばん出したい失敗のときだけ出す先が無い。
 *
 * **層を置き場と同じ場所に置く。** 分けると、置き場だけが在って誰も描かない
 * 状態を作れる。通知が1件も出ないのに全部の検査が緑になる形になる。
 *
 * ルータの外なのは、失敗を出した操作が画面を変えることがあるため
 * （設定を開けなかったら起動画面へ戻る）。画面の中に置くと遷移で消える。
 *
 * `UpdaterScreen` はここより外にある（`App.tsx`）。あちらは失敗を自分のカードに
 * 書き、通知を使わない。通知へ載せ替えるなら、先に `UpdaterScreen` をこの器の内側へ入れること。
 */
export function BootstrapProviders({ children }: { children: ReactNode }) {
  return (
    <NotificationProvider>
      <NotificationLayer />
      <AppConfigProvider>{children}</AppConfigProvider>
    </NotificationProvider>
  );
}
