import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import { jobs } from "@/db/schema";

export const runtime = "edge";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getChatGPTUser();
  if (!user) return new Response("Oturum açmanız gerekiyor.", { status: 401 });
  const { id } = await context.params;
  const [job] = await getDb().select().from(jobs)
    .where(and(eq(jobs.id, id), eq(jobs.userId, user.userId))).limit(1);
  if (!job || job.stage !== "complete") return new Response("Video bulunamadı.", { status: 404 });
  const object = await env.BUCKET?.get(`jobs/${id}/video.mp4`);
  if (object) {
    return new Response(object.body, {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Disposition": `attachment; filename="ugc-${id}.mp4"`,
        "Content-Length": String(object.size),
      },
    });
  }
  return job.videoUrl ? Response.redirect(job.videoUrl) : new Response("Video bulunamadı.", { status: 404 });
}
