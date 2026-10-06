"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDownToLine, ArrowRight, Check, ChevronRight, CircleHelp, ImagePlus, LoaderCircle, Mic2, Play, Plus, Sparkles, UploadCloud, X } from "lucide-react";
import { creators } from "@/lib/creators";
import { maxVoiceWords, wordCount } from "@/lib/storyboard";

type Job = {
  id: string;
  creatorId: string;
  script: string;
  kind: string;
  duration: number;
  sceneIndex?: number;
  sceneCount?: number;
  stage: string;
  videoUrl: string | null;
  error: string | null;
  createdAt: string;
};

const stageText: Record<string, string> = {
  avatar_queued: "Model videosu hazırlanıyor",
  avatar_submitting: "Ürün sahnesi hazırlanıyor",
  product_queued: "Ürün sahnesi hazırlanıyor",
  product_submitting: "Sahneler birleştiriliyor",
  merge_queued: "Sahneler birleştiriliyor",
  merge_submitting: "Video tamamlanıyor",
  frame_queued: "Sahne görseli hazırlanıyor",
  frame_submitting: "Sahne videosu başlatılıyor",
  scene_queued: "Sahne videosu oluşturuluyor",
  scene_submitting: "Sonraki sahne hazırlanıyor",
  tts_queued: "Türkçe dış ses hazırlanıyor",
  tts_submitting: "Sahneler birleştiriliyor",
  audio_merge_queued: "Dış ses videoya ekleniyor",
  audio_merge_submitting: "Video tamamlanıyor",
  complete: "Video hazır",
  failed: "Üretim tamamlanamadı",
};

function formatDate(date: string) {
  return new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(date));
}

async function productCard(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = 720;
  canvas.height = 1280;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Görsel işlenemedi.");
  ctx.fillStyle = "#f6f3ee";
  ctx.fillRect(0, 0, 720, 1280);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(40, 120, 640, 1040);
  const scale = Math.min(600 / bitmap.width, 940 / bitmap.height);
  const width = bitmap.width * scale;
  const height = bitmap.height * scale;
  ctx.drawImage(bitmap, (720 - width) / 2, (1280 - height) / 2, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
  if (!blob) throw new Error("Ürün görseli hazırlanamadı.");
  return new File([blob], "product-card.jpg", { type: "image/jpeg" });
}

export default function Home() {
  const [product, setProduct] = useState<File | null>(null);
  const [productPreview, setProductPreview] = useState("");
  const [creatorId, setCreatorId] = useState("featured");
  const [creatorMode, setCreatorMode] = useState<"ready" | "custom">("ready");
  const [creatorImage, setCreatorImage] = useState<File | null>(null);
  const [creatorPreview, setCreatorPreview] = useState("");
  const [script, setScript] = useState("");
  const [kind, setKind] = useState<"talking" | "storyboard">("talking");
  const [duration, setDuration] = useState<10 | 20 | 30>(20);
  const [currentJob, setCurrentJob] = useState<Job | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [needsLogin, setNeedsLogin] = useState(false);
  const [dragging, setDragging] = useState(false);
  const productInput = useRef<HTMLInputElement>(null);
  const creatorInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/jobs")
      .then(async (response) => {
        if (response.status === 401) { setNeedsLogin(true); return null; }
        return response.ok ? response.json() as Promise<{ jobs: Job[] }> : null;
      })
      .then((data) => {
        if (!data) return;
        setJobs(data.jobs ?? []);
        setCurrentJob((data.jobs ?? [])[0] ?? null);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!product) { setProductPreview(""); return; }
    const url = URL.createObjectURL(product);
    setProductPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [product]);

  useEffect(() => {
    if (!creatorImage) { setCreatorPreview(""); return; }
    const url = URL.createObjectURL(creatorImage);
    setCreatorPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [creatorImage]);

  useEffect(() => {
    if (!currentJob || ["complete", "failed"].includes(currentJob.stage)) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/jobs/${currentJob.id}`, { cache: "no-store" });
        const data = await response.json() as { job?: Job; warning?: string };
        if (cancelled) return;
        if (data.warning) setWarning(data.warning);
        if (data.job) {
          const updated = data.job;
          setCurrentJob(updated);
          setJobs((previous) => [updated, ...previous.filter((item) => item.id !== updated.id)]);
        }
      } catch {
        if (!cancelled) setWarning("Durum alınamadı. Yeniden deneniyor.");
      }
    }, 4000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [currentJob]);

  function useImage(file: File | undefined, kind: "product" | "creator") {
    if (!file) return;
    setError("");
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 8 * 1024 * 1024) {
      setError("8 MB altında JPG, PNG veya WebP görseli seçin.");
      return;
    }
    if (kind === "product") setProduct(file);
    else setCreatorImage(file);
  }

  async function generate() {
    setError("");
    setWarning("");
    if (!product) { setError("Önce ürün fotoğrafını yükleyin."); return; }
    if (creatorMode === "custom" && !creatorImage) { setError("Kendi modeliniz için kişi fotoğrafını yükleyin."); return; }
    if (script.trim().length < 12) { setError("Video metnini yazın (en az 12 karakter)."); return; }
    if (kind === "talking" && wordCount(script) > maxVoiceWords(duration)) { setError(`${duration} saniyelik hedefe en fazla ${maxVoiceWords(duration)} kelime önerilir.`); return; }
    setSubmitting(true);
    try {
      const form = new FormData();
      form.set("productImage", kind === "storyboard" ? product : await productCard(product));
      form.set("creatorId", creatorMode === "custom" ? "custom" : creatorId);
      form.set("script", script.trim());
      form.set("kind", kind);
      form.set("duration", String(duration));
      if (creatorMode === "custom" && creatorImage) form.set("creatorImage", creatorImage);
      if (creatorMode === "ready" && creatorId === "featured") {
        const response = await fetch("/models/featured.jpg");
        if (!response.ok) throw new Error("Hazır model fotoğrafı yüklenemedi.");
        form.set("creatorImage", new File([await response.blob()], "featured.jpg", { type: "image/jpeg" }));
      }
      const response = await fetch("/api/jobs", { method: "POST", body: form });
      const data = await response.json() as { error?: string; job?: { id: string; stage: string } };
      if (response.status === 401) setNeedsLogin(true);
      if (!response.ok) throw new Error(data.error ?? "Üretim başlatılamadı.");
      if (!data.job) throw new Error("Üretim isteği doğrulanamadı.");
      const nextJob = { id: data.job.id, creatorId: creatorMode === "custom" ? "custom" : creatorId, script, kind, duration, sceneIndex: 0, sceneCount: kind === "storyboard" ? sceneCount : 0, stage: data.job.stage, videoUrl: null, error: null, createdAt: new Date().toISOString() };
      setCurrentJob(nextJob);
      setJobs((previous) => [nextJob, ...previous]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Üretim başlatılamadı.");
    } finally {
      setSubmitting(false);
    }
  }

  const selectedCreator = creators.find((creator) => creator.id === creatorId);
  const active = currentJob && !["complete", "failed"].includes(currentJob.stage);
  const isArgil = creatorMode === "ready" && selectedCreator?.kind === "argil";
  const sceneCount = Math.min(3, Math.max(2, script.match(/^\s*Sahne\s+\d+/gim)?.length ?? (duration === 10 ? 2 : 3)));
  const priceCents = (seconds: number) => kind === "storyboard"
    ? seconds * 8.4 + (script ? sceneCount : seconds === 10 ? 2 : 3) * 3.9 + seconds * 0.14
    : seconds * (isArgil ? 2.25 : 10);
  const dollars = (cents: number) => `${new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100)} $`;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-symbol">u<span>·</span></span><span>ugc studio</span></div>
        <div className="topbar-right"><span className="topbar-tag">Video stüdyosu</span><span className="topbar-dot" /> <span className="topbar-private">Özel çalışma alanı</span></div>
      </header>

      <main className="workspace">
        <div className="page-heading">
          <div>
            <h1>Ürününü videoda anlat.</h1>
            <p>Ürünü ekle, modeli seç, konuşma ya da sahne metnini yaz. Videonu burada oluştur.</p>
          </div>
          <span className="format-pill"><Play size={13} fill="currentColor" /> Dikey video · 9:16</span>
        </div>

        <div className="workspace-grid">
          <section className="editor" aria-label="Video oluşturma formu">
            <div className="form-section">
              <div className="section-title"><span className="step">1</span><div><h2>Ürün fotoğrafı</h2><p>Videoda tanıtılacak ürünü yükle.</p></div><span className="required">Gerekli</span></div>
              <input ref={productInput} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" aria-label="Ürün fotoğrafı seç" onChange={(event) => useImage(event.target.files?.[0], "product")} />
              <div className={`upload-zone ${dragging ? "dragging" : ""} ${productPreview ? "has-image" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); useImage(event.dataTransfer.files[0], "product"); }}>
                {productPreview ? <><img src={productPreview} alt="Yüklenen ürün" className="product-preview" /><div className="upload-filled"><strong>{product?.name}</strong><span>Ürün görseli hazır</span></div><button className="text-button" type="button" onClick={() => productInput.current?.click()}>Değiştir</button></> : <button type="button" className="upload-empty" onClick={() => productInput.current?.click()}><span className="upload-icon"><ImagePlus size={24} strokeWidth={1.7} /></span><strong>Ürün görselini buraya bırak</strong><span>veya bilgisayarından seç</span><small>JPG, PNG, WebP · en fazla 8 MB</small></button>}
              </div>
            </div>

            <div className="form-section">
              <div className="section-title"><span className="step">2</span><div><h2>Videodaki model</h2><p>Hazır bir yüz seç veya kendi fotoğrafını kullan.</p></div></div>
              <div className="mode-tabs" role="tablist" aria-label="Model seçme yöntemi">
                <button type="button" role="tab" aria-selected={creatorMode === "ready"} className={creatorMode === "ready" ? "selected" : ""} onClick={() => setCreatorMode("ready")}><Sparkles size={17} /> Hazır modeller</button>
                <button type="button" role="tab" aria-selected={creatorMode === "custom"} className={creatorMode === "custom" ? "selected" : ""} onClick={() => setCreatorMode("custom")}><UploadCloud size={17} /> Kendi fotoğrafım</button>
              </div>
              {creatorMode === "ready" ? <div className="creator-grid">
                {creators.map((creator) => <button type="button" key={creator.id} disabled={kind === "storyboard" && creator.kind === "argil"} className={`creator-card ${creatorId === creator.id ? "chosen" : ""}`} onClick={() => setCreatorId(creator.id)} aria-pressed={creatorId === creator.id}>
                  <span className={`creator-thumb creator-${creator.id}`}>{"image" in creator ? <img src={creator.image} alt="" /> : <span>{creator.name.slice(0, 1)}</span>}</span>
                  <span className="creator-meta"><strong>{creator.name}</strong><small>{creator.description}</small></span>
                  <span className="creator-check">{creatorId === creator.id ? <Check size={14} /> : <Plus size={13} />}</span>
                </button>)}
              </div> : <div className="own-creator">
                <input ref={creatorInput} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" aria-label="Kendi model fotoğrafını seç" onChange={(event) => useImage(event.target.files?.[0], "creator")} />
                <button type="button" className="own-upload" onClick={() => creatorInput.current?.click()}>
                  {creatorPreview ? <img src={creatorPreview} alt="Yüklenen model" /> : <span className="own-upload-icon"><ImagePlus size={26} /></span>}
                  <span><strong>{creatorImage ? creatorImage.name : "Kişi fotoğrafı yükle"}</strong><small>Yüzü net görünen bir fotoğraf seç · en fazla 8 MB</small></span><ChevronRight size={18} />
                </button>
                <p className="hint"><CircleHelp size={15} /> Bu fotoğraf videoda konuşan kişiye dönüşür. Ürün fotoğrafı ayrı kullanılır.</p>
              </div>}
              {kind === "storyboard" && <p className="hint"><CircleHelp size={15} /> Sahneli reklam için fotoğraflı model gerekir; Argil hazır avatarları konuşma modunda kullanılabilir.</p>}
            </div>

            <div className="form-section script-section">
              <div className="section-title"><span className="step">3</span><div><h2>Video biçimi ve metni</h2><p>Kısa konuşma veya sahne sahne ürün reklamı oluştur.</p></div></div>
              <div className="mode-tabs" role="tablist" aria-label="Video biçimi">
                <button type="button" role="tab" aria-selected={kind === "talking"} className={kind === "talking" ? "selected" : ""} onClick={() => setKind("talking")}><Mic2 size={17} /> Konuşan model</button>
                <button type="button" role="tab" aria-selected={kind === "storyboard"} className={kind === "storyboard" ? "selected" : ""} onClick={() => { setKind("storyboard"); if (isArgil) setCreatorId("featured"); }}><Play size={16} /> Sahneli reklam</button>
              </div>
              <label htmlFor="script" className="field-label">{kind === "storyboard" ? "Sahne tarifleri ve konuşma metni" : "Konuşma metni"}</label>
              <textarea id="script" className={kind === "storyboard" ? "storyboard-textarea" : ""} maxLength={kind === "storyboard" ? 5000 : 500} value={script} onChange={(event) => setScript(event.target.value)} placeholder={kind === "storyboard" ? "Sahne 1: Kanca (0 - 7. saniye)\nPrompt: Model kameraya bakar ve ürünü gösterir...\n\nSahne 2: Ürün kullanımı (7 - 14. saniye)\nPrompt: Ürünün yakın çekimi...\n\nSahne 3: Kapanış (14 - 20. saniye)\nPrompt: Model ürünle gülümser, sakin kapanış...\n\nKonuşma Metni\n(0-7. saniye): \"...\"\n(7-14. saniye): \"...\"\n(14-20. saniye): \"...\"" : "Örneğin: Bu ürünü son birkaç haftadır kullanıyorum. En sevdiğim yanı..."} />
              <div className="textarea-footer"><span><Mic2 size={15} /> {kind === "storyboard" ? "2–3 sahne; Konuşma Metni başlığıyla Türkçe dış sesi ekle" : "Türkçe metin yazabilirsin"}</span><span>{script.length}/{kind === "storyboard" ? 5000 : 500}</span></div>
              {kind === "storyboard" && <p className="hint">Örneğindeki “Sahne 1 / Prompt / Konuşma Metni” düzenini doğrudan yapıştırabilirsin. Son sahne sakin bir ürün kapanışıyla biter. Dış ses, sahnelerle yaklaşık eşleşir; dudak senkronu bu modda yoktur.</p>}
            </div>

            <div className="form-section duration-section">
              <div className="section-title"><span className="step">4</span><div><h2>Tek video için Fal maliyetin</h2><p>Bu tutar Fal hesabına yansır. Müşteriye satış fiyatını sen belirlersin.</p></div></div>
              <div className="duration-options" role="group" aria-label="Hedef video süresi">
                {([10, 20, 30] as const).map((seconds) => <button type="button" key={seconds} className={duration === seconds ? "selected" : ""} aria-pressed={duration === seconds} onClick={() => setDuration(seconds)}><strong>{seconds} sn</strong><span>≈ {dollars(priceCents(seconds))}</span></button>)}
              </div>
              <div className="cost-detail"><strong>{duration} sn / 1 video için Fal maliyetin: yaklaşık {dollars(priceCents(duration))}</strong><span>{kind === "storyboard" ? `Kling ${dollars(duration * 8.4)} + ${sceneCount} sahne görseli ${dollars(sceneCount * 3.9)} + tahmini dış ses ${dollars(duration * 0.14)}` : isArgil ? "Argil: giriş saniyesi başına 0,0225 $" : "HeyGen: üretilen saniye başına 0,10 $"}</span></div>
              <p className="cost-disclaimer">Her yeni video ayrı ücretlendirilir. Tutarlar en yakın cente yuvarlanmıştır; gerçek Fal faturası üretilen süreye, dış sesin uzunluğuna ve medya birleştirmeye göre değişebilir. Konuşan modelde süre hedeftir; sahneli modda klip süreleri seçime göre ayarlanır.</p>
              <details className="pricing-methods"><summary>Tüm yöntemlerin maliyetini ve kaynaklarını gör</summary><div className="pricing-scroll"><table><thead><tr><th>Yöntem</th><th>10 sn</th><th>20 sn</th><th>30 sn</th></tr></thead><tbody><tr><th><a href="https://fal.ai/models/argil/avatars/text-to-video" target="_blank" rel="noreferrer">Argil</a></th><td>≈ 0,23 $</td><td>≈ 0,45 $</td><td>≈ 0,68 $</td></tr><tr><th><a href="https://fal.ai/models/fal-ai/heygen/avatar4/image-to-video" target="_blank" rel="noreferrer">Fotoğraf modeli</a></th><td>≈ 1,00 $</td><td>≈ 2,00 $</td><td>≈ 3,00 $</td></tr><tr><th><a href="https://fal.ai/models/fal-ai/kling-video/v3/standard/image-to-video" target="_blank" rel="noreferrer">Sahneli reklam</a></th><td>≈ 0,93 $</td><td>≈ 1,83 $</td><td>≈ 2,68 $</td></tr></tbody></table></div><p>Sahneli tahmin: 10 sn için 2, 20/30 sn için 3 sahne; <a href="https://fal.ai/models/fal-ai/nano-banana/edit" target="_blank" rel="noreferrer">görsel</a> ve <a href="https://fal.ai/models/fal-ai/elevenlabs/tts/multilingual-v2" target="_blank" rel="noreferrer">dış ses</a> dahil. Birleştirme ücretleri hariçtir.</p></details>
            </div>

            {needsLogin && <div className="inline-error">Video üretmek için <a href="/signin-with-chatgpt?return_to=/" target="_top">oturum aç</a>.</div>}
            {error && <div className="inline-error" role="alert">{error}<button type="button" aria-label="Hatayı kapat" onClick={() => setError("")}><X size={15} /></button></div>}
            <div className="submit-row"><button className="generate-button" type="button" disabled={submitting || !!active} onClick={generate}>{submitting ? <><LoaderCircle size={19} className="spin" /> Başlatılıyor...</> : active ? <><LoaderCircle size={19} className="spin" /> Video hazırlanıyor</> : <><Sparkles size={19} /> UGC videosu oluştur <ArrowRight size={18} /></>}</button><span>Oluşturma birkaç dakika sürebilir.</span></div>
          </section>

          <aside className="result-column" aria-label="Video sonucu">
            <div className="result-header"><div><h2>Videon</h2><p>{currentJob ? `${currentJob.duration} sn hedef · ${currentJob.kind === "storyboard" ? "Sahneli reklam" : "Konuşan model"}` : "Sonuç burada görünecek."}</p></div><span>9:16</span></div>
            <div className={`video-frame ${currentJob?.stage === "complete" ? "video-ready" : ""}`}>
              {currentJob?.stage === "complete" && currentJob.videoUrl ? <video key={currentJob.id} src={currentJob.videoUrl} controls playsInline poster={productPreview || undefined} /> : active ? <div className="frame-progress"><span className="progress-mark"><LoaderCircle size={28} className="spin" /></span><strong>{stageText[currentJob.stage] ?? "Video hazırlanıyor"}</strong>{currentJob.kind === "storyboard" && ["frame_queued", "scene_queued"].includes(currentJob.stage) && <span className="scene-progress">Sahne {(currentJob.sceneIndex ?? 0) + 1}/{currentJob.sceneCount ?? 3}</span>}<p>İşlem arka planda sürüyor. Bu sayfaya daha sonra dönebilirsin.</p><div className="progress-track"><span /></div></div> : currentJob?.stage === "failed" ? <div className="frame-progress failed"><X size={27} /><strong>Video oluşturulamadı</strong><p>{currentJob.error ?? "Yeniden deneyin."}</p></div> : <div className="frame-empty"><div className="frame-art"><div className="frame-person">{creatorMode === "ready" && selectedCreator && "image" in selectedCreator ? <img src={selectedCreator.image} alt="Seçilen model" /> : creatorMode === "custom" && creatorPreview ? <img src={creatorPreview} alt="Seçilen model" /> : <span>{selectedCreator?.name.slice(0, 1) ?? "M"}</span>}</div><div className="frame-product">{productPreview ? <img src={productPreview} alt="Seçilen ürün" /> : <ImagePlus size={22} />}</div></div><div className="frame-caption"><span className="frame-caption-line" /><span className="frame-caption-line short" /></div><span className="preview-label">ÖNİZLEME</span></div>}
            </div>
            {currentJob?.stage === "complete" && <a className="download-button" href={`/api/jobs/${currentJob.id}/video`}><ArrowDownToLine size={17} /> MP4 videoyu indir</a>}
            {warning && active && <p className="warning" role="status">{warning}</p>}
            <div className="result-note"><span className="note-icon"><Check size={16} /></span><p>{(currentJob?.kind ?? kind) === "storyboard" ? "Ürün, sahne görsellerinde referans alınır. Son sahne sakin kapanış için yönlendirilir; üretici modelin sonucu değişebilir." : "Ürün görseli videonun sonundaki ürün sahnesinde yer alır."}</p></div>
            {jobs.length > 0 && <div className="history"><h3>Son videolar</h3>{jobs.slice(0, 5).map((job) => <button type="button" className={`history-row ${currentJob?.id === job.id ? "active" : ""}`} key={job.id} onClick={() => setCurrentJob(job)}><span className="history-icon">{job.stage === "complete" ? <Play size={15} fill="currentColor" /> : job.stage === "failed" ? <X size={15} /> : <LoaderCircle size={15} className="spin" />}</span><span><strong>{job.stage === "complete" ? "UGC videosu" : stageText[job.stage] ?? "Video hazırlanıyor"}</strong><small>{formatDate(job.createdAt)}</small></span><ChevronRight size={16} /></button>)}</div>}
          </aside>
        </div>
      </main>
    </div>
  );
}
