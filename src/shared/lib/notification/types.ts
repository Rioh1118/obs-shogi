/**
 * 通知の語彙。分類は ADR-0004 が決めている。ここはその型だけを持つ。
 *
 * **名前の規則は2つ。** 出す側が書くものは `Notify*`（`NotifyTier` / `NotifyAction` /
 * `NotifyRequest` / `NotifyPresentation`）、基盤が持つものは `Notification*`。
 * `NotifyAction`（利用者が押すボタン）と `NotificationAction`（reducer への指令）は
 * 別物なので、取り違えないこと。
 *
 * **`Notification` は DOM のグローバルと同名。** あちらも `title` / `body` / `silent` を
 * 持つので、import を忘れた新しいファイルは型検査を素通りする。この型を使うときは
 * import があることを確かめること。
 *
 * **状態としてのエラーはここに来ない**（ADR-0004 決定6）。各スライスの
 * `state.error` は「解析が止まっている」「ツリーが読めていない」を表すもので、
 * 通知を消しても状態は消えない。両者を1つにすると、通知を閉じた瞬間に
 * 止まっている解析が「動いている」ことになる。
 */

/**
 * 段。**復帰に何が要るか**で切ってある（ADR-0004 決定1）。深刻度ではないので、
 * 見た目の派手さで選ばない。
 *
 * - `info` … 利用者は何もしなくてよい
 * - `warning` … 同じ操作をもう一度で直る見込みがある
 * - `danger` … 繰り返しでは直らない。何をすべきかは失敗ごとに違う
 * - `fatal` … アプリの中では直せない
 * - `silent` … **出してはいけない**。握り潰しと区別するために段として持つ
 *   （ADR-0004 決定2）。`cancelSearch` の失敗のように、no-op として通るのが
 *   仕様である失敗がここに来る。「やはり出す」に変えるときは段を差し替える
 */
export type NotifyTier = "info" | "warning" | "danger" | "fatal" | "silent";

/** 実際に描かれる段。面と文字の組はこの4つぶんだけ在る */
export type VisibleTier = Exclude<NotifyTier, "silent">;

/**
 * 通知が受け取る動作（ADR-0004 決定3）。
 *
 * **段には紐づかない。** `danger` の6件は要る操作がそれぞれ違い
 * （設定を初期化／設定を開く／エンジンを再起動／再保存／無し）、
 * 固定の「再試行」ボタンでは足りない。
 *
 * **押しても直らない失敗に動作を付けない。** 付けると利用者は押し続ける。
 * 直るかどうかの判定は ADR-0004 の文脈にある。
 */
export type NotifyAction = {
  label: string;
  run: () => void | Promise<void>;
  /**
   * `run` そのものが失敗したときに、通知の中に出す一文。**利用者の言葉で書く。**
   *
   * 省くと「「＿＿」を実行できませんでした。」だけが出る。それだけでは
   * 次に何をすればよいかが無く、同じボタンを押し続けることになる——
   * ADR-0004 が「押しても直らない失敗に動作を付けない」と決めた状態を、
   * 基盤の側で作ってしまう。
   *
   * 例外そのものは出さない。内部の語が利用者に届くのを避けるため
   */
  failureBody?: string;
};

/**
 * グローバル経路の見せ方（ADR-0004 決定4）。段からは独立している。
 *
 * インラインはここに来ない（理由は `InlineNotice`）。
 */
export type NotifyPresentation = "toast" | "banner" | "modal";

export type NotificationId = string;

/** どの見せ方にも要るもの */
type VisibleRequestBase = {
  tier: VisibleTier;
  /** 何が起きたか。**利用者の言葉で**書く。内部の語（`NotInitialized` 等）を出さない */
  title: string;
  /** 何をすれば直るか。要らなければ省く */
  body?: string;
  actions?: NotifyAction[];
  /**
   * 同種を1つに畳む鍵（ADR-0004 の F-15）。同じ鍵の通知は積まれず、
   * **件数だけが増えて本文が最後のもので置き換わる**。
   *
   * 省くと畳まれない。棋譜を1つ開くたびに何十件も出る類の失敗にだけ付ける
   */
  dedupeKey?: string;
};

/**
 * 出す側が書くもの。**見せ方で枝を分けてある。**
 *
 * フラットな1つの型にすると、見せ方ごとに違う制約を型が表せない。
 * 実際に3つの破れ方があった——`autoDismiss` が帯やモーダルにも効いて
 * `fatal` が6秒で消える、押した動作の結果が出る前にその通知が消える、
 * 出さないと決めた失敗に見せ方を1つ書かされる。**どれも型で言えば起きない。**
 */
export type NotifyRequest =
  // 消えないトースト。**既定はこちら。** 消える側を既定にすると、
  // 書き忘れた失敗が「見ていなければ無かったこと」になる
  | (VisibleRequestBase & { presentation: "toast"; autoDismiss?: false })
  // 放っておけば消えるトースト。**動作を持てない**——押した動作の結果が返る前に
  // 通知が消えると、成功したのか失敗したのかを伝える場所が無くなる
  | (Omit<VisibleRequestBase, "actions"> & { presentation: "toast"; autoDismiss: true })
  // 帯とモーダルは自分からは消えない。閉じるか、出した側が引っ込めるまで残る
  | (VisibleRequestBase & { presentation: "banner" | "modal" })
  | {
      /**
       * **出してはいけない失敗**（ADR-0004 決定2）。何も起きない。
       *
       * 段として持つのは、握り潰し（`catch {}`）と区別をコードに残すため。
       * 見せ方も文言も持たないので、可視の通知から段だけを差し替えて
       * 黙らせることはできない
       */
      tier: "silent";
      /** なぜ出さないか。**出さない判断の唯一の記録**なので省けない */
      reason: string;
    };

/** 基盤が持つもの */
export type Notification = {
  id: NotificationId;
  tier: VisibleTier;
  presentation: NotifyPresentation;
  title: string;
  body?: string;
  actions: NotifyAction[];
  autoDismiss: boolean;
  dedupeKey?: string;
  /**
   * 畳まれた件数。**保持する側では1件目から 1 が入る。**
   *
   * **画面に出すのは `dedupeKey` を持つ通知だけ**（`NotificationLayer`）。
   * 鍵の無い通知は必ず 1 件なので、そこに数が付くと数そのものに意味が無くなる。
   * 出すときは1件目から出す——2件目で急に現れると、増えたのか別の通知なのかが読めない
   */
  count: number;
};

/**
 * 出す口。**mount 後に一度も変わらない**ので、これだけを購読する部品は
 * 通知が出入りしても再描画しない
 */
export type NotificationActions = {
  /** 出す。`silent` の段なら何も起きない */
  notify: (request: NotifyRequest) => void;
  /**
   * 消す。**閉じるボタンのためのもの。** id は通知そのものが持っているので、
   * 描いている側からしか渡せない
   */
  dismiss: (id: NotificationId) => void;
  /**
   * 出した側が引っ込める。**条件と結び付いた通知はこちらで消す。**
   *
   * 出すときに `notify` が id を返さないのは、`dedupeKey` で畳まれた場合に
   * 「いま採番した id」と「畳んだ先の id」が食い違うため。**鍵は呼び出し側が
   * 決められる唯一の握り**なので、あとから引っ込める通知には鍵を付ける
   */
  dismissByKey: (key: string) => void;
};

/** 出す口と、出ているもの。**両方が要るのは通知を描く層だけ** */
export type NotificationContextType = NotificationActions & {
  /** 出た順。同じ見せ方の中ではこの順に積む */
  notifications: Notification[];
};
