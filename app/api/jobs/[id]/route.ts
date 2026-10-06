import { and, eq } from "drizzle-orm";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import { jobs } from "@/db/schema";
import { publicError } from "@/lib/fal";
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
    return Response.json({ job: safeJob(job), warning: publicError(error) });
  }
  const [updated] = await db.select().from(jobs).where(eq(jobs.id, id)).limit(1);
  return Response.json({ job: safeJob(updated) });
}
