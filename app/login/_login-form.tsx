"use client";

import { type FormEvent, useState } from "react";
import { tryGetSupabaseBrowserClient } from "@/src/client/supabase/client";

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "sent"; email: string }
  | { kind: "error"; message: string };

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!email) return;
    setStatus({ kind: "submitting" });

    const { client, error } = tryGetSupabaseBrowserClient();
    if (!client) {
      setStatus({ kind: "error", message: error });
      return;
    }

    // Day 2 で emailRedirectTo を本番 origin に差し替える想定。
    const { error: signInError } = await client.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo:
          typeof window !== "undefined"
            ? `${window.location.origin}/games`
            : undefined,
      },
    });
    if (signInError) {
      setStatus({ kind: "error", message: signInError.message });
      return;
    }
    setStatus({ kind: "sent", email });
  }

  const submitting = status.kind === "submitting";

  return (
    <form onSubmit={onSubmit} style={{ marginTop: "1.5rem" }}>
      <label
        htmlFor="login-email"
        style={{
          display: "block",
          fontSize: "0.875rem",
          fontWeight: 600,
          marginBottom: "0.375rem",
        }}
      >
        メールアドレス
      </label>
      <input
        id="login-email"
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        disabled={submitting}
        autoComplete="email"
        inputMode="email"
        placeholder="you@example.com"
        style={{
          width: "100%",
          padding: "0.625rem 0.75rem",
          fontSize: "1rem",
          border: "1px solid #cbd5e1",
          borderRadius: 6,
          background: "#ffffff",
        }}
      />
      <button
        type="submit"
        disabled={submitting || !email}
        style={{
          marginTop: "1rem",
          width: "100%",
          padding: "0.625rem 1rem",
          fontSize: "1rem",
          fontWeight: 600,
          color: "#ffffff",
          background: submitting ? "#94a3b8" : "#0f172a",
          border: "none",
          borderRadius: 6,
          cursor: submitting ? "wait" : "pointer",
        }}
      >
        {submitting ? "送信中..." : "サインインリンクを送る"}
      </button>

      {status.kind === "sent" ? (
        <p
          role="status"
          style={{
            marginTop: "1rem",
            padding: "0.75rem",
            background: "#ecfdf5",
            color: "#065f46",
            borderRadius: 6,
            fontSize: "0.875rem",
          }}
        >
          {status.email} にサインインリンクを送りました。メールを確認してください。
        </p>
      ) : null}
      {status.kind === "error" ? (
        <p
          role="alert"
          style={{
            marginTop: "1rem",
            padding: "0.75rem",
            background: "#fef2f2",
            color: "#991b1b",
            borderRadius: 6,
            fontSize: "0.875rem",
            whiteSpace: "pre-wrap",
          }}
        >
          {status.message}
        </p>
      ) : null}
    </form>
  );
}
