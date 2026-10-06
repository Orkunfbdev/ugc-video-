"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDownToLine, ArrowRight, Check, ChevronRight, CircleHelp, ImagePlus, LoaderCircle, Mic2, Play, Plus, Sparkles, UploadCloud, X } from "lucide-react";
import { creators } from "@/lib/creators";
import { countSceneHeadings, parseTalking, parseStoryboard, promptKind } from "@/lib/storyboard";

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
  canResume?: boolean;
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
  frame_submitting: "Türkçe konuşma hazırlanıyor",
  scene_queued: "Sahne videosu oluşturuluyor",
  scene_submitting: "Video tamamlanıyor",
  scene_tts_queued: "Kesintisiz konuşma hazırlanıyor",
  scene_tts_submitting: "Konuşmalı video başlatılıyor",
  scene_audio_merge_queued: "Konuşma sahneye ekleniyor",
  scene_audio_merge_submitting: "Sonraki sahne hazırlanıyor",
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

export default function Home() {
  const [product, setProduct] = useState<File | null>(null);
  const [productPreview, setProductPreview] = useState("");
  const [creatorId, setCreatorId] = useState("featured");
  const [creatorMode, setCreatorMode] = useState<"ready" | "custom">("ready");
  const [creatorImage, setCreatorImage] = useState<File | null>(null);
  const [creatorPreview, setCreatorPreview] = useState("");
  const [script, setScript] = useState("");
  const kind = promptKind(script);
  const [duration, setDuration] = useState<10 | 20 | 30>(20);
  const [currentJob, setCurrentJob] = useState<Job | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [resuming, setResuming] = useState(false);
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
    try { if (kind === "storyboard") parseStoryboard(script, duration); else parseTalking(script, duration); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Promptu kontrol edin."); return; }
    setSubmitting(true);
    try {
      const form = new FormData();
      form.set("productImage", product);
      form.set("creatorId", creatorMode === "custom" ? "custom" : effectiveCreatorId);
      form.set("script", script.trim());
      form.set("duration", String(duration));
      if (creatorMode === "custom" && creatorImage) form.set("creatorImage", creatorImage);
      if (creatorMode === "ready" && effectiveCreatorId === "featured") {
        const response = await fetch("/models/featured.jpg");
        if (!response.ok) throw new Error("Hazır model fotoğrafı yüklenemedi.");
        form.set("creatorImage", new File([await response.blob()], "featured.jpg", { type: "image/jpeg" }));
      }
      const response = await fetch("/api/jobs", { method: "POST", body: form });
      const data = await response.json() as { error?: string; job?: { id: string; stage: string } };
      if (response.status === 401) setNeedsLogin(true);
      if (!response.ok) throw new Error(data.error ?? "Üretim başlatılamadı.");
      if (!data.job) throw new Error("Üretim isteği doğrulanamadı.");
      const nextJob = { id: data.job.id, creatorId: creatorMode === "custom" ? "custom" : effectiveCreatorId, script, kind, duration, sceneIndex: 0, sceneCount: 1, stage: data.job.stage, videoUrl: null, error: null, createdAt: new Date().toISOString() };
      setCurrentJob(nextJob);
      setJobs((previous) => [nextJob, ...previous]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Üretim başlatılamadı.");
    } finally {
      setSubmitting(false);
    }
  }

  async function resumeJob() {
    if (!currentJob?.canResume || resuming) return;
    setResuming(true);
    setError("");
    try {
      const response = await fetch(`/api/jobs/${currentJob.id}/resume`, { method: "POST" });
      const data = await response.json() as { error?: string; job?: Job };
      if (!response.ok || !data.job) throw new Error(data.error ?? "Video devam ettirilemedi.");
      setCurrentJob(data.job);
      setJobs((previous) => [data.job!, ...previous.filter((item) => item.id !== data.job!.id)]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Video devam ettirilemedi.");
    } finally {
      setResuming(false);
    }
  }

  const effectiveCreatorId = creatorId;
  const selectedCreator = creators.find((creator) => creator.id === effectiveCreatorId);
  const active = currentJob && !["complete", "failed"].includes(currentJob.stage);
  const sceneCount = kind === "storyboard" ? Math.min(3, Math.max(2, countSceneHeadings(script))) : 1;
  const speechCharacters = (() => {
    if (!script.trim()) return 300;
    try { return kind === "storyboard" ? parseStoryboard(script, duration).voiceover.length : parseTalking(script, duration).speech?.length ?? 300; }
    catch { return 300; }
  })();
  const voiceCents = speechCharacters * 0.01;
  const priceCents = (seconds: number) => seconds + 3.9 + voiceCents;
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
                {creators.map((creator) => <button type="button" key={creator.id} className={`creator-card ${effectiveCreatorId === creator.id ? "chosen" : ""}`} onClick={() => setCreatorId(creator.id)} aria-pressed={effectiveCreatorId === creator.id}>
                  <span className={`creator-thumb creator-${creator.id}`}><img src={creator.image} alt="" /></span>
                  <span className="creator-meta"><strong>{creator.name}</strong><small>{creator.description}</small></span>
                  <span className="creator-check">{effectiveCreatorId === creator.id ? <Check size={14} /> : <Plus size={13} />}</span>
                </button>)}
              </div> : <div className="own-creator">
                <input ref={creatorInput} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" aria-label="Kendi model fotoğrafını seç" onChange={(event) => useImage(event.target.files?.[0], "creator")} />
                <button type="button" className="own-upload" onClick={() => creatorInput.current?.click()}>
                  {creatorPreview ? <img src={creatorPreview} alt="Yüklenen model" /> : <span className="own-upload-icon"><ImagePlus size={26} /></span>}
                  <span><strong>{creatorImage ? creatorImage.name : "Kişi fotoğrafı yükle"}</strong><small>Yüzü net görünen bir fotoğraf seç · en fazla 8 MB</small></span><ChevronRight size={18} />
                </button>
                <p className="hint"><CircleHelp size={15} /> Kişi ve ürün fotoğrafından birlikte göründükleri bir başlangıç karesi hazırlanır.</p>
              </div>}
              <p className="hint"><CircleHelp size={15} /> Fotoğraflar Boreal için tek sahne görselinde birleştirilir. Ürünün ve yüzün birebir korunması üretim sonucuna bağlıdır.</p>
            </div>

            <div className="form-section script-section">
              <div className="section-title"><span className="step">3</span><div><h2>Video promptu</h2><p>Konuşma metnini veya sahneleri ve konuşmaları tek kutuya yapıştır.</p></div></div>
              <label htmlFor="script" className="field-label">Prompt ve konuşma metni</label>
              <textarea id="script" className="storyboard-textarea" maxLength={5000} value={script} onChange={(event) => setScript(event.target.value)} placeholder={'Kısa video için modelin söyleyeceği Türkçe metni yaz.\n\nGörsel tarif de eklemek istersen:\nPrompt: Kadın doğal ışıklı mutfakta ürünü elinde tutarak kameraya konuşur.\nKonuşma Metni\n"Bu ürünü her sabah kullanıyorum..."\n\nSahneli video için Sahne 1, Sahne 2 ve Konuşma Metni bölümlerini aynı kutuya yapıştır.'} />
              <div className="textarea-footer"><span><Mic2 size={15} /> {kind === "storyboard" ? `${sceneCount} görsel bölüm algılandı · tek çekim ve kesintisiz konuşma` : "Düz metin konuşma olarak kullanılır; Sahne 1, Sahne 2 yazarsan görsel bölümler algılanır"}</span><span>{script.length}/5000</span></div>
              {kind === "storyboard" && <p className="hint">Sahneler tek kesintisiz çekimde görsel yönlendirme olarak kullanılır. Konuşma Metni tek ses kaydı olarak okunur; ürün yakın çekiminde dış ses olarak sürer.</p>}
            </div>

            <div className="form-section duration-section">
              <div className="section-title"><span className="step">4</span><div><h2>Tahmini üretim maliyeti</h2><p>Boreal 720p · Fal hesabına yansır. Müşteriye satış fiyatını sen belirlersin.</p></div></div>
              <div className="duration-options" role="group" aria-label="Hedef video süresi">
                {([10, 20, 30] as const).map((seconds) => <button type="button" key={seconds} className={duration === seconds ? "selected" : ""} aria-pressed={duration === seconds} onClick={() => setDuration(seconds)}><strong>{seconds} sn</strong><span>≈ {dollars(priceCents(seconds))}</span></button>)}
              </div>
              <div className="cost-detail"><strong>{duration} sn / 1 video için yaklaşık {dollars(priceCents(duration))}</strong><span>Boreal {dollars(duration)} + 1 başlangıç görseli {dollars(3.9)} + tahmini Türkçe ses {dollars(voiceCents)}</span></div>
              <p className="cost-disclaimer">Bu ilk üretim tahminidir. Konuşma seçilen süreden uzun çıkarsa söz kesilmesin diye video uzar; her ek saniye yaklaşık 1 cent ekler. Yeniden denemeler ayrıca ücretlenir. <a href="https://fal.ai/models/creatify/boreal" target="_blank" rel="noreferrer">Boreal</a> · <a href="https://fal.ai/models/fal-ai/nano-banana/edit" target="_blank" rel="noreferrer">görsel</a> · <a href="https://fal.ai/models/fal-ai/elevenlabs/tts/eleven-v3" target="_blank" rel="noreferrer">ses</a></p>
            </div>

            {needsLogin && <div className="inline-error">Video üretmek için <a href="/signin-with-chatgpt?return_to=/" target="_top">oturum aç</a>.</div>}
            {error && <div className="inline-error" role="alert">{error}<button type="button" aria-label="Hatayı kapat" onClick={() => setError("")}><X size={15} /></button></div>}
            <div className="submit-row"><button className="generate-button" type="button" disabled={submitting || !!active} onClick={generate}>{submitting ? <><LoaderCircle size={19} className="spin" /> Başlatılıyor...</> : active ? <><LoaderCircle size={19} className="spin" /> Video hazırlanıyor</> : <><Sparkles size={19} /> UGC videosu oluştur <ArrowRight size={18} /></>}</button><span>Oluşturma birkaç dakika sürebilir.</span></div>
          </section>

          <aside className="result-column" aria-label="Video sonucu">
            <div className="result-header"><div><h2>Videon</h2><p>{currentJob ? `${currentJob.duration} sn hedef · ${currentJob.kind === "storyboard" ? "Sahneli reklam" : "Konuşan model"}` : "Sonuç burada görünecek."}</p></div><span>9:16</span></div>
            <div className={`video-frame ${currentJob?.stage === "complete" ? "video-ready" : ""}`}>
              {currentJob?.stage === "complete" && currentJob.videoUrl ? <video key={currentJob.id} src={currentJob.videoUrl} controls playsInline poster={productPreview || undefined} /> : active ? <div className="frame-progress"><span className="progress-mark"><LoaderCircle size={28} className="spin" /></span><strong>{stageText[currentJob.stage] ?? "Video hazırlanıyor"}</strong><p>Bu sayfa açıkken adımlar sırayla tamamlanır. Daha sonra döndüğünde işlem kaldığı yerden devam eder.</p><div className="progress-track"><span /></div></div> : currentJob?.stage === "failed" ? <div className="frame-progress failed"><X size={27} /><strong>Video oluşturulamadı</strong><p>{currentJob.error ?? "Yeniden deneyin."}</p></div> : <div className="frame-empty"><div className="frame-art"><div className="frame-person">{creatorMode === "ready" && selectedCreator ? <img src={selectedCreator.image} alt="Seçilen model" /> : creatorMode === "custom" && creatorPreview ? <img src={creatorPreview} alt="Seçilen model" /> : <span>M</span>}</div><div className="frame-product">{productPreview ? <img src={productPreview} alt="Seçilen ürün" /> : <ImagePlus size={22} />}</div></div><div className="frame-caption"><span className="frame-caption-line" /><span className="frame-caption-line short" /></div><span className="preview-label">ÖNİZLEME</span></div>}
            </div>
            {currentJob?.stage === "failed" && currentJob.canResume && <div className="resume-box"><p>Görsel hazır; ses isteğinin kaydı mevcut. Video isteği kaydedilmemiş. Hazır aşamalardan devam etmeyi seçebilirsin. Video için yaklaşık 1 cent/sn ücretlenir; konuşma uzunsa süre ve maliyet artabilir.</p><button type="button" className="generate-button" disabled={resuming} onClick={resumeJob}>{resuming ? "Hazırlanıyor..." : "Hazır aşamalardan videoyu oluştur"}</button></div>}
            {currentJob?.stage === "complete" && <a className="download-button" href={`/api/jobs/${currentJob.id}/video`}><ArrowDownToLine size={17} /> MP4 videoyu indir</a>}
            {warning && active && <p className="warning" role="status">{warning}</p>}
            <div className="result-note"><span className="note-icon"><Check size={16} /></span><p>Kişi ve ürün birlikte sahne referansı olarak kullanılır. Görünüm ve konuşma uyumu üretilen videoda kontrol edilmelidir.</p></div>
            {jobs.length > 0 && <div className="history"><h3>Son videolar</h3>{jobs.slice(0, 5).map((job) => <button type="button" className={`history-row ${currentJob?.id === job.id ? "active" : ""}`} key={job.id} onClick={() => setCurrentJob(job)}><span className="history-icon">{job.stage === "complete" ? <Play size={15} fill="currentColor" /> : job.stage === "failed" ? <X size={15} /> : <LoaderCircle size={15} className="spin" />}</span><span><strong>{job.stage === "complete" ? "UGC videosu" : stageText[job.stage] ?? "Video hazırlanıyor"}</strong><small>{formatDate(job.createdAt)}</small></span><ChevronRight size={16} /></button>)}</div>}
          </aside>
        </div>
      </main>
    </div>
  );
}
