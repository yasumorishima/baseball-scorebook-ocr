import type { Metadata } from "next";
import { LoginForm } from "./_login-form";

export const metadata: Metadata = {
  title: "サインイン | 草野球スコアブック",
};

export default function LoginPage() {
  return (
    <main
      style={{
        padding: "2rem 1rem",
        maxWidth: 480,
        margin: "0 auto",
        fontFamily: "system-ui, sans-serif",
        color: "#0f172a",
      }}
    >
      <h1 style={{ fontSize: "1.5rem", fontWeight: 700 }}>サインイン</h1>
      <p style={{ marginTop: "0.75rem", lineHeight: 1.6, color: "#475569" }}>
        メールアドレス宛に届くリンクでサインインします。
        パスワードは使いません。
      </p>
      <LoginForm />
    </main>
  );
}
