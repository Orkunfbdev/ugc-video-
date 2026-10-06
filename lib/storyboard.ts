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
  return Math.floor(duration * 2.3);
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
