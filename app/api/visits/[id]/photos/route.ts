import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { requireUserId } from "@/lib/server/session";
import { addPhoto, assertCanUpload } from "@/lib/server/visits";
import { deletePhoto, isJpeg, putPhoto } from "@/lib/server/storage";
import { ApiError, handle } from "@/lib/server/errors";

const MAX_BYTES = 6 * 1024 * 1024;
const dim = (v: FormDataEntryValue | null) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n <= 10000 ? n : null;
};

/** One photo per request: the browser sends a resized JPEG plus a thumbnail (EXIF, incl. GPS, already stripped). */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const userId = await requireUserId();
  const { id } = await ctx.params;
  const db = await getDb();
  await assertCanUpload(db, userId, id);
  const form = await req.formData().catch(() => null);
  const full = form?.get("photo");
  const thumb = form?.get("thumb");
  if (!(full instanceof Blob) || !(thumb instanceof Blob)) {
    throw new ApiError(400, "no_photo", "That upload didn't include a photo. Try again.");
  }
  if (full.size > MAX_BYTES || thumb.size > MAX_BYTES) {
    throw new ApiError(413, "too_large", "That photo is too large. Try a smaller one.");
  }
  const a = new Uint8Array(await full.arrayBuffer());
  const b = new Uint8Array(await thumb.arrayBuffer());
  if (!isJpeg(a) || !isJpeg(b)) throw new ApiError(415, "not_jpeg", "We couldn't read that photo. Try a JPEG or PNG.");
  const key = await putPhoto(a, b);
  try {
    const row = await addPhoto(db, userId, id, { storageKey: key, width: dim(form!.get("width")), height: dim(form!.get("height")) });
    return NextResponse.json({ id: row.id }, { status: 201 });
  } catch (e) {
    await deletePhoto(key);
    throw e;
  }
});
