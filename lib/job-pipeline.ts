import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { jobs } from "@/db/schema";
import { getDb } from "@/db";
import { falClient, publicError } from "@/lib/fal";
import { AUDIO_MERGE_MODEL, BOREAL_MODEL, FRAME_MODEL, MERGE_MODEL, PRODUCT_MODEL, SCENE_MODEL, TTS_MODEL } from "@/lib/creators";
import { borealInput, openingFramePrompt, type Scene } from "@/lib/storyboard";

type Job = typeof jobs.$inferSelect;

const now = () => new Date().toISOString();

async function claim(job: Job, nextStage: string) {
  const changed = await getDb().update(jobs)
    .set({ stage: nextStage, updatedAt: now() })
    .where(and(eq(jobs.id, job.id), eq(jobs.stage, job.stage)))
    .returning({ id: jobs.id });
  return changed.length > 0;
}

async function afterScene(job: Job, sceneUrl: string, fal: ReturnType<typeof falClient>) {
  const scenes = JSON.parse(job.scenePlan ?? "[]") as Scene[];
  const urls = [...JSON.parse(job.sceneVideoUrls ?? "[]") as string[], sceneUrl];
  const nextIndex = job.sceneIndex + 1;
  if (nextIndex < scenes.length) {
    if (!job.creatorImageUrl) throw new Error("Model fotoğrafı kayıp.");
    const submitted = await fal.queue.submit(FRAME_MODEL, { input: {
      image_urls: [job.creatorImageUrl, job.productImageUrl],
      prompt: `Create a photorealistic vertical 9:16 opening frame for the next shot of the same product ad. Image 1 is the person; preserve their identity and facial features. Image 2 is the actual product; preserve its shape, colors and any readable branding. Do not invent extra products or misleading labels. Scene: ${scenes[nextIndex].prompt}`,
      aspect_ratio: "9:16", num_images: 1, output_format: "png",
    } });
    await getDb().update(jobs).set({ stage: "frame_queued", model: FRAME_MODEL, requestId: submitted.request_id,
      sceneIndex: nextIndex, sceneVideoUrls: JSON.stringify(urls), updatedAt: now() }).where(eq(jobs.id, job.id));
  } else if (scenes.every((scene) => scene.speech)) {
    const submitted = await fal.queue.submit(MERGE_MODEL, { input: {
      video_urls: urls, resolution: "portrait_16_9",
    } });
    await getDb().update(jobs).set({ stage: "merge_queued", model: MERGE_MODEL, requestId: submitted.request_id,
      sceneVideoUrls: JSON.stringify(urls), updatedAt: now() }).where(eq(jobs.id, job.id));
  } else {
    if (!job.voiceover) throw new Error("Dış ses metni eksik.");
    const submitted = await fal.queue.submit(TTS_MODEL, { input: {
      text: job.voiceover, voice: "Sarah", language_code: "tr", stability: 0.45,
    } });
    await getDb().update(jobs).set({ stage: "tts_queued", model: TTS_MODEL, requestId: submitted.request_id,
      sceneVideoUrls: JSON.stringify(urls), updatedAt: now() }).where(eq(jobs.id, job.id));
  }
}

async function afterBorealScene(job: Job, sceneUrl: string, fal: ReturnType<typeof falClient>) {
  const scenes = JSON.parse(job.scenePlan ?? "[]") as Scene[];
  const urls = [...JSON.parse(job.sceneVideoUrls ?? "[]") as string[], sceneUrl];
  const nextIndex = job.sceneIndex + 1;
  if (nextIndex < scenes.length) {
    if (!job.creatorImageUrl) throw new Error("Model fotoğrafı kayıp.");
    const submitted = await fal.queue.submit(FRAME_MODEL, { input: {
      image_urls: [job.creatorImageUrl, job.productImageUrl],
      prompt: openingFramePrompt(scenes[nextIndex]),
      aspect_ratio: "9:16", num_images: 1, output_format: "png",
    } });
    await getDb().update(jobs).set({ stage: "frame_queued", model: FRAME_MODEL, requestId: submitted.request_id,
      sceneIndex: nextIndex, sceneVideoUrls: JSON.stringify(urls), updatedAt: now() }).where(eq(jobs.id, job.id));
  } else if (urls.length === 1) {
    await finishJob(job.id, sceneUrl);
  } else {
    const submitted = await fal.queue.submit(MERGE_MODEL, { input: { video_urls: urls, resolution: "portrait_16_9" } });
    await getDb().update(jobs).set({ stage: "merge_queued", model: MERGE_MODEL, requestId: submitted.request_id,
      sceneVideoUrls: JSON.stringify(urls), updatedAt: now() }).where(eq(jobs.id, job.id));
  }
}

export async function advanceJob(job: Job): Promise<void> {
  if (!job.stage.endsWith("_queued")) return;
  const fal = falClient();
  const status = await fal.queue.status(job.model, { requestId: job.requestId });
  if (status.status !== "COMPLETED") return;

  const result = await fal.queue.result(job.model, { requestId: job.requestId });
  const data = result.data as {
    video?: { url?: string };
    moderation_flagged?: boolean;
    moderation_transcription?: string;
    moderation_error?: string;
  };
  const outputUrl = data.video?.url;
  const imageUrl = (result.data as { images?: { url?: string }[] }).images?.[0]?.url;
  const audioFile = (result.data as { audio?: { url?: string; file_size?: number } }).audio;
  const audioUrl = audioFile?.url;
  if (job.stage === "frame_queued" ? !imageUrl : ["tts_queued", "scene_tts_queued"].includes(job.stage) ? !audioUrl : !outputUrl) {
    await getDb().update(jobs).set({ stage: "failed", error: "Fal beklenen medya dosyasını döndürmedi.", updatedAt: now() })
      .where(and(eq(jobs.id, job.id), eq(jobs.stage, job.stage)));
    return;
  }

  if (!(await claim(job, `${job.stage.replace("_queued", "")}_submitting`))) return;
  const db = getDb();
  try {
    if (job.provider === "boreal" && job.stage === "frame_queued") {
      const scene = (JSON.parse(job.scenePlan ?? "[]") as Scene[])[job.sceneIndex];
      if (!scene?.speech || !imageUrl) throw new Error("Sahne konuşması veya görseli eksik.");
      const submitted = await fal.queue.submit(TTS_MODEL, { input: {
        text: scene.speech, voice: "Sarah", language_code: "tr", stability: 0.45,
      } });
      await db.update(jobs).set({ stage: "scene_tts_queued", model: TTS_MODEL, requestId: submitted.request_id,
        avatarUrl: imageUrl, updatedAt: now() }).where(eq(jobs.id, job.id));
    } else if (job.provider === "boreal" && job.stage === "scene_tts_queued") {
      const scene = (JSON.parse(job.scenePlan ?? "[]") as Scene[])[job.sceneIndex];
      if (!scene || !job.avatarUrl || !audioUrl) throw new Error("Sahne görseli veya Türkçe ses eksik.");
      // Eleven v3 defaults to 128 kbps MP3. Let the video finish the full speech instead of clipping it.
      let audioBytes = audioFile?.file_size ?? 0;
      if (!audioBytes) {
        try {
          const response = await fetch(audioUrl);
          if (response.ok) audioBytes = (await response.arrayBuffer()).byteLength;
        } catch { /* Fal file metadata is optional; use the text estimate below. */ }
      }
      const speechSeconds = audioBytes ? audioBytes / 16_000 : (scene.speech?.length ?? 0) / 12;
      await db.update(jobs).set({ audioUrl, updatedAt: now() }).where(eq(jobs.id, job.id));
      if (speechSeconds > 20) throw new Error(`Konuşma yaklaşık ${speechSeconds.toFixed(1)} saniye; Boreal en fazla 20 saniye kabul ediyor. Video isteği gönderilmedi.`);
      const actualDuration = Math.min(20, Math.max(scene.duration, Math.ceil(speechSeconds + 0.25)));
      const fullScene = { ...scene, duration: actualDuration };
      // Keep the paid audio result even if the video submission fails.
      await db.update(jobs).set({ duration: actualDuration, updatedAt: now() })
        .where(eq(jobs.id, job.id));
      const submitted = await fal.queue.submit(BOREAL_MODEL, { input: borealInput(fullScene, job.avatarUrl, audioUrl) });
      await db.update(jobs).set({ stage: "scene_queued", model: BOREAL_MODEL, requestId: submitted.request_id,
        scenePlan: JSON.stringify([fullScene]), updatedAt: now() }).where(eq(jobs.id, job.id));
    } else if (job.provider === "boreal" && job.stage === "scene_queued") {
      await afterBorealScene(job, outputUrl!, fal);
    } else if (job.stage === "frame_queued") {
      const scenes = JSON.parse(job.scenePlan ?? "[]") as Scene[];
      const scene = scenes[job.sceneIndex];
      if (!scene || !imageUrl) throw new Error("Sahne planı eksik.");
      const isLast = job.sceneIndex === scenes.length - 1;
      const submitted = await fal.queue.submit(SCENE_MODEL, { input: {
        start_image_url: imageUrl,
        prompt: `${scene.prompt}\nPhotorealistic UGC product video. Keep the person's identity and the supplied product consistent. Natural handheld camera motion. No captions or invented text. ${isLast ? "Finish the action calmly, settle the camera, hold a clear closing view of the product for the final second; no sudden movement at the cut." : "Complete the action before the end of this clip for a smooth cut to the next shot."}`,
        duration: String(scene.duration) as "3", generate_audio: false,
      } });
      await db.update(jobs).set({ stage: "scene_queued", model: SCENE_MODEL, requestId: submitted.request_id, updatedAt: now() })
        .where(eq(jobs.id, job.id));
    } else if (job.stage === "scene_queued") {
      const scenes = JSON.parse(job.scenePlan ?? "[]") as Scene[];
      const scene = scenes[job.sceneIndex];
      if (scene?.speech) {
        const submitted = await fal.queue.submit(TTS_MODEL, { input: {
          text: scene.speech, voice: "Sarah", language_code: "tr", stability: 0.45,
        } });
        await db.update(jobs).set({ stage: "scene_tts_queued", model: TTS_MODEL, requestId: submitted.request_id,
          avatarUrl: outputUrl, updatedAt: now() }).where(eq(jobs.id, job.id));
      } else {
        await afterScene(job, outputUrl!, fal);
      }
    } else if (job.stage === "scene_tts_queued") {
      if (!job.avatarUrl || !audioUrl) throw new Error("Sahne videosu veya konuşma sesi kayıp.");
      const submitted = await fal.queue.submit(AUDIO_MERGE_MODEL, { input: {
        video_url: job.avatarUrl, audio_url: audioUrl,
      } });
      await db.update(jobs).set({ stage: "scene_audio_merge_queued", model: AUDIO_MERGE_MODEL,
        requestId: submitted.request_id, updatedAt: now() }).where(eq(jobs.id, job.id));
    } else if (job.stage === "scene_audio_merge_queued") {
      await afterScene(job, outputUrl!, fal);
    } else if (job.stage === "tts_queued") {
      const urls = JSON.parse(job.sceneVideoUrls ?? "[]") as string[];
      if (!urls.length || !audioUrl) throw new Error("Sahneler veya dış ses kayıp.");
      const submitted = await fal.queue.submit(MERGE_MODEL, { input: {
        video_urls: urls, resolution: "portrait_16_9",
      } });
      await db.update(jobs).set({ stage: "merge_queued", model: MERGE_MODEL, requestId: submitted.request_id,
        audioUrl, updatedAt: now() }).where(eq(jobs.id, job.id));
    } else if (job.stage === "avatar_queued") {
      if (data.moderation_flagged) throw new Error("İçerik moderasyon tarafından reddedildi.");
      const submitted = await fal.queue.submit(PRODUCT_MODEL, {
        input: { images: [{ url: job.productImageUrl, frames: 72 }], fps: 24 },
      });
      await db.update(jobs).set({
        stage: "product_queued", model: PRODUCT_MODEL, requestId: submitted.request_id,
        avatarUrl: outputUrl,
        moderationFlagged: data.moderation_flagged ?? null,
        moderationTranscription: data.moderation_transcription ?? null,
        moderationError: data.moderation_error ?? null,
        updatedAt: now(),
      }).where(eq(jobs.id, job.id));
    } else if (job.stage === "product_queued") {
      if (!job.avatarUrl) throw new Error("Avatar videosu kayıp.");
      const submitted = await fal.queue.submit(MERGE_MODEL, {
        input: { video_urls: [job.avatarUrl, outputUrl!], resolution: "portrait_16_9" },
      });
      await db.update(jobs).set({
        stage: "merge_queued", model: MERGE_MODEL, requestId: submitted.request_id,
        productVideoUrl: outputUrl, updatedAt: now(),
      }).where(eq(jobs.id, job.id));
    } else if (job.stage === "merge_queued") {
      if (job.kind === "storyboard") {
        const scenes = JSON.parse(job.scenePlan ?? "[]") as Scene[];
        if (scenes.length && scenes.every((scene) => scene.speech)) {
          await finishJob(job.id, outputUrl!);
          return;
        }
        if (!job.audioUrl) throw new Error("Dış ses dosyası kayıp.");
        const submitted = await fal.queue.submit(AUDIO_MERGE_MODEL, { input: {
          video_url: outputUrl!, audio_url: job.audioUrl,
        } });
        await db.update(jobs).set({ stage: "audio_merge_queued", model: AUDIO_MERGE_MODEL,
          requestId: submitted.request_id, updatedAt: now() }).where(eq(jobs.id, job.id));
        return;
      }
      await finishJob(job.id, outputUrl!);
    } else if (job.stage === "audio_merge_queued") {
      await finishJob(job.id, outputUrl!);
    }
  } catch (error) {
    console.error("Job step failed", { jobId: job.id, stage: job.stage, model: job.model, error });
    await db.update(jobs).set({ stage: "failed", error: publicError(error), updatedAt: now() })
      .where(eq(jobs.id, job.id));
  }
}

async function finishJob(id: string, outputUrl: string) {
  const db = getDb();
  await db.update(jobs).set({ stage: "complete", videoUrl: outputUrl, updatedAt: now() })
    .where(eq(jobs.id, id));
  if (env.BUCKET) {
    try {
      const response = await fetch(outputUrl);
      if (response.ok && response.body) {
        await env.BUCKET.put(`jobs/${id}/video.mp4`, response.body, {
          httpMetadata: { contentType: "video/mp4" },
        });
      }
    } catch (error) {
      console.error("Video storage copy failed", error);
    }
  }
}

export function safeJob(job: Job) {
  return {
    id: job.id,
    creatorId: job.creatorId,
    script: job.script,
    kind: job.kind,
    duration: job.duration,
    sceneIndex: job.sceneIndex,
    sceneCount: job.scenePlan ? (JSON.parse(job.scenePlan) as Scene[]).length : 0,
    stage: job.stage,
    videoUrl: job.videoUrl,
    error: job.error,
    canResume: job.stage === "failed" && job.provider === "boreal" && !!job.avatarUrl &&
      ((job.model === TTS_MODEL && !job.error?.startsWith("Konuşma Boreal") && !job.error?.startsWith("Konuşma yaklaşık")) ||
        (job.model === BOREAL_MODEL && !!job.audioUrl && job.duration > 20)),
    createdAt: job.createdAt,
  };
}
