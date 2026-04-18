/**
 * 画像関連の型定義。
 *
 * `normalize()` の出力を表す {@link NormalizedImage} が主な公開型。
 */

export type ImageSize = {
  width: number;
  height: number;
};

export type MediaType = "image/jpeg" | "image/png" | "image/webp";

export type NormalizedImage = {
  /** 本体画像を base64 エンコードしたもの（Claude Vision API 送信用） */
  base64: string;
  /** 送信メディアタイプ（通常 image/jpeg） */
  mediaType: MediaType;
  /** 正規化前（EXIF 補正 / リサイズ前）のサイズ */
  origSize: ImageSize;
  /** 正規化後（送信される実サイズ） */
  sentSize: ImageSize;
  /** 正規化後のバイト数 */
  bytes: number;
};
