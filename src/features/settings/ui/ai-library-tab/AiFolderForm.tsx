import Button from "@/shared/ui/Button/Button";
import type { AiFolderFormState } from "@/features/settings/model/useAiFolderForm";
import { SField, SInput } from "../kit";

type Props = {
  form: AiFolderFormState;
};

export function AiFolderForm({ form }: Props) {
  return (
    <SField label="AI 名" inline>
      <div className="setupGuide__createRow">
        <SInput
          ref={form.inputRef}
          value={form.draft}
          invalid={!!form.error}
          onChange={(e) => form.changeDraft(e.target.value)}
          placeholder="AI 名を入力"
          onKeyDown={(e) => {
            if (e.key === "Enter") void form.submit();
          }}
        />
        <Button onClick={form.submit} isLoading={form.isCreating} disabled={!form.draft.trim()}>
          作成
        </Button>
        <span className="setupGuide__createExample">例: Suisho / 研究用A</span>
      </div>
      {/* 中身と同時に DOM へ入れると VoiceOver が live region の変化として読まないので常設する */}
      <p className="setupGuide__createError" role="alert">
        {form.error ?? ""}
      </p>
    </SField>
  );
}
