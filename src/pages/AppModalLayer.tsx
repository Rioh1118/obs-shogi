import { useCallback, useState } from "react";
import { useLocation } from "react-router";
import { useFileTree } from "@/entities/file-tree";
import { isRaisedFromModal } from "@/features/file-conflict/lib/isRaisedFromModal";
import { useURLParams } from "@/shared/lib/router/useURLParams";
import {
  AppErrorBoundary,
  AppErrorFallbackAction,
  AppErrorFallbackBody,
  RETRY_LABEL,
} from "@/shared/ui/AppErrorBoundary";
import CreateFileModal from "@/features/create-file/ui/CreateFileModal";
import SfenKifuCreateModal from "@/features/create-file/ui/SfenKifuCreateModal";
import FileConflictDialog from "@/features/file-conflict/ui/FileConflictDialog";
import { KifuReadErrorDialog } from "@/features/kifu-read-error";
import PositionNavigationModal from "@/features/position-navigation/ui/PositionNavigationModal";
import PositionSearchModal from "@/features/position-search/ui/PositionSearchModal";
import SettingsModal from "@/features/settings/ui/SettingsModal";
import StudyPositionSaveModal from "@/features/study-position-save/ui/StudyPositionSaveModal";
import StudyPositionsManagerModal from "@/features/study-positions-manager/ui/StudyPositionsManagerModal";

/**
 * この層を包む境界に渡す鍵。
 *
 * **入力を param ごとに数え上げない。** ここに居る9枚は `modal` だけでなく
 * `tab` / `dir` / `sfen` / `returnTo` も読むので、名前で並べる形は**足し忘れる規則**になる。
 * `location.key` は遷移のたびに1つ変わるので、いま読んでいる param も、あとで増える param も、
 * 同じ URL へ開き直した操作もまとめて拾える。
 *
 * **URL を持たない2枚**（`FileConflictDialog` / `KifuReadErrorDialog`）だけは別に並べる。
 * この2枚が落ちると、原因を消す口（`clearKifuError` / `closeConflict`）も畳まれた側に居るので、
 * 鍵が動かなければ**そのセッションではどのモーダルも二度と出ない。**
 *
 * **URL を持たない入力をここに足すときは、鍵にも足すこと。**
 */
function useModalLayerResetKeys(): readonly unknown[] {
  const { conflict, kifuError } = useFileTree();
  const { key } = useLocation();
  return [key, conflict, kifuError];
}

/**
 * モーダルの層。**境界をここに持つ。**
 *
 * 包む側（`AppLayout`）に置くと、鍵を読むために作業面ぜんぶを描くコンポーネントが
 * `FileTreeContext` を購読することになり、ツリーの行を1つ選ぶだけで盤も解析も描き直す。
 *
 * **`floatingSlot` の段は、同時に出うる枠どうしで重ならないよう振ってある**（0 がここ、
 * 1 が `app/App.tsx` の更新の知らせ）。理由は `shared/ui/AppErrorBoundary.scss` の `--floating`。
 */
export default function AppModalLayer() {
  const resetKeys = useModalLayerResetKeys();
  const { conflict, kifuError, closeConflict, clearKifuError } = useFileTree();

  /**
   * まだ画面に出したい知らせが立っているか。
   *
   * **立っている知らせそのものが落ちる原因のことがある。** そのときは鍵が動いても直らない
   * —— 解けた瞬間に同じ値をもう一度描いて落ちるので、**別のモーダルを開く操作が、
   * そのまま行き止まりを踏む操作になる。** 消す口（`clearKifuError` / `closeConflict`）は
   * 畳まれた側にしか無いので、境界の**外**にいるここが出口を持つ。
   */
  const hasStandingNotice = conflict !== null || kifuError !== null;

  /**
   * 出口が捨てるものは、知らせによって重さが違う。
   *
   * `kifuError` は**知らせるだけ**なので、捨てても失うのは説明だけ。
   * `conflict` は**待っているファイル操作そのもの**（作成・取り込み・リネーム・移動の要求）で、
   * 捨てるとその操作は実行されずに消える。だから綴りで「待っている操作」を名指しし、
   * 押した結果は `afterAction` に出す
   */
  const dropLabel = conflict !== null ? "待っている操作を取り消す" : "知らせを閉じる";
  const [dropped, setDropped] = useState<string | null>(null);

  return (
    <AppErrorBoundary
      label="モーダル"
      resetKeys={resetKeys}
      floatingSlot={0}
      hint={
        hasStandingNotice
          ? `出しかけの知らせが原因のことがあります。「${dropLabel}」を押してから「${RETRY_LABEL}」を押してください。`
          : `別の操作からやり直してから「${RETRY_LABEL}」を押してください。`
      }
      extraActions={
        hasStandingNotice && (
          <AppErrorFallbackAction
            secondary
            onClick={() => {
              setDropped(
                conflict === null
                  ? "知らせを閉じました。"
                  : "待っていた操作を取り消しました。もう一度やり直してください。",
              );
              closeConflict();
              clearKifuError();
            }}
          >
            {dropLabel}
          </AppErrorFallbackAction>
        )
      }
      fallback={(view) => (
        <AppErrorFallbackBody
          {...view}
          afterAction={dropped && <p className="app-error-fallback__hint">{dropped}</p>}
        />
      )}
    >
      <ModalLayerContent />
    </AppErrorBoundary>
  );
}

/**
 * 層の中身。**平常時 in-flow の要素を返す部品を、ここに足さないこと。**
 *
 * 9枚とも閉じている間は `null` を返し、開いたときだけ `Modal` が `createPortal` する。
 * だからこの層は `.app-layout`（`grid-template-rows` が2段）の中に置けている。
 * 1つでも素の要素を返すと1段目を取り、本体が暗黙の3段目へ押し出されて
 * `overflow: hidden` に切られる —— 本体を畳まないための境界が、本体を畳むことになる。
 */
function ModalLayerContent() {
  const { conflict, kifuError, closeConflict, resolveConflictByRename, clearKifuError } =
    useFileTree();
  const { closeModal } = useURLParams();

  const fromModal = conflict ? isRaisedFromModal(conflict.request) : false; // 依存を真偽に落とす

  /**
   * 衝突を別名で解決したら、発端のモーダルも閉じる。
   *
   * 閉じないと、ファイルは作られたのに**入力がそのまま残ったフォーム**が下から
   * 出てくる。成功も失敗も出ていないので作られたことに気づけず、もう一度押すと
   * 同じ棋譜の2本目ができる。
   */
  const submitRename = useCallback(
    async (nextName: string) => {
      const res = await resolveConflictByRename(nextName);
      if (res.success && fromModal) closeModal();
      return res;
    },
    [fromModal, resolveConflictByRename, closeModal],
  );

  return (
    <>
      <CreateFileModal />
      <SfenKifuCreateModal />
      <PositionNavigationModal />
      <SettingsModal />
      <PositionSearchModal />
      <StudyPositionSaveModal />
      <StudyPositionsManagerModal />
      <FileConflictDialog
        conflict={conflict}
        onCancel={closeConflict}
        onSubmitRename={submitRename}
      />
      <KifuReadErrorDialog error={kifuError} onDismiss={clearKifuError} />
    </>
  );
}
