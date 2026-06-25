import React, { useState, useRef, useCallback } from "react";
import { prepareFile, recognizeMix, uploadToLalal, pollLalalStatus,
         enrichTracks, saveMixToLibrary, updateMixInLibrary, isVideoFile } from "./api.js";
import MixMeta    from "./MixMeta.jsx";
import MixesDBImport from "./MixesDBImport.jsx";
import TrackEditor from "./TrackEditor.jsx";
import Library    from "./Library.jsx";
import styles     from "./App.module.css";

const MC_MODES = [
  { id: "none",       label: "No MC",               description: "Instrumental mix or music only. No speech to remove." },
  { id: "between",    label: "MC between tracks",    description: "MC talks over intros, outros, and transitions but not over the music itself." },
  { id: "throughout", label: "MC throughout",        description: "MC talks continuously over the entire set, including during tracks." },
];

const STAGES = [
  { id: "idle" }, { id: "uploading" }, { id: "stripping" },
  { id: "recognizing" }, { id: "enriching" }, { id: "done" }, { id: "error" },
];

function fmtSize(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Merge two track arrays keeping highest confidence per artist+title
function mergeTracks(a, b) {
  const map = new Map();
  const toSec = (t) => { const p = (t||"0:00").split(":").map(Number); return p.length===3?p[0]*3600+p[1]*60+p[2]:p[0]*60+(p[1]||0); };
  for (const t of [...a, ...b]) {
    const key = `${t.artist}|${t.title}`;
    if (!map.has(key) || t.score > map.get(key).score) map.set(key, t);
  }
  return Array.from(map.values()).sort((a,b) => toSec(a.offset) - toSec(b.offset));
}

// ── Upload zone ───────────────────────────────────────────────────────────────

const MAX_AUDIO_MB = 300, MAX_VIDEO_MB = 2048;

function UploadZone({ onFile, disabled }) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef();

  const handle = (file) => {
    if (!file) return;
    const isAudio = file.type.startsWith("audio/") || /\.(mp3|flac|wav|m4a|aac)$/i.test(file.name);
    const isVid   = file.type.startsWith("video/") || /\.(mp4|mov|mkv|avi|webm)$/i.test(file.name);
    if (!isAudio && !isVid) { alert("Please select an audio or video file."); return; }
    const maxB = isVid ? MAX_VIDEO_MB*1024*1024 : MAX_AUDIO_MB*1024*1024;
    if (file.size > maxB) { alert(`File too large. Max is ${isVid?"2 GB for video":"300 MB for audio"}.`); return; }
    onFile(file);
  };

  return (
    <div
      className={`${styles.uploadZone} ${dragging?styles.dragging:""} ${disabled?styles.disabled:""}`}
      onClick={() => !disabled && inputRef.current.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); handle(e.dataTransfer.files[0]); }}
    >
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
      </svg>
      <p>Drop a mixtape or video here</p>
      <div className={styles.formatGrid}>
        <div className={styles.formatGroup}>
          <span className={styles.formatLabel}>Audio</span>
          <span className={styles.formatTags}>{["MP3","FLAC","WAV","M4A","AAC"].map(f=><span key={f} className={styles.formatTag}>{f}</span>)}</span>
          <span className={styles.formatLimit}>max 300 MB</span>
        </div>
        <div className={styles.formatDivider}/>
        <div className={styles.formatGroup}>
          <span className={styles.formatLabel}>Video</span>
          <span className={styles.formatTags}>{["MP4","MOV","MKV","AVI","WebM"].map(f=><span key={f} className={styles.formatTag}>{f}</span>)}</span>
          <span className={styles.formatLimit}>max 2 GB · audio extracted automatically</span>
        </div>
      </div>
      <input ref={inputRef} type="file" accept=".mp3,.flac,.wav,.m4a,.aac,.mp4,.mov,.mkv,.avi,.webm,audio/*,video/*" style={{display:"none"}} onChange={(e)=>handle(e.target.files[0])}/>
    </div>
  );
}

function MCModeSelector({ value, onChange, disabled }) {
  return (
    <div className={styles.mcSection}>
      <div className={styles.configLabel}>
        Is there an MC on this mix?
        <span className={styles.configHint}>Determines which processing pipeline runs.</span>
      </div>
      <div className={styles.mcCards}>
        {MC_MODES.map((mode) => (
          <button key={mode.id} className={`${styles.mcCard} ${value===mode.id?styles.mcCardActive:""}`} onClick={()=>!disabled&&onChange(mode.id)} disabled={disabled}>
            <div className={styles.mcCardDot}/>
            <div className={styles.mcCardContent}>
              <div className={styles.mcCardLabel}>{mode.label}</div>
              <div className={styles.mcCardDesc}>{mode.description}</div>
            </div>
          </button>
        ))}
      </div>
      {value==="throughout" && <div className={styles.mcWarning}>Two-pass mode: AudD runs on both original and LALAL.AI instrumental. Longer processing time and LALAL.AI minutes consumed for the full mix.</div>}
      {value==="between"    && <div className={styles.mcInfo}>Songs identified from original unmodified audio for best accuracy. LALAL.AI available on demand for gap regions after identification.</div>}
      {value==="none"       && <div className={styles.mcInfo}>No vocal stripping needed. AudD fingerprints the original mix directly. Fastest and cheapest pipeline.</div>}
    </div>
  );
}

function StageRow({ icon, label, detail, status, progress }) {
  const color = {done:"#1db954",running:"#f59e0b",error:"#ef4444",idle:"#444"}[status]||"#444";
  return (
    <div className={styles.stageRow}>
      <div className={styles.stageIcon} style={{color}}>
        {status==="running" ? <Spinner/> : <span>{icon}</span>}
      </div>
      <div className={styles.stageInfo}>
        <div className={styles.stageName} style={{color:status==="idle"?"var(--text-tertiary)":"var(--text-primary)"}}>{label}</div>
        {detail && <div className={styles.stageDetail}>{detail}</div>}
        {status==="running" && progress!==undefined && (
          <div className={styles.progressTrack}><div className={styles.progressFill} style={{width:`${progress}%`,background:"var(--accent)"}}/></div>
        )}
      </div>
      <div className={styles.stageStatus}>
        {status==="done"  && <CheckIcon/>}
        {status==="error" && <span style={{color:"#ef4444",fontSize:14}}>x</span>}
      </div>
    </div>
  );
}

function Spinner() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" style={{animation:"spin 1s linear infinite"}}><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>;
}
function CheckIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1db954" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>;
}

// ── Main App ──────────────────────────────────────────────────────────────────

export default function App() {
  const [view, setView]           = useState("app");   // "app" | "library"
  const [file, setFile]           = useState(null);
  const [mcMode, setMcMode]       = useState("none");
  const [stage, setStage]         = useState("idle");
  const [uploadPct, setUploadPct] = useState(0);
  const [stripPct, setStripPct]   = useState(0);
  const [stripDetail, setStripDetail] = useState("");
  const [tracks, setTracks]       = useState([]);
  const [error, setError]         = useState(null);
  const [scanInterval, setScanInterval] = useState(30);
  const [duration, setDuration]   = useState(null);
  const [savedMixId, setSavedMixId] = useState(null);
  const [saving, setSaving]       = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [importedMeta, setImportedMeta] = useState(null);

  const reset = () => {
    setFile(null); setStage("idle"); setTracks([]); setError(null);
    setDuration(null); setSavedMixId(null); setUploadPct(0); setStripPct(0);
  };

  const run = async () => {
    if (!file) return;
    setError(null); setUploadPct(0); setStripPct(0); setTracks([]); setSavedMixId(null);
    try {
      setStage("uploading");
      const { audioPath, durationMinutes } = await prepareFile(file, setUploadPct);
      setDuration(durationMinutes);

      let found = [];

      if (mcMode === "none" || mcMode === "between") {
        setStage("recognizing");
        const { tracks: t } = await recognizeMix(audioPath, { intervalSeconds: scanInterval });
        found = t.map((t) => ({ ...t, source: "original" }));
      } else {
        // Two-pass: original first
        setStage("recognizing");
        const { tracks: origTracks } = await recognizeMix(audioPath, { intervalSeconds: scanInterval });

        // Then LALAL.AI strip + AudD on instrumental
        setStage("stripping");
        setStripDetail("Uploading to LALAL.AI...");
        const { fileId } = await uploadToLalal(file, (p) => setStripPct(p * 0.5));
        const { instrumentalUrl } = await pollLalalStatus(fileId, ({ status, progress }) => {
          setStripDetail(status === "queued" ? "Queued on LALAL.AI..." : "Stripping MC vocals...");
          setStripPct(50 + progress * 0.5);
        });
        setStripPct(100);

        setStage("recognizing");
        const { tracks: strippedTracks } = await recognizeMix(instrumentalUrl, { intervalSeconds: scanInterval });

        found = mergeTracks(
          origTracks.map((t) => ({ ...t, source: "original" })),
          strippedTracks.map((t) => ({ ...t, source: "stripped" }))
        );
      }

      // MusicBrainz enrichment
      setStage("enriching");
      setEnriching(true);
      try {
        const enriched = await enrichTracks(found);
        found = enriched;
      } catch {
        // enrichment is best-effort — don't fail the whole pipeline
      } finally {
        setEnriching(false);
      }

      setTracks(found);
      setStage("done");
    } catch (err) {
      console.error(err);
      setError(err.message);
      setStage("error");
    }
  };

  const handleTrackChange = (updated) => {
    setTracks(updated);
    // If already saved, auto-patch the library record
    if (savedMixId) {
      updateMixInLibrary(savedMixId, { tracks: updated }).catch(console.error);
    }
  };

  const handleSave = async (meta) => {
    setSaving(true);
    try {
      const record = await saveMixToLibrary({ meta, tracks, mcMode, filename: file?.name });
      setSavedMixId(record.id);
    } catch (err) {
      alert("Save failed: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const stageIndex = STAGES.findIndex((s) => s.id === stage);
  const isRunning  = ["uploading","stripping","recognizing","enriching"].includes(stage);
  const showStrip  = mcMode === "throughout";
  const avgConf    = tracks.length ? Math.round(tracks.reduce((s,t)=>s+(t.score||0),0)/tracks.length) : 0;

  const navSteps = mcMode === "throughout"
    ? [
        {label:"Upload mix",       done:stageIndex>1, active:stage==="idle"||stage==="uploading"},
        {label:"Strip MC vocals",  done:stageIndex>2, active:stage==="stripping"},
        {label:"Identify songs",   done:stageIndex>3, active:stage==="recognizing"},
        {label:"Enrich metadata",  done:stageIndex>4, active:stage==="enriching"},
        {label:"Review & save",    done:stage==="done"&&!!savedMixId, active:stage==="done"},
      ]
    : [
        {label:"Upload mix",       done:stageIndex>1, active:stage==="idle"||stage==="uploading"},
        {label:"Identify songs",   done:stageIndex>2, active:stage==="recognizing"},
        {label:"Enrich metadata",  done:stageIndex>3, active:stage==="enriching"},
        {label:"Review & save",    done:stage==="done"&&!!savedMixId, active:stage==="done"},
      ];

  return (
    <div className={styles.layout}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      <aside className={styles.sidebar}>
        <div className={styles.logo}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
          </svg>
          <span>Tracklist</span>
        </div>

        <div className={styles.sidebarTabs}>
          <button className={`${styles.sidebarTab} ${view==="app"?styles.sidebarTabActive:""}`} onClick={()=>setView("app")}>Generate</button>
          <button className={`${styles.sidebarTab} ${view==="library"?styles.sidebarTabActive:""}`} onClick={()=>setView("library")}>Library</button>
        </div>

        {view === "app" && (
          <nav className={styles.pipeline}>
            {navSteps.map((step,i) => (
              <div key={i} className={`${styles.navStep} ${step.active?styles.navActive:""} ${step.done?styles.navDone:""}`}>
                <div className={styles.navDot}/>
                <span>{step.label}</span>
              </div>
            ))}
          </nav>
        )}

        <div className={styles.sidebarFooter}>
          <div className={styles.footerLabel}>Powered by</div>
          <div className={styles.footerPill}>AudD</div>
          <div className={styles.footerPill}>MusicBrainz</div>
          {mcMode !== "none" && <div className={styles.footerPill}>LALAL.AI</div>}
        </div>
      </aside>

      <main className={styles.main}>

        {/* ── Library view ── */}
        <Library visible={view==="library"} onOpenMix={(id) => { setView("app"); }} />

        {/* ── Generator view ── */}
        {view === "app" && (<>
          <h1 className={styles.heading}>Mixtape tracklist generator</h1>
          <p className={styles.subheading}>Identify every song in a DJ mix. Upload audio or video — we handle the rest.</p>

          <UploadZone onFile={(f)=>{setFile(f);setStage("idle");setTracks([]);setError(null);setDuration(null);setSavedMixId(null);}} disabled={isRunning}/>

          {file && (
            <div className={styles.filePill}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
              {file.name}
              <span className={styles.fileSize}>{fmtSize(file.size)}</span>
              {isVideoFile(file) && <span className={styles.videoBadge}>video</span>}
            </div>
          )}

          <MCModeSelector value={mcMode} onChange={setMcMode} disabled={isRunning}/>

          <div className={styles.config}>
            <label className={styles.configLabel}>
              Scan density
              <span className={styles.configHint}>Every {scanInterval}s — shorter = more accurate, higher API cost</span>
            </label>
            <div className={styles.sliderRow}>
              <span className={styles.sliderMin}>10s</span>
              <input type="range" min="10" max="120" step="10" value={scanInterval} onChange={(e)=>setScanInterval(Number(e.target.value))} className={styles.slider} disabled={isRunning}/>
              <span className={styles.sliderMax}>120s</span>
            </div>
          </div>

          {stage !== "idle" && (
            <div className={styles.progressBlock}>
              <StageRow icon="^" label={file&&isVideoFile(file)?"Extract audio + prepare":"Upload + prepare"}
                detail={stage==="uploading"?(isVideoFile(file)?`Extracting audio from ${file?.name}...`:`Uploading ${file?.name}...`):`Ready${duration?` - ${duration} min`:""}`}
                status={stage==="uploading"?"running":stageIndex>1?"done":"idle"} progress={uploadPct}/>
              {showStrip && (
                <StageRow icon="~" label="LALAL.AI full vocal strip" detail={stage==="stripping"?stripDetail:stripPct===100?"Instrumental ready":""}
                  status={stage==="stripping"?"running":stageIndex>2?"done":"idle"} progress={stripPct}/>
              )}
              <StageRow icon="*"
                label={mcMode==="throughout"?"AudD fingerprinting (two-pass: original + instrumental)":"AudD fingerprinting (original audio)"}
                detail={stage==="recognizing"?(mcMode==="throughout"?"Running two-pass fingerprint...":"Scanning unmodified mix — vocals intact for best accuracy..."):tracks.length?`${tracks.length} tracks identified`:""}
                status={stage==="recognizing"?"running":stageIndex>3?"done":stage==="error"?"error":"idle"}/>
              <StageRow icon="+" label="MusicBrainz metadata enrichment"
                detail={stage==="enriching"?`Enriching ${tracks.length} tracks with release year, label, catalog...`:stage==="done"?"Metadata complete":""}
                status={stage==="enriching"?"running":stage==="done"?"done":"idle"}/>
            </div>
          )}

          {error && (
            <div className={styles.errorBox}>
              <strong>Error:</strong> {error}
              <p className={styles.errorHint}>Check that your API keys are set in <code>server/.env</code> and the server is running on port 3001.</p>
            </div>
          )}

          {!isRunning && (
            <button className={styles.runBtn} onClick={stage==="done"?reset:run} disabled={!file&&stage!=="done"}>
              {stage==="done"?"Start new mix":stage==="error"?"Retry":"Generate tracklist"}
            </button>
          )}

          {stage === "done" && tracks.length > 0 && (<>
            <div className={styles.summaryRow}>
              <div className={styles.statCard}><div className={styles.statLabel}>Tracks found</div><div className={styles.statVal}>{tracks.length}</div></div>
              <div className={styles.statCard}><div className={styles.statLabel}>High confidence</div><div className={styles.statVal}>{tracks.filter(t=>t.score>=90).length}</div></div>
              <div className={styles.statCard}><div className={styles.statLabel}>Needs review</div><div className={styles.statVal} style={{color:"#f59e0b"}}>{tracks.filter(t=>!t.confirmed&&!t.unidentified&&t.score<75).length}</div></div>
              <div className={styles.statCard}><div className={styles.statLabel}>Avg confidence</div><div className={styles.statVal}>{avgConf}%</div></div>
            </div>

            <div className={styles.tracklistHeader}>
              <h2 className={styles.tracklistTitle}>
                {file.name.replace(/\.(mp3|mp4|mov|mkv|avi|webm|flac|wav|m4a|aac)$/i,"").replace(/_/g," ")}
              </h2>
              {savedMixId && (
                <div className={styles.exportBtns}>
                  <a href={`/api/library/${savedMixId}/pdf`} target="_blank" rel="noreferrer" className={styles.exportBtn}>Download PDF</a>
                  <a href={`/api/library/${savedMixId}/csv`} download className={styles.exportBtn}>Download CSV</a>
                </div>
              )}
            </div>

            <TrackEditor tracks={tracks} onChange={handleTrackChange}/>

            <MixesDBImport
              existingTracks={tracks}
              onImport={(importedTracks, importedMeta) => {
                handleTrackChange(importedTracks);
                // Pre-fill mix meta if not already saved
                if (!savedMixId && importedMeta) {
                  setImportedMeta(importedMeta);
                }
              }}
            />

            {!savedMixId && (
              <MixMeta filename={file?.name} defaultMeta={importedMeta} onSave={handleSave} onSkip={()=>setSavedMixId("skipped")} saving={saving}/>
            )}
            {savedMixId && savedMixId !== "skipped" && (
              <div className={styles.savedBanner}>
                Saved to library. Track edits are auto-saved.
                <button className={styles.savedViewBtn} onClick={()=>setView("library")}>View library</button>
              </div>
            )}
          </>)}

          {stage==="done"&&tracks.length===0&&(
            <div className={styles.emptyState}>No tracks identified. Try a shorter scan interval or check the server logs for errors.</div>
          )}
        </>)}
      </main>
    </div>
  );
}
