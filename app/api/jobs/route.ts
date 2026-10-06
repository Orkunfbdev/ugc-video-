import { env } from "cloudflare:workers";
import { and, desc, eq, notInArray } from "drizzle-orm";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import { jobs } from "@/db/schema";
import { ARGIL_MODEL, creators, FRAME_MODEL, HEYGEN_MODEL } from "@/lib/creators";
import { falClient, publicError, validImage } from "@/lib/fal";
import { safeJob } from "@/lib/job-pipeline";
import { maxVoiceWords, parseStoryboard, promptKind, wordCount } from "@/lib/storyboard";

export const runtime = "edge";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Oturum açmanız gerekiyor." }, { status: 401 });
  const items = await getDb().select().from(jobs)
    .where(eq(jobs.userId, user.userId)).orderBy(desc(jobs.createdAt)).limit(12);
  return Response.json({ jobs: items.map(safeJob) });
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Oturum açmanız gerekiyor." }, { status: 401 });
  if (!env.FAL_KEY) return Response.json({ error: "Fal API anahtarı henüz eklenmedi." }, { status: 503 });

  const form = await request.formData();
  const script = String(form.get("script") ?? "").trim();
  const kind = promptKind(script);
  const duration = Number(form.get("duration") ?? 20);
  const creatorId = String(form.get("creatorId") ?? "");
  const creator = creators.find((item) => item.id === creatorId);
  const isCustom = creatorId === "custom";
  const productFile = form.get("productImage");
  const creatorFile = form.get("creatorImage");

  if (!validImage(productFile)) return Response.json({ error: "8 MB altında JPG, PNG veya WebP ürün fotoğrafı yükleyin." }, { status: 400 });
  if ((!creator && !isCustom) || ((isCustom || creator?.kind === "photo") && !validImage(creatorFile))) {
    return Response.json({ error: "Bir hazır model seçin veya geçerli bir kişi fotoğrafı yükleyin." }, { status: 400 });
  }
  if (![10, 20, 30].includes(duration))
    return Response.json({ error: "Geçerli video süresi seçin." }, { status: 400 });
  if (script.length < 12 || script.length > 5000)
    return Response.json({ error: "Prompt 12–5000 karakter olmalı." }, { status: 400 });
  if (kind === "storyboard" && creator?.kind === "argil")
    return Response.json({ error: "Sahneli reklam için fotoğraflı bir model seçin." }, { status: 400 });
  let storyboard: ReturnType<typeof parseStoryboard> | null = null;
  try {
    if (kind === "storyboard") storyboard = parseStoryboard(script, duration);
    else if (wordCount(script) > maxVoiceWords(duration))
      throw new Error(`${duration} saniyelik hedefe en fazla ${maxVoiceWords(duration)} kelime önerilir. Metni kısaltın veya süreyi artırın.`);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Metin geçersiz." }, { status: 400 });
  }

  const db = getDb();
  const active = await db.select({ id: jobs.id }).from(jobs)
    .where(and(eq(jobs.userId, user.userId), notInArray(jobs.stage, ["complete", "failed"]))).limit(2);
  if (active.length >= 2) {
    return Response.json({ error: "Aynı anda en fazla iki video oluşturabilirsiniz." }, { status: 429 });
  }

  try {
    const fal = falClient();
    const id = crypto.randomUUID();
    const productImageUrl = await fal.storage.upload(productFile);
    await env.BUCKET?.put(`jobs/${id}/product.jpg`, productFile.stream(), {
      httpMetadata: { contentType: productFile.type },
    });

    let provider: "argil" | "heygen" | "kling";
    let model: string;
    let input: Record<string, unknown>;
    let creatorImageUrl: string | null = null;
    if (creator?.kind !== "argil") {
      const image = creatorFile as File;
      creatorImageUrl = await fal.storage.upload(image);
      await env.BUCKET?.put(`jobs/${id}/creator`, image.stream(), {
        httpMetadata: { contentType: image.type },
      });
    }
    if (storyboard) {
      provider = "kling";
      model = FRAME_MODEL;
      input = {
        image_urls: [creatorImageUrl, productImageUrl],
        prompt: `Create a photorealistic vertical 9:16 opening frame for a social media product ad. Image 1 is the person; preserve their identity and facial features. Image 2 is the actual product; preserve its shape, colors and any readable branding. Do not invent extra products or misleading labels. Scene: ${storyboard.scenes[0].prompt}`,
        aspect_ratio: "9:16", num_images: 1, output_format: "png",
      };
    } else if (creator?.kind === "argil") {
      provider = "argil";
      model = ARGIL_MODEL;
      input = { avatar: creator.avatar, text: script, voice: "Rachel", remove_background: false };
    } else {
      provider = "heygen";
      model = HEYGEN_MODEL;
      input = {
        image_url: creatorImageUrl,
        prompt: script,
        voice: "Melissa",
        talking_style: "expressive",
        aspect_ratio: "9:16",
        resolution: "720p",
        background: { type: "image", value: productImageUrl },
      };
    }
    const submitted = await fal.queue.submit(model, { input });
    const timestamp = new Date().toISOString();
    const stage = storyboard ? "frame_queued" : "avatar_queued";
    await db.insert(jobs).values({
      id, userId: user.userId, creatorId, provider, model, script, kind, duration,
      scenePlan: storyboard ? JSON.stringify(storyboard.scenes) : null,
      sceneVideoUrls: storyboard ? "[]" : null,
      creatorImageUrl, voiceover: storyboard?.voiceover ?? null,
      productImageUrl, requestId: submitted.request_id, stage,
      createdAt: timestamp, updatedAt: timestamp,
    });
    return Response.json({ job: { id, stage } }, { status: 202 });
  } catch (error) {
    console.error("Generation submit failed", error);
    return Response.json({ error: publicError(error) }, { status: 502 });
  }
}
