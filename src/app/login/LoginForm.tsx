"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button, Field, TextInput } from "@/components/ui";
import { api, ClientApiError } from "@/lib/client/api";

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="mt-5 flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        setBusy(true);
        setError(null);
        try {
          await api("/api/auth/login", { body: { email: String(fd.get("email")), password: String(fd.get("password")) } });
          router.replace(next);
          router.refresh();
        } catch (err) {
          setError(err instanceof ClientApiError ? err.message : "Sign-in failed");
          setBusy(false);
        }
      }}
    >
      {error && <Alert tone="bad">{error}</Alert>}
      <Field label="Email" htmlFor="email">
        <TextInput id="email" name="email" type="email" autoComplete="username" required />
      </Field>
      <Field label="Password" htmlFor="password">
        <TextInput id="password" name="password" type="password" autoComplete="current-password" required />
      </Field>
      <Button type="submit" variant="primary" disabled={busy} className="mt-1">
        {busy ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
