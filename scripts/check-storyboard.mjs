import assert from "node:assert/strict";
import { borealInput, openingFramePrompt, parseTalking, parseStoryboard, promptKind } from "../lib/storyboard.ts";

const example = `Sahne 1: Kanca (0 - 7. Saniye)
Prompt: A woman in a kitchen holds the real product toward the camera.
Sahne 2: Ürün kullanımı (7 - 14. Saniye)
Prompt: Extreme close-up of the same product in use on the counter.
Sahne 3: Kapanış (14 - 20. Saniye)
Prompt: The woman smiles and holds the product steady for the closing shot.
Konuşma Metni
(0-7): "Ürünümü göstermek istiyorum."
(7-14): "Günlük kullanımda çok pratik."
(14-20): "Siz de deneyin."`;

const plan = parseStoryboard(example, 20);
assert.equal(promptKind(example), "storyboard");
assert.equal(promptKind("Bu ürünü her gün kullanıyorum, size de öneririm."), "talking");
const decorated = `🎬 AI Video Üretim Promptları\n${example.replace("Konuşma Metni", "🎙️ Konuşma Metni (Voiceover / Dış Ses)")}`;
assert.equal(promptKind(decorated), "storyboard");
assert.equal(parseStoryboard(decorated, 20).scenes[0].speech, "Ürünümü göstermek istiyorum.");
assert.deepEqual(plan.scenes.map((scene) => scene.duration), [7, 7, 6]);
assert.deepEqual(plan.scenes.map((scene) => scene.speech), ["Ürünümü göstermek istiyorum.", "Günlük kullanımda çok pratik.", "Siz de deneyin."]);
assert.equal(plan.voiceover, "Ürünümü göstermek istiyorum. Günlük kullanımda çok pratik. Siz de deneyin.");
assert.deepEqual(parseStoryboard(example, 10).scenes.map((scene) => scene.duration), [4, 3, 3]);
assert.throws(() => parseStoryboard(example.replace("Konuşma Metni", ""), 20), /Konuşma Metni/);
const talking = parseTalking('Prompt: A woman holds the olive oil bottle.\nKonuşma Metni\n"Bu zeytinyağını kahvaltıda kullanıyorum."', 10);
assert.match(talking.prompt, /olive oil bottle/);
assert.equal(talking.speech, "Bu zeytinyağını kahvaltıda kullanıyorum.");
assert.match(openingFramePrompt(talking), /presenting the exact product/);
assert.match(openingFramePrompt({ prompt: "Extreme close-up of the bottle", duration: 10 }), /product close-up/);
assert.deepEqual(Object.keys(borealInput(talking, "image", "audio")), ["image_url", "audio_url", "prompt", "resolution", "aspect_ratio", "duration"]);
assert.match(borealInput(talking, "image", "audio").prompt, /on-camera person speaks/);
assert.match(borealInput({ prompt: "Macro product shot", duration: 7 }, "image", "audio").prompt, /voiceover/);
assert.match(borealInput({ prompt: "Olive oil pouring onto bread", duration: 7 }, "image", "audio").prompt, /Stop pouring/);
assert.match(borealInput({ prompt: "Reaction after tasting", duration: 6 }, "image", "audio").prompt, /one small bite or sip/);
assert.match(openingFramePrompt({ prompt: "Olive oil pouring onto bread", duration: 7 }), /surrounding surface clean and dry/);
assert.doesNotMatch(borealInput({ prompt: "Pour juice into a glass", duration: 7 }, "image", "audio").prompt, /bread|bottle|oil/);
assert.doesNotMatch(borealInput({ prompt: "Customer reacts to a face cream", duration: 7 }, "image", "audio").prompt, /bite|sip/);
assert.equal(parseTalking('Prompt: A woman holds the bottle.\nKonuşma Metni: "Bu ürünü seviyorum."', 10).speech, "Bu ürünü seviyorum.");
console.log("Storyboard checks passed");
