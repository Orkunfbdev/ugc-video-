export type Scene = { prompt: string; duration: number };
export type Storyboard = { scenes: Scene[]; voiceover: string };

export function wordCount(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function parseStoryboard(input: string, duration: number): Storyboard {
  const voiceStart = input.search(/(?:konuşma\s*metni|voiceover|dış\s*ses)/i);
  if (voiceStart < 0) throw new Error("Sahneli metne 'Konuşma Metni' başlığı ve dış ses metni ekleyin.");
  const visualPart = input.slice(0, voiceStart);
  const voicePart = input.slice(voiceStart).replace(/^[^\n]*\n?/, "");
  const headings = [...visualPart.matchAll(/^\s*Sahne\s+\d+[^\n]*$/gim)];
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

  const scenes = headings.map((heading, index) => {
    const start = (heading.index ?? 0) + heading[0].length;
    const end = headings[index + 1]?.index ?? visualPart.length;
    const prompt = visualPart.slice(start, end).replace(/^\s*Prompt\s*:\s*/i, "").trim();
    if (prompt.length < 20) throw new Error(`Sahne ${index + 1} için daha ayrıntılı görsel tarif yazın.`);
    return { prompt, duration: durations[index] };
  });

  if ((voicePart.match(/"/g)?.length ?? 0) % 2 !== 0 ||
      (voicePart.match(/“/g)?.length ?? 0) !== (voicePart.match(/”/g)?.length ?? 0))
    throw new Error("Konuşma metnindeki açık tırnağı kapatın ve cümleyi tamamlayın.");
  const quoted = [...voicePart.matchAll(/[“"]([^”"]+)[”"]/g)].map((match) => match[1].trim());
  const voiceover = (quoted.length ? quoted.join(" ") : voicePart.replace(/^\s*\([^\n]*\)\s*:?/gm, "").trim()).replace(/\s+/g, " ").trim();
  if (voiceover.length < 12) throw new Error("Dış ses için en az bir cümle yazın.");
  if (wordCount(voiceover) > Math.floor(duration * 2.5)) throw new Error(`${duration} saniyeye en fazla ${Math.floor(duration * 2.5)} kelimelik dış ses sığar. Metni kısaltın veya süreyi artırın.`);
  return { scenes, voiceover };
}
