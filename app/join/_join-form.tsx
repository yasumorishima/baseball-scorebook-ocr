"use client";

import { type FormEvent, useState } from "react";
import { tryGetSupabaseBrowserClient } from "@/src/client/supabase/client";

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "joined"; teamId: string }
  | { kind: "error"; message: string };

// architecture §10.2: nanoid 8 字 (0/O/1/I/l 除外、57 文字 alphabet)。
const INVITE_CODE_LENGTH = 8;

export function JoinForm({ initialCode }: { initialCode: string }) {
  const [code, setCode] = useState(initialCode);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (code.length !== INVITE_CODE_LENGTH) return;
    setStatus({ kind: "submitting" });

    const { client, error } = tryGetSupabaseBrowserClient();
    if (!client) {
      setStatus({ kind: "error", message: error });
      return;
    }

    // architecture §10.3: redeem_invitation は SECURITY DEFINER で
    // rate limit + team_members 追加 + use_count++ を 1 トランザクションで実行。
    const { data, error: rpcError } = await client.rpc("redeem_invitation", {
      p_code: code,
    });
    if (rpcError) {
      setStatus({ kind: "error", message: rpcError.message });
      return;
    }
    setStatus({ kind: "joined", teamId: String(data) });
  }

  const submitting = status.kind === "submitting";
  const disabled = submitting || code.length !== INVITE_CODE_LENGTH;

  return (
    <form onSubmit={onSubmit} style={{ marginTop: "1.5rem" }}>
      <label
        htmlFor="invite-code"
        style={{
          display: "block",
          fontSize: "0.875rem",
          fontWeight: 600,
          marginBottom: "0.375rem",
        }}
      >
        招待コード（8 文字）
      </label>
      <input
        id="invite-code"
        type="text"
        required
        value={code}
        onChange={(e) => setCode(e.target.value.trim())}
        disabled={submitting}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        maxLength={INVITE_CODE_LENGTH}
        placeholder="例: 3aB7kQmZ"
        style={{
          width: "100%",
          padding: "0.625rem 0.75rem",
          fontSize: "1.125rem",
          letterSpacing: "0.1em",
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          border: "1px solid #cbd5e1",
          borderRadius: 6,
          background: "#ffffff",
        }}
      />
      <button
        type="submit"
        disabled={disabled}
        style={{
          marginTop: "1rem",
          width: "100%",
          padding: "0.625rem 1rem",
          fontSize: "1rem",
          fontWeight: 600,
          color: "#ffffff",
          background: disabled ? "#94a3b8" : "#0f172a",
          border: "none",
          borderRadius: 6,
          cursor: submitting ? "wait" : disabled ? "not-allowed" : "pointer",
        }}
      >
        {submitting ? "参加中..." : "このコードで参加する"}
      </button>

      {status.kind === "joined" ? (
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
          チームに参加しました。team_id:{" "}
          <code style={{ background: "#d1fae5" }}>{status.teamId}</code>
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
