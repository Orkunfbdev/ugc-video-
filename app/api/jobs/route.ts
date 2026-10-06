import { env } from "cloudflare:workers";
import { and, desc, eq, notInArray } from "drizzle-orm";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import { jobs } from "@/db/schema";
import { creators, FRAME_MODEL } from "@/lib/creators";
import { falClient, publicError, validImage } from "@/lib/fal";
import { safeJob } from "@/lib/job-pipeline";
import { openingFramePrompt, parseTalking, parseStoryboard, promptKind } from "@/lib/storyboard";

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
  if ((!creator && !isCustom) || !validImage(creatorFile)) {
    return Response.json({ error: "Bir hazır model seçin veya geçerli bir kişi fotoğrafı yükleyin." }, { status: 400 });
  }
  if (![10, 20, 30].includes(duration))
    return Response.json({ error: "Geçerli video süresi seçin." }, { status: 400 });
  if (script.length < 12 || script.length > 5000)
    return Response.json({ error: "Prompt 12–5000 karakter olmalı." }, { status: 400 });
  let scenes: ReturnType<typeof parseStoryboard>["scenes"];
  try {
    scenes = kind === "storyboard" ? parseStoryboard(script, duration).scenes : [parseTalking(script, duration)];
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

    const image = creatorFile as File;
    const creatorImageUrl = await fal.storage.upload(image);
    await env.BUCKET?.put(`jobs/${id}/creator`, image.stream(), {
      httpMetadata: { contentType: image.type },
    });
    const submitted = await fal.queue.submit(FRAME_MODEL, { input: {
      image_urls: [creatorImageUrl, productImageUrl],
      prompt: openingFramePrompt(scenes[0]),
      aspect_ratio: "9:16", num_images: 1, output_format: "png",
    } });
    const timestamp = new Date().toISOString();
    const stage = "frame_queued";
    await db.insert(jobs).values({
      id, userId: user.userId, creatorId, provider: "boreal", model: FRAME_MODEL, script, kind, duration,
      scenePlan: JSON.stringify(scenes), sceneVideoUrls: "[]",
      creatorImageUrl, voiceover: scenes.map((scene) => scene.speech).join(" "),
      productImageUrl, requestId: submitted.request_id, stage,
      createdAt: timestamp, updatedAt: timestamp,
    });
    return Response.json({ job: { id, stage } }, { status: 202 });
  } catch (error) {
    console.error("Generation submit failed", error);
    return Response.json({ error: publicError(error) }, { status: 502 });
  }
}
