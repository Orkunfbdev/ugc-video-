import { fal } from "@fal-ai/client";
import { env } from "cloudflare:workers";

export function falClient() {
  if (!env.FAL_KEY) throw new Error("Fal API anahtarı henüz eklenmedi.");
  fal.config({ credentials: env.FAL_KEY });
  return fal;
}

export function validImage(value: FormDataEntryValue | null): value is File {
  return value instanceof File &&
    ["image/jpeg", "image/png", "image/webp"].includes(value.type) &&
    value.size > 0 && value.size <= 8 * 1024 * 1024;
}

export function publicError(error: unknown) {
  const message = error instanceof Error ? error.message : "Bilinmeyen hata";
  if (message.includes("Fal API anahtarı")) return message;
  if (/unauthorized|401|invalid.*key/i.test(message)) return "Fal API anahtarı geçersiz veya erişim yetkisi yok.";
  if (/moderation|flagged/i.test(message)) return "İçerik sağlayıcı tarafından reddedildi. Metni veya görseli değiştirin.";
  return "Video oluşturulurken hata oluştu. Lütfen yeniden deneyin.";
}
