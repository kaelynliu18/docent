/**
 * Prepare a camera photo for upload, in the browser: honour EXIF rotation,
 * shrink, and re-encode as JPEG. Re-encoding drops all metadata, including GPS.
 */
export async function preparePhoto(file: File) {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => null);
  if (!bitmap) throw new Error("unreadable");
  const encode = async (max: number, quality: number) => {
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", quality));
    if (!blob) throw new Error("encode");
    return { blob, w, h };
  };
  const full = await encode(2000, 0.86);
  const thumb = await encode(480, 0.8);
  bitmap.close();
  return { full: full.blob, thumb: thumb.blob, width: full.w, height: full.h };
}
