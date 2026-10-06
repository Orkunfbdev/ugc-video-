export type Scene = { prompt: string; duration: number; speech?: string };
export type Storyboard = { scenes: Scene[]; voiceover: string };

const sceneHeading = /^[^\S\n]*(?:#{1,6}[^\S\n]*)?(?:(?:Sahne|Scene)\s+\d+|\d+[.)][^\S\n]*(?:Sahne|Scene))\b[^\n]*$/gim;
const voiceHeading = /^[^\S\n]*(?:🎙️\s*)?(?:Konuşma\s*Metni|Voiceover|Dış\s*Ses)\b[^\n]*$/im;

export function promptKind(input: string): "talking" | "storyboard" {
  const voiceStart = input.search(voiceHeading);
  const visualPart = voiceStart < 0 ? input : input.slice(0, voiceStart);
  return [...visualPart.matchAll(sceneHeading)].length >= 2 ? "storyboard" : "talking";
}

export function countSceneHeadings(input: string) {
  const voiceStart = input.search(voiceHeading);
  return [...(voiceStart < 0 ? input : input.slice(0, voiceStart)).matchAll(sceneHeading)].length;
}

export function wordCount(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function maxVoiceWords(duration: number) {
  return Math.floor(duration * 2);
}

export function parseTalking(input: string, duration: number): Scene {
  const voiceStart = input.search(voiceHeading);
  if (voiceStart < 0 && /^\s*Prompt\s*:/i.test(input)) throw new Error("Promptun altına 'Konuşma Metni' başlığıyla modelin söyleyeceği sözleri ekleyin.");
  const visual = voiceStart < 0 ? "" : input.slice(0, voiceStart).replace(/^\s*Prompt\s*:/i, "").trim();
  const voiceBlock = voiceStart < 0 ? "" : input.slice(voiceStart);
  const firstLine = voiceBlock.split("\n", 1)[0];
  const speechPart = voiceStart < 0 ? input.trim() : (firstLine.includes(":") ? firstLine.slice(firstLine.indexOf(":") + 1).trim() : "") || voiceBlock.slice(firstLine.length).trim();
  const speech = speechPart.replace(/^[“"]|[”"]$/g, "").trim();
  if (speech.length < 12) throw new Error("Modelin söyleyeceği en az bir cümle yazın.");
  if (wordCount(speech) > maxVoiceWords(duration))
    throw new Error(`${duration} saniyelik hedefe en fazla ${maxVoiceWords(duration)} kelime önerilir. Metni kısaltın veya süreyi artırın.`);
  return { prompt: visual || "A natural handheld 9:16 smartphone UGC video. The person faces the camera, speaks warmly and holds the actual product visibly in hand. Soft daylight, subtle natural gestures, realistic skin and a calm ending with the product clearly visible.", duration, speech };
}

export function openingFramePrompt(scene: Scene) {
  const closeup = /close[ -]?up|macro|b-?roll|yakın çekim/i.test(scene.prompt);
  const pouring = /pour|drizzl|dök/i.test(scene.prompt);
  const tasting = /tast|tatt|tadım|tadına/i.test(scene.prompt);
  return `Create a photorealistic vertical 9:16 smartphone UGC opening frame. Image 1 is the person; preserve their identity and face when visible. Image 2 is the actual product and is the source of truth for its shape, packaging, colors, logo and any printed label. Copy visible branding faithfully; never redesign or respell it. ${closeup ? "For this product close-up, focus on the real product in use; the person's face need not appear." : "Show the person naturally presenting the exact product, with both face and product clearly visible."} ${pouring ? "Start just before the brief pour, with the intended target visible and the surrounding surface clean and dry." : tasting ? "Place a small prepared sample appropriate to the featured food or drink near the person." : ""} Natural daylight, realistic hands, a steady opening composition, no invented text or extra products. Scene: ${scene.prompt}`;
}

export function borealInput(scene: Scene, imageUrl: string, audioUrl: string) {
  const closeup = /close[ -]?up|macro|b-?roll|yakın çekim/i.test(scene.prompt);
  const pouring = /pour|drizzl|dök/i.test(scene.prompt);
  const tasting = /tast|tatt|tadım|tadına/i.test(scene.prompt);
  const action = pouring
    ? "Show one small, controlled pour onto or into the intended target for about one second. Stop pouring, return the product upright, then linger on the result and the intact product. Keep the surrounding surface clean; no puddles or overspill."
    : tasting
      ? "At the start, take one small bite or sip of a prepared sample appropriate to the featured food or drink, then show a genuine pleased reaction. Finish eating, smile toward the camera and present the actual product with its label facing forward when it has one. Hold a steady product view through the final second."
      : "Use relaxed, small hand gestures and keep the actual product in view. Complete each gesture before the cut.";
  return {
    image_url: imageUrl, audio_url: audioUrl,
    prompt: `[VISUAL] Photorealistic handheld 9:16 smartphone UGC video. The reference image is the source of truth for the person's identity and the actual product's shape, colors, packaging, logo and any printed label. Preserve original branding; never replace letters, invent a logo or add another product. ${action} Natural daylight and subtle camera movement. Complete the action and hold a steady composition for the last half-second so the next shot can cut cleanly. Scene brief: ${scene.prompt}\n[SPEECH] ${closeup || tasting ? "Use the supplied Turkish audio as voiceover. No person needs to speak on screen or move their mouth while eating." : "The on-camera person speaks the supplied Turkish audio with natural synchronized mouth movement. Do not translate or invent words."}\n[SOUNDS] Keep the supplied speech clear, with quiet natural room tone during pauses and after the final word. No music.\n[TEXT] No captions, overlays or new text. Keep only text physically present on the reference product.`,
    resolution: "720p", aspect_ratio: "9:16", duration: scene.duration,
  };
}

export function parseStoryboard(input: string, duration: number): Storyboard {
  const voiceStart = input.search(voiceHeading);
  if (voiceStart < 0) throw new Error("Sahneli metne 'Konuşma Metni' başlığı ve dış ses metni ekleyin.");
  const visualPart = input.slice(0, voiceStart);
  const voicePart = input.slice(voiceStart).replace(/^[^\n]*\n?/, "").trim();
  const headings = [...visualPart.matchAll(sceneHeading)];
  if (headings.length < 2 || headings.length > 3) throw new Error("Sahneli video için 2 veya 3 sahne yazın.");

  const spans = headings.map((heading) => {
    const match = heading[0].match(/\(\s*(\d+)\s*[-–]\s*(\d+)\s*\.?\s*(?:saniye|sn)?/i);
    return match ? Number(match[2]) - Number(match[1]) : 0;
  });
  const totalSpan = spans.reduce((sum, seconds) => sum + seconds, 0);
  const rawDurations = totalSpan > 0 && spans.every((span) => span > 0)
    ? spans.map((span) => span / totalSpan * duration)
    : spans.map(() => duration / headings.length);
  const durations = rawDurations.map((value) => Math.floor(value));
  let remaining = duration - durations.reduce((sum, value) => sum + value, 0);
  while (remaining > 0) {
    const index = rawDurations.reduce((best, value, i) => value - durations[i] > rawDurations[best] - durations[best] ? i : best, 0);
    durations[index]++;
    remaining--;
  }
  if (durations.some((seconds) => seconds < 3 || seconds > 15)) throw new Error("Her sahne 3–15 saniye olmalı. Sahne sürelerini düzenleyin.");

  const scenes: Scene[] = headings.map((heading, index) => {
    const start = (heading.index ?? 0) + heading[0].length;
    const end = headings[index + 1]?.index ?? visualPart.length;
    const section = visualPart.slice(start, end).trim();
    const prompt = (section.match(/(?:^|\n)[^\S\n]*Prompt\s*:\s*([\s\S]*)/i)?.[1] ?? section).trim();
    if (prompt.length < 20) throw new Error(`Sahne ${index + 1} için daha ayrıntılı görsel tarif yazın.`);
    return { prompt, duration: durations[index] };
  });

  if ((voicePart.match(/"/g)?.length ?? 0) % 2 !== 0 ||
      (voicePart.match(/“/g)?.length ?? 0) !== (voicePart.match(/”/g)?.length ?? 0))
    throw new Error("Konuşma metnindeki açık tırnağı kapatın ve cümleyi tamamlayın.");
  const quoted = [...voicePart.matchAll(/[“"]([^”"]+)[”"]/g)].map((match) => match[1].trim());
  const paragraphs = voicePart.split(/\n\s*\n/).map((part) => part.replace(/^[^\n]*?(?:Sahne\s+\d+|\d+\s*[-–]\s*\d+)[^\n]*:\s*/i, "").trim()).filter(Boolean);
  const speeches = quoted.length === scenes.length ? quoted : !quoted.length && paragraphs.length === scenes.length ? paragraphs : [];
  if (!speeches.length) throw new Error("Her sahne için sırayla bir konuşma paragrafı veya tırnak içinde bir cümle yazın.");
  const voiceover = speeches.join(" ").replace(/\s+/g, " ").trim();
  if (voiceover.length < 12) throw new Error("Dış ses için en az bir cümle yazın.");
  if (wordCount(voiceover) > maxVoiceWords(duration)) throw new Error(`${duration} saniyeye en fazla ${maxVoiceWords(duration)} kelimelik dış ses sığar. Metni kısaltın veya süreyi artırın.`);
  for (const [index, speech] of speeches.entries()) {
    if (wordCount(speech) > maxVoiceWords(scenes[index].duration))
      throw new Error(`Sahne ${index + 1} konuşması ${scenes[index].duration} saniyeye sığmıyor. Metni kısaltın veya daha uzun süre seçin.`);
    scenes[index].speech = speech;
  }
  return { scenes, voiceover };
}
