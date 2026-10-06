import { and, eq } from "drizzle-orm";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import { jobs } from "@/db/schema";
import { BOREAL_MODEL } from "@/lib/creators";
import { advanceJob, safeJob } from "@/lib/job-pipeline";

export const runtime = "edge";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Oturum açmanız gerekiyor." }, { status: 401 });
  const { id } = await context.params;
  const db = getDb();
  const [job] = await db.select().from(jobs)
    .where(and(eq(jobs.id, id), eq(jobs.userId, user.userId))).limit(1);
  if (!job) return Response.json({ error: "Video bulunamadı." }, { status: 404 });
  try {
    await advanceJob(job);
  } catch (error) {
    console.error("Status update failed", error);
    const status = typeof error === "object" && error !== null && "status" in error && typeof error.status === "number"
      ? `HTTP ${error.status}` : "bağlantı";
    if (status === "HTTP 422" && job.model === BOREAL_MODEL && job.duration > 20) {
      const [failed] = await db.update(jobs).set({ stage: "failed", error: "Boreal 20 saniyeyi aşan video isteğini reddetti. Hazır görsel ve sesle 20 saniye olarak devam edebilirsin.", updatedAt: new Date().toISOString() })
        .where(and(eq(jobs.id, id), eq(jobs.stage, job.stage))).returning();
      return Response.json({ job: safeJob(failed ?? job) });
    }
    if (status === "HTTP 500" && job.model === BOREAL_MODEL && job.stage === "scene_queued") {
      const [failed] = await db.update(jobs).set({ stage: "failed", error: `Fal video modeli iç hatayla sonlandı (HTTP 500). Video oluşmadı. İş numarası: ${job.requestId}. Yeni bir üretim başlatmayın.`, updatedAt: new Date().toISOString() })
        .where(and(eq(jobs.id, id), eq(jobs.stage, job.stage))).returning();
      return Response.json({ job: safeJob(failed ?? job) });
    }
    return Response.json({ job: safeJob(job), warning: `Fal video sonucu şu anda okunamadı (${status}). Mevcut iş numarası: ${job.requestId}. Yeni üretim başlatmayın; bu iş sorgulanmaya devam ediyor.` });
  }
  const [updated] = await db.select().from(jobs).where(eq(jobs.id, id)).limit(1);
  return Response.json({ job: safeJob(updated) });
}
