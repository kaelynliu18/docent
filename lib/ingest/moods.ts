import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod/v4";
import { MOODS, cleanMoods } from "@/lib/algo/look";
import { politeFetch } from "@/lib/ingest/looks";
const MOOD_IDS = Object.keys(MOODS) as [string, ...string[]];

const MoodSchema = z.object({ moods: z.array(z.enum(MOOD_IDS)).min(1).max(3) });

const SYSTEM = `You tag paintings with the mood a viewer feels in front of them, for an art recommendation app.
Choose 1 to 3 moods from this fixed list, strongest first: ${MOOD_IDS.join(", ")}.
Judge the feeling the image gives (colour, light, composition, subject's expression), not the painting's fame or backstory.
Pick fewer moods rather than weak ones.`;

/**
 * Fetches a Commons thumbnail as base64 JPEG/PNG for the vision request. `thumbUrl` should be a
 * standard-size link from `thumbUrls(…, 500)`: odd sizes (the old ?width=512) are rendered on
 * demand and Commons throttled them after ~50, skipping almost the whole pool.
 */
async function thumbnail(thumbUrl: string): Promise<{ data: string; mediaType: "image/jpeg" | "image/png" } | null> {
  const res = await politeFetch(thumbUrl);
  if (!res?.ok) return null;
  const type = res.headers.get("content-type") ?? "";
  const mediaType = type.includes("png") ? "image/png" : type.includes("jpeg") ? "image/jpeg" : null;
  if (!mediaType) return null;
  return { data: Buffer.from(await res.arrayBuffer()).toString("base64"), mediaType };
}

/**
 * 1–3 moods for one painting, or null if the image can't be fetched or the
 * model declines. Moods are optional everywhere, so a miss just means "untagged".
 */
export async function tagMoods(client: Anthropic, p: { title: string; thumbUrl: string }): Promise<string[] | null> {
  const img = await thumbnail(p.thumbUrl);
  if (!img) return null;
  const response = await client.messages.parse({
    model: "claude-opus-5-5",
    max_tokens: 4000,
    output_config: { effort: "low", format: zodOutputFormat(MoodSchema) },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: img.mediaType, data: img.data } },
          { type: "text", text: `Painting: ${p.title}` },
        ],
      },
    ],
  });
  if (response.stop_reason === "refusal" || !response.parsed_output) return null;
  const moods = cleanMoods(response.parsed_output.moods);
  return moods.length ? moods : null;
}
