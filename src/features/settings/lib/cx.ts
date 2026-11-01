/** 偽の値を除いて class 名を繋ぐ。 */
export const cx = (...xs: Array<string | false | null | undefined>) => xs.filter(Boolean).join(" ");
