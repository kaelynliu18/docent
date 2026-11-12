import {
  AutoProcessor,
  AutoTokenizer,
  CLIPTextModelWithProjection,
  CLIPVisionModelWithProjection,
  RawImage,
  type PreTrainedTokenizer,
  type Processor,
} from "@huggingface/transformers";
import { EMBEDDING } from "@/lib/algo/config";
import { normalize } from "@/lib/algo/vectors";
import { periodOf } from "@/lib/algo/taste";

/**
 * CLIP image and text towers, loaded once per process. The model is open
 * (downloaded from Hugging Face on first use, then cached) and runs on CPU.
 */
type Vision = { proc: Processor; model: CLIPVisionModelWithProjection };
type Text = { tok: PreTrainedTokenizer; model: CLIPTextModelWithProjection };
let vision: Promise<Vision> | null = null;
let textTower: Promise<Text> | null = null;

function loadVision(): Promise<Vision> {
  vision ??= (async () => ({
    proc: await AutoProcessor.from_pretrained(EMBEDDING.model),
    model: await CLIPVisionModelWithProjection.from_pretrained(EMBEDDING.model, { dtype: EMBEDDING.dtype }),
  }))();
  return vision;
}

function loadText(): Promise<Text> {
  textTower ??= (async () => ({
    tok: await AutoTokenizer.from_pretrained(EMBEDDING.model),
    model: await CLIPTextModelWithProjection.from_pretrained(EMBEDDING.model, { dtype: EMBEDDING.dtype }),
  }))();
  return textTower;
}

/** Image bytes (JPEG/PNG/WebP) → normalised 512-d embedding. */
export async function embedImageBytes(bytes: Uint8Array): Promise<Float32Array> {
  const { proc, model } = await loadVision();
  const image = await RawImage.fromBlob(new Blob([new Uint8Array(bytes)]));
  const out = await model(await proc(image));
  return normalize(out.image_embeds.data as Float32Array);
}

/** The text we embed for a painting: what a person would say about it. */
export function artworkText(a: { title: string; artistName: string; year: number | null; movements: string[]; genres: string[] }): string {
  const period = periodOf(a.year)?.name;
  return [`${a.title} by ${a.artistName}`, a.movements.join(", "), a.genres.join(", "), period ? `${period} painting` : "painting"]
    .filter(Boolean)
    .join(". ");
}

/** Texts → normalised embeddings, in batches (CLIP truncates at 77 tokens). */
export async function embedTexts(texts: string[], batch = 32): Promise<Float32Array[]> {
  const { tok, model } = await loadText();
  const out: Float32Array[] = [];
  for (let i = 0; i < texts.length; i += batch) {
    const inputs = tok(texts.slice(i, i + batch), { padding: true, truncation: true });
    const res = await model(inputs);
    const data = res.text_embeds.data as Float32Array;
    const d = res.text_embeds.dims[1] as number;
    for (let r = 0; r * d < data.length; r++) out.push(normalize(data.subarray(r * d, (r + 1) * d)));
  }
  return out;
}

/** Raw RGBA pixels → normalised embedding (the eval feeds distorted images this way). */
export async function embedRgba(data: Uint8ClampedArray, width: number, height: number): Promise<Float32Array> {
  const { proc, model } = await loadVision();
  const rgb = new Uint8ClampedArray(width * height * 3);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
    rgb[j] = data[i];
    rgb[j + 1] = data[i + 1];
    rgb[j + 2] = data[i + 2];
  }
  const out = await model(await proc(new RawImage(rgb, width, height, 3)));
  return normalize(out.image_embeds.data as Float32Array);
}
