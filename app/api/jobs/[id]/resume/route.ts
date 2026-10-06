import { and, eq } from "drizzle-orm";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import { jobs } from "@/db/schema";
import { BOREAL_MODEL, TTS_MODEL } from "@/lib/creators";
import { falClient, publicError } from "@/lib/fal";
import { safeJob } from "@/lib/job-pipeline";
import { borealInput, type Scene } from "@/lib/storyboard";

export const runtime = "edge";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Oturum açmanız gerekiyor." }, { status: 401 });
  const { id } = await context.params;
  const db = getDb();
  const [job] = await db.select().from(jobs)
    .where(and(eq(jobs.id, id), eq(jobs.userId, user.userId))).limit(1);
  const hasVoice = job?.model === TTS_MODEL && !!job.avatarUrl;
  const hasFailedVideo = job?.model === BOREAL_MODEL && !!job.avatarUrl && !!job.audioUrl && job.duration > 20;
  if (!job || job.stage !== "failed" || job.provider !== "boreal" || (!hasVoice && !hasFailedVideo))
    return Response.json({ error: "Bu video kaldığı yerden devam ettirilemiyor." }, { status: 409 });
  const [resumed] = await db.update(jobs).set({ stage: hasVoice ? "scene_tts_queued" : "scene_submitting", error: null, updatedAt: new Date().toISOString() })
    .where(and(eq(jobs.id, id), eq(jobs.userId, user.userId), eq(jobs.stage, "failed")))
    .returning();
  if (!resumed) return Response.json({ error: "Video zaten devam ediyor." }, { status: 409 });
  if (hasVoice) return Response.json({ job: safeJob(resumed) });
  try {
    const scenes = JSON.parse(job.scenePlan ?? "[]") as Scene[];
    const scene = scenes[job.sceneIndex];
    if (!scene || !job.avatarUrl || !job.audioUrl) throw new Error("Hazır görsel veya ses bulunamadı.");
    const correctedScene = { ...scene, duration: 20 };
    const submitted = await falClient().queue.submit(BOREAL_MODEL, { input: borealInput(correctedScene, job.avatarUrl, job.audioUrl) });
    const [queued] = await db.update(jobs).set({ stage: "scene_queued", duration: 20, scenePlan: JSON.stringify([correctedScene]), requestId: submitted.request_id, updatedAt: new Date().toISOString() })
      .where(eq(jobs.id, id)).returning();
    return Response.json({ job: safeJob(queued) });
  } catch (error) {
    console.error("Boreal resume failed", { jobId: id, error });
    await db.update(jobs).set({ stage: "failed", error: publicError(error), updatedAt: new Date().toISOString() })
      .where(eq(jobs.id, id));
    return Response.json({ error: publicError(error) }, { status: 502 });
  }
}
