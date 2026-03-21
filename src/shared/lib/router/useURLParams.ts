import { useSearchParams, useNavigate } from "react-router";
import { useCallback, useMemo } from "react";

export type ModalType =
  | "navigation"
  | "analysis"
  | "settings"
  | "create-file"
  | "position-search"
  | "study-position-save"
  | "study-positions"
  | "sfen-kifu-create";

export type PovType = "sente" | "gote";

export interface URLParams {
  modal?: ModalType;
  tesuu?: number;
  branch?: string;
  dir?: string;
  tab?: string;
  pov?: PovType;
  /** 局面検索・課題局面登録に渡す検索対象SFEN（省略時は現在局面） */
  sfen?: string;
  /** モーダルを閉じたとき戻る先のモーダル */
  returnTo?: ModalType;
}

type UpdateOptions = { replace?: boolean };

export function useURLParams() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // 現在のURLパラメータを取得
  const params: URLParams = useMemo(() => {
    const povRaw = searchParams.get("pov");
    const pov =
      povRaw === "gote" || povRaw === "sente" ? (povRaw as PovType) : undefined;

    return {
      tesuu: searchParams.get("tesuu")
        ? Number(searchParams.get("tesuu"))
        : undefined,
      branch: searchParams.get("branch") || undefined,
      modal: (searchParams.get("modal") as URLParams["modal"]) || undefined,
      dir: searchParams.get("dir") || undefined,
      tab: searchParams.get("tab") || undefined,
      pov,
      sfen: searchParams.get("sfen") || undefined,
      returnTo: (searchParams.get("returnTo") as ModalType) || undefined,
    };
  }, [searchParams]);

  // URLパラメータを更新
  const updateParams = useCallback(
    (
      newParams: Partial<URLParams>,
      opts: UpdateOptions = { replace: true },
    ) => {
      const currentParams = new URLSearchParams(searchParams);

      // 新しいパラメータを設定
      Object.entries(newParams).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          currentParams.set(key, String(value));
        } else {
          currentParams.delete(key);
        }
      });

      // URLを更新
      navigate(`?${currentParams.toString()}`, {
        replace: opts.replace ?? true,
      });
    },
    [searchParams, navigate],
  );

  // モーダルを開く
  const openModal = useCallback(
    (
      modalType: URLParams["modal"],
      extra?: Partial<URLParams>,
      opts?: UpdateOptions,
    ) => {
      updateParams(
        {
          ...extra,
          modal: modalType,
        },
        { replace: opts?.replace ?? false },
      );
    },
    [updateParams],
  );

  // モーダルを閉じる（returnTo があれば戻り先モーダルを開く）
  const closeModal = useCallback(() => {
    const returnTo = searchParams.get("returnTo") as ModalType | null;
    if (returnTo) {
      updateParams({ modal: returnTo, sfen: undefined, returnTo: undefined, dir: undefined, tab: undefined });
    } else {
      updateParams({ modal: undefined, dir: undefined, tab: undefined, sfen: undefined, returnTo: undefined });
    }
  }, [searchParams, updateParams]);

  // 局面移動
  const navigateToPosition = useCallback(
    (tesuu: number, branch?: string) => {
      updateParams({ tesuu, branch, modal: undefined });
    },
    [updateParams],
  );

  return {
    params,
    updateParams,
    openModal,
    closeModal,
    navigateToPosition,
  };
}
