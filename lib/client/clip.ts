"use client";

import { EMBEDDING } from "@/lib/algo/config";

/**
 * CLIP image embeddings in the browser (transformers.js, WebAssembly), with the
 * same model as the catalogue, so a photo can be matched without ever leaving
 * the phone: only the 512 numbers are sent. The model (~90 MB) downloads on
 * first use and is cached by the browser after that.
 */
type Loaded = {
  proc: (img: unknown) => Promise<unknown>;
  model: (inputs: unknown) => Promise<{ image_embeds: { data: Float32Array } }>;
  RawImage: { fromCanvas?: unknown; fromBlob: (b: Blob) => Promise<unknown> };
};
let loading: Promise<Loaded> | null = null;
const READY_KEY = "docent.scan.ready";

export function scanModelCached(): boolean {
  try {
    return localStorage.getItem(READY_KEY) === "1";
  } catch {
    return false;
  }
}

function load(onProgress?: (fraction: number) => void): Promise<Loaded> {
  loading ??= (async () => {
    const t = await import("@huggingface/transformers");
    t.env.allowLocalModels = false;
    const progress = (p: { status?: string; progress?: number }) => {
      if (p.status === "progress" && typeof p.progress === "number") onProgress?.(p.progress / 100);
    };
    const [proc, model] = await Promise.all([
      t.AutoProcessor.from_pretrained(EMBEDDING.model, { progress_callback: progress }),
      t.CLIPVisionModelWithProjection.from_pretrained(EMBEDDING.model, { dtype: EMBEDDING.dtype, progress_callback: progress }),
    ]);
    try {
      localStorage.setItem(READY_KEY, "1");
    } catch {}
    return { proc: proc as unknown as Loaded["proc"], model: model as unknown as Loaded["model"], RawImage: t.RawImage as unknown as Loaded["RawImage"] };
  })();
  loading.catch(() => (loading = null));
  return loading;
}

/**
 * Upright, downscaled copy of the photo, optionally keeping only the centre
 * `crop` fraction (cuts wall and frame around a painting).
 */
async function prepare(file: Blob, crop: number): Promise<Blob> {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const cw = bmp.width * crop;
  const ch = bmp.height * crop;
  const scale = Math.min(1, 640 / Math.max(cw, ch));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(cw * scale);
  canvas.height = Math.round(ch * scale);
  canvas.getContext("2d")!.drawImage(bmp, (bmp.width - cw) / 2, (bmp.height - ch) / 2, cw, ch, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("couldn't read the photo"))), "image/jpeg", 0.92));
}

/** Photo → normalised 512-d CLIP embedding. */
export async function embedPhoto(file: Blob, opts: { crop?: number; onProgress?: (f: number) => void } = {}): Promise<number[]> {
  const [{ proc, model, RawImage }, blob] = await Promise.all([load(opts.onProgress), prepare(file, opts.crop ?? 1)]);
  const out = await model(await proc(await RawImage.fromBlob(blob)));
  const v = Array.from(out.image_embeds.data);
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
}
