import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const jobs = sqliteTable("jobs", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  creatorId: text("creator_id").notNull(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  script: text("script").notNull(),
  productImageUrl: text("product_image_url").notNull(),
  requestId: text("request_id").notNull(),
  stage: text("stage").notNull(),
  avatarUrl: text("avatar_url"),
  productVideoUrl: text("product_video_url"),
  videoUrl: text("video_url"),
  error: text("error"),
  moderationFlagged: integer("moderation_flagged", { mode: "boolean" }),
  moderationTranscription: text("moderation_transcription"),
  moderationError: text("moderation_error"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
