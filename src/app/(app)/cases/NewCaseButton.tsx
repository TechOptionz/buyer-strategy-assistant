"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Alert, Button, cx, Field, Modal, Select, TextInput } from "@/components/ui";
import { api, ClientApiError, newKey } from "@/lib/client/api";

export type EntryMode = "notes" | "guided";

/** New case dialog. Starts from pasted meeting notes or a one-question-at-a-time interview. */
export function NewCaseDialog({ open, mode: initialMode, onClose, reviewers }: { open: boolean; mode: EntryMode; onClose: () => void; reviewers: { id: string; name: string; role: string }[] }) {
  const router = useRouter();
  const key = useRef(newKey());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<EntryMode>(initialMode);
  const [lastInitial, setLastInitial] = useState(initialMode);
  if (lastInitial !== initialMode) {
    setLastInitial(initialMode);
    setMode(initialMode);
  }

  return (
    <Modal open={open} onClose={onClose} title="New case" width={480}>
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          setBusy(true);
          setError(null);
          try {
            const res = await api<{ id: string }>("/api/assessments", {
              body: { buyerDisplayName: String(fd.get("name")), entryMode: mode, reviewerId: String(fd.get("reviewer") ?? "") || null },
              headers: { "idempotency-key": key.current },
            });
            router.push(`/cases/${res.id}${mode === "notes" ? "?start=notes" : ""}`);
          } catch (err) {
            setError(err instanceof ClientApiError ? err.message : "Could not create the case");
            setBusy(false);
          }
        }}
      >
        {error && <Alert tone="bad">{error}</Alert>}
        <Field label="Client name" htmlFor="new-case-name" hint="A name or label is enough. Collect contact details only where needed.">
          <TextInput id="new-case-name" name="name" required maxLength={120} autoFocus />
        </Field>
        <Field label="Reviewer" htmlFor="new-case-reviewer" hint="Who checks the report before it’s used. Only assigned reviewers can see the case. You can change this later.">
          <Select id="new-case-reviewer" name="reviewer" defaultValue={reviewers.find((r) => r.role === "reviewer")?.id ?? ""}>
            <option value="">No reviewer yet</option>
            {reviewers.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
                {r.role === "org_admin" ? " (administrator)" : ""}
              </option>
            ))}
          </Select>
        </Field>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-[13px] font-medium text-ink-secondary">How do you want to start?</legend>
          {(
            [
              ["notes", "Paste meeting notes", "The app proposes facts with their source sentence for you to confirm."],
              ["guided", "Start guided interview", "One question at a time, with the client summary beside it."],
            ] as const
          ).map(([value, title, text]) => (
            <label key={value} className={cx("flex cursor-pointer items-start gap-3 rounded border px-3.5 py-3 text-sm", mode === value ? "border-accent bg-accent-wash" : "border-line-strong hover:bg-hover")}>
              <input type="radio" name="mode" value={value} checked={mode === value} onChange={() => setMode(value)} className="mt-1 accent-[var(--color-accent)]" />
              <span className="flex flex-col gap-0.5">
                <span className="font-medium">{title}</span>
                <span className="text-[13px] text-ink-secondary">{text}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <div className="flex justify-end gap-2">
          <Button variant="tertiary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? "Creating…" : "Create case"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
