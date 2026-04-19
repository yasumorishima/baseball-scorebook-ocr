"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type CameraState =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "streaming"; stream: MediaStream }
  | { kind: "error"; message: string };

// architecture §11.3: iOS Safari は `exact: 'environment'` で失敗するため
// `{ ideal: 'environment' }` にする。getUserMedia は Day 2 で jscanify +
// OpenCV.js に置き換える前提の最小スケルトン。
const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: { ideal: "environment" },
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    frameRate: { ideal: 30, max: 30 },
  },
};

export function CaptureView() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [state, setState] = useState<CameraState>({ kind: "idle" });

  useEffect(() => {
    if (state.kind !== "streaming") return;
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = state.stream;
    return () => {
      if (video) video.srcObject = null;
    };
  }, [state]);

  useEffect(() => {
    return () => {
      if (state.kind === "streaming") {
        for (const track of state.stream.getTracks()) track.stop();
      }
    };
  }, [state]);

  async function onStart() {
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      setState({
        kind: "error",
        message: "このブラウザはカメラ API をサポートしていません。",
      });
      return;
    }
    setState({ kind: "starting" });
    try {
      const stream = await navigator.mediaDevices.getUserMedia(
        CAMERA_CONSTRAINTS,
      );
      setState({ kind: "streaming", stream });
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  function onStop() {
    if (state.kind === "streaming") {
      for (const track of state.stream.getTracks()) track.stop();
    }
    setState({ kind: "idle" });
  }

  return (
    <main
      style={{
        padding: "1.5rem 1rem",
        maxWidth: 720,
        margin: "0 auto",
        fontFamily: "system-ui, sans-serif",
        color: "#0f172a",
      }}
    >
      <nav style={{ marginBottom: "0.75rem" }}>
        <Link
          href="/games"
          style={{ color: "#0f172a", fontSize: "0.875rem" }}
        >
          ← 試合一覧へ
        </Link>
      </nav>

      <h1 style={{ fontSize: "1.375rem", fontWeight: 700 }}>
        スコアブック撮影
      </h1>
      <p style={{ marginTop: "0.5rem", color: "#475569", lineHeight: 1.6 }}>
        スコアブックを真上から撮影してください。Day 2 で jscanify + OpenCV.js
        による 4 隅自動検出 + 透視変換に置き換えます。
      </p>

      <div
        style={{
          marginTop: "1rem",
          aspectRatio: "3 / 4",
          background: "#0f172a",
          borderRadius: 8,
          overflow: "hidden",
          position: "relative",
        }}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            display: state.kind === "streaming" ? "block" : "none",
          }}
        />
        {state.kind !== "streaming" ? (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
              color: "#cbd5e1",
              fontSize: "0.9375rem",
              textAlign: "center",
              padding: "1rem",
            }}
          >
            {state.kind === "starting" ? "カメラ起動中..." : null}
            {state.kind === "idle"
              ? "下のボタンでカメラを起動してください"
              : null}
            {state.kind === "error" ? (
              <span style={{ color: "#fca5a5" }}>{state.message}</span>
            ) : null}
          </div>
        ) : null}
      </div>

      <div
        style={{
          marginTop: "1rem",
          display: "flex",
          gap: "0.75rem",
          justifyContent: "center",
        }}
      >
        {state.kind === "streaming" ? (
          <>
            <button
              type="button"
              disabled
              title="Day 2 で jscanify + OpenCV.js 透視変換に接続予定"
              style={shutterButtonStyle}
            >
              撮影（Day 2 実装）
            </button>
            <button
              type="button"
              onClick={onStop}
              style={secondaryButtonStyle}
            >
              停止
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={onStart}
            disabled={state.kind === "starting"}
            style={primaryButtonStyle}
          >
            {state.kind === "starting" ? "起動中..." : "カメラを起動"}
          </button>
        )}
      </div>
    </main>
  );
}

const primaryButtonStyle: React.CSSProperties = {
  padding: "0.625rem 1.25rem",
  fontSize: "1rem",
  fontWeight: 600,
  color: "#ffffff",
  background: "#0f172a",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
};

const secondaryButtonStyle: React.CSSProperties = {
  padding: "0.625rem 1.25rem",
  fontSize: "1rem",
  fontWeight: 600,
  color: "#0f172a",
  background: "#ffffff",
  border: "1px solid #cbd5e1",
  borderRadius: 6,
  cursor: "pointer",
};

const shutterButtonStyle: React.CSSProperties = {
  padding: "0.625rem 1.25rem",
  fontSize: "1rem",
  fontWeight: 600,
  color: "#94a3b8",
  background: "#e2e8f0",
  border: "none",
  borderRadius: 6,
  cursor: "not-allowed",
};
