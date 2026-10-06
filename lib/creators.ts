export const creators = [
  { id: "featured", name: "Stüdyo modeli", kind: "photo", image: "/models/featured.jpg", description: "Fotoğraftan konuşan model" },
  { id: "mia", name: "Mia", kind: "argil", avatar: "Mia outdoor (UGC)", description: "Dış mekân · doğal" },
  { id: "ines", name: "Ines", kind: "argil", avatar: "Ines (UGC)", description: "Günlük · samimi" },
  { id: "emma", name: "Emma", kind: "argil", avatar: "Emma (UGC)", description: "Yaşam tarzı" },
  { id: "brandon", name: "Brandon", kind: "argil", avatar: "Brandon (UGC)", description: "Günlük · enerjik" },
] as const;

export const ARGIL_MODEL = "argil/avatars/text-to-video";
export const HEYGEN_MODEL = "fal-ai/heygen/avatar4/image-to-video";
export const PRODUCT_MODEL = "fal-ai/ffmpeg-api/images-to-video";
export const MERGE_MODEL = "fal-ai/ffmpeg-api/merge-videos";
