import type { Metadata } from "next";
import { CaptureView } from "./_capture-view";

export const metadata: Metadata = {
  title: "スコアブック撮影 | 草野球スコアブック",
};

export default function CapturePage() {
  return <CaptureView />;
}
