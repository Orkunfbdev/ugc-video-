import { and, eq } from "drizzle-orm";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import { jobs } from "@/db/schema";
import { TTS_MODEL } from "@/lib/creators";
import { safeJob } from "@/lib/job-pipeline";

export const runtime = "edge";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Oturum açmanız gerekiyor." }, { status: 401 });
  const { id } = await context.params;
  const db = getDb();
  const [job] = await db.select().from(jobs)
    .where(and(eq(jobs.id, id), eq(jobs.userId, user.userId))).limit(1);
  if (!job || job.stage !== "failed" || job.provider !== "boreal" || job.model !== TTS_MODEL || !job.avatarUrl)
    return Response.json({ error: "Bu video kaldığı yerden devam ettirilemiyor." }, { status: 409 });
  const [resumed] = await db.update(jobs).set({ stage: "scene_tts_queued", error: null, updatedAt: new Date().toISOString() })
    .where(and(eq(jobs.id, id), eq(jobs.userId, user.userId), eq(jobs.stage, "failed")))
    .returning();
  if (!resumed) return Response.json({ error: "Video zaten devam ediyor." }, { status: 409 });
  return Response.json({ job: safeJob(resumed) });
}
