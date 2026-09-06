import type { ReactNode } from "react";
import { AppConfigProvider } from "@/entities/app-config";
import { NotificationProvider } from "@/shared/lib/notification/provider";
import NotificationLayer from "@/shared/ui/notification/NotificationLayer";

export function BootstrapProviders({ children }: { children: ReactNode }) {
  // 通知はいちばん外。**起動できていない画面でも失敗は出る**（設定の読み込みに
  // 失敗したことは起動画面に出る）ので、AppConfigProvider の内側に置くと、
  // いちばん出したい失敗のときだけ出す先が無い。
  //
  // **層を置き場と同じ場所に置く。** 分けると、置き場だけが在って誰も描かない
  // 状態を作れてしまう——それは通知が1件も出ないのに全部の検査が緑になる形で、
  // このエピックが直そうとしているものそのもの。
  //
  // ルータの外なのは、失敗を出した操作が画面を変えることがあるため
  // （設定を開けなかったら起動画面へ戻る）。画面の中に置くと遷移で消える
  return (
    <NotificationProvider>
      <NotificationLayer />
      <AppConfigProvider>{children}</AppConfigProvider>
    </NotificationProvider>
  );
}
