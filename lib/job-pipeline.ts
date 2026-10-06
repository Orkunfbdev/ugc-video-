import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { jobs } from "@/db/schema";
import { getDb } from "@/db";
import { falClient, publicError } from "@/lib/fal";
import { MERGE_MODEL, PRODUCT_MODEL } from "@/lib/creators";

type Job = typeof jobs.$inferSelect;

const now = () => new Date().toISOString();

async function claim(job: Job, nextStage: string) {
  const changed = await getDb().update(jobs)
    .set({ stage: nextStage, updatedAt: now() })
    .where(and(eq(jobs.id, job.id), eq(jobs.stage, job.stage)))
    .returning({ id: jobs.id });
  return changed.length > 0;
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
  if (!outputUrl) throw new Error("Fal video adresi döndürmedi.");

  if (!(await claim(job, `${job.stage.replace("_queued", "")}_submitting`))) return;
  const db = getDb();
  try {
    if (job.stage === "avatar_queued") {
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
        input: { video_urls: [job.avatarUrl, outputUrl], resolution: "portrait_16_9" },
      });
      await db.update(jobs).set({
        stage: "merge_queued", model: MERGE_MODEL, requestId: submitted.request_id,
        productVideoUrl: outputUrl, updatedAt: now(),
      }).where(eq(jobs.id, job.id));
    } else if (job.stage === "merge_queued") {
      await db.update(jobs).set({ stage: "complete", videoUrl: outputUrl, updatedAt: now() })
        .where(eq(jobs.id, job.id));
      if (env.BUCKET) {
        try {
          const response = await fetch(outputUrl);
          if (response.ok && response.body) {
            await env.BUCKET.put(`jobs/${job.id}/video.mp4`, response.body, {
              httpMetadata: { contentType: "video/mp4" },
            });
          }
        } catch (error) {
          console.error("Video storage copy failed", error);
        }
      }
    }
  } catch (error) {
    await db.update(jobs).set({ stage: "failed", error: publicError(error), updatedAt: now() })
      .where(eq(jobs.id, job.id));
  }
}

export function safeJob(job: Job) {
  return {
    id: job.id,
    creatorId: job.creatorId,
    script: job.script,
    stage: job.stage,
    videoUrl: job.videoUrl,
    error: job.error,
    createdAt: job.createdAt,
  };
}
