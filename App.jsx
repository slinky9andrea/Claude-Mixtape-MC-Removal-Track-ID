import React, { useState, useRef, useCallback } from "react";
import { uploadToLalal, pollLalalStatus, recognizeMix, checkHealth } from "./api.js";
import styles from "./App.module.css";

// ── Pipeline stage definitions ────────────────────────────────────────────────

const STAGES = [
  { id: "idle",       label: "Ready" },
  { id: "uploading",  label: "Uploading" },
  { id: "stripping",  label: "Stripping vocals" },
  { id: "recognizing",label: "Identifying songs" },
  { id: "done",       label: "Tracklist ready" },
  { id: "error",      label: "Error" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtSize(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function confColor(score) {
  if (score >= 90) return "#1db954";
  if (score >= 75) return "#f59e0b";
  return "#ef4444";
}

function exportCSV(tracks, filename) {
  const header = "Track,Timestamp,Artist,Title,Album,Label,ISRC,Confidence\n";
  const rows = tracks.map((t, i) =>
    [i + 1, t.offset, `"${t.artist}"`, `"${t.title}"`, `"${t.album || ""}"`,
     `"${t.label || ""}"`, t.isrc || "", `${t.score}%`].join(",")
  ).join("\n");
  const blob = new Blob([header + rows], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename.replace(/\.mp3$/i, "") + "-tracklist.csv";
  a.click();
}

// ── Sub-components ────────────────────────────────────────────────────────────

function UploadZone({ onFile, disabled }) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef();

  const handle = (file) => {
    if (!file) return;
    if (!file.type.startsWith("audio/") && !file.name.endsWith(".mp3")) {
      alert("Please select an MP3 or audio file.");
      return;
    }
    onFile(file);
  };

  return (
    <div
      className={`${styles.uploadZone} ${dragging ? styles.dragging : ""} ${disabled ? styles.disabled : ""}`}
      onClick={() => !disabled && inputRef.current.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); handle(e.dataTransfer.files[0]); }}
    >
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
      </svg>
      <p>Drop a DJ mixtape MP3 here</p>
      <span>or click to browse</span>
      <input
        ref={inputRef}
        type="file"
        accept=".mp3,audio/*"
        style={{ display: "none" }}
        onChange={(e) => handle(e.target.files[0])}
      />
    </div>
  );
}

function ProgressBar({ value, color = "var(--accent)" }) {
  return (
    <div className={styles.progressTrack}>
      <div className={styles.progressFill} style={{ width: `${value}%`, background: color }} />
    </div>
  );
}

function StageRow({ icon, label, detail, status, progress }) {
  const statusColors = { done: "#1db954", running: "#f59e0b", error: "#ef4444", idle: "#555" };
  const color = statusColors[status] || "#555";

  return (
    <div className={styles.stageRow}>
      <div className={styles.stageIcon} style={{ color }}>
        {status === "running" ? <Spinner /> : icon}
      </div>
      <div className={styles.stageInfo}>
        <div className={styles.stageName} style={{ color: status === "idle" ? "var(--text-tertiary)" : "var(--text-primary)" }}>
          {label}
        </div>
        {detail && <div className={styles.stageDetail}>{detail}</div>}
        {status === "running" && progress !== undefined && (
          <ProgressBar value={progress} />
        )}
      </div>
      <div className={styles.stageStatus}>
        {status === "done" && <CheckIcon />}
        {status === "error" && <span style={{ color: "#ef4444" }}>✕</span>}
      </div>
    </div>
  );
}

function TrackRow({ index, track }) {
  return (
    <div className={styles.trackRow}>
      <span className={styles.trackNum}>{index + 1}</span>
      <span className={styles.trackTime}>{track.offset}</span>
      <div className={styles.trackInfo}>
        <div className={styles.trackTitle}>{track.title}</div>
        <div className={styles.trackArtist}>
          {track.artist}
          {track.album ? <span className={styles.trackAlbum}> · {track.album}</span> : null}
          {track.label ? <span className={styles.trackLabel}> · {track.label}</span> : null}
        </div>
        {track.isrc && <div className={styles.trackIsrc}>ISRC: {track.isrc}</div>}
      </div>
      <div className={styles.trackConf}>
        <div className={styles.confBar}>
          <div className={styles.confFill} style={{ width: `${track.score}%`, background: confColor(track.score) }} />
        </div>
        <span className={styles.confLabel} style={{ color: confColor(track.score) }}>{track.score}%</span>
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" style={{ animation: "spin 1s linear infinite" }}>
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1db954" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────

export default function App() {
  const [file, setFile] = useState(null);
  const [stage, setStage] = useState("idle");
  const [uploadPct, setUploadPct] = useState(0);
  const [stripPct, setStripPct] = useState(0);
  const [stripDetail, setStripDetail] = useState("");
  const [tracks, setTracks] = useState([]);
  const [error, setError] = useState(null);
  const [scanInterval, setScanInterval] = useState(30);

  const handleFile = useCallback((f) => {
    setFile(f);
    setStage("idle");
    setTracks([]);
    setError(null);
  }, []);

  const run = async () => {
    if (!file) return;
    setError(null);
    setUploadPct(0);
    setStripPct(0);
    setTracks([]);

    try {
      // ── Stage 1: Upload to LALAL.AI ─────────────────────────────────────────
      setStage("uploading");
      const { fileId } = await uploadToLalal(file, setUploadPct);

      // ── Stage 2: Poll for vocal separation ─────────────────────────────────
      setStage("stripping");
      setStripDetail("Processing audio on LALAL.AI…");

      const { instrumentalUrl, durationSeconds } = await pollLalalStatus(
        fileId,
        ({ status, progress }) => {
          setStripDetail(status === "queued" ? "Queued on LALAL.AI…" : "Separating vocals from instrumental…");
          setStripPct(progress);
        }
      );

      setStripPct(100);
      setStripDetail("Instrumental stem ready");

      // ── Stage 3: AudD enterprise recognition ───────────────────────────────
      setStage("recognizing");

      // Convert scan interval (seconds) to AudD skip param:
      // AudD scans 12s chunks. skip = (interval / 12) - 1
      const skip = Math.max(0, Math.round(scanInterval / 12) - 1);
      const { tracks: found } = await recognizeMix(instrumentalUrl, { skip, every: 1 });
      setTracks(found);
      setStage("done");
    } catch (err) {
      console.error(err);
      setError(err.message);
      setStage("error");
    }
  };

  const stageIndex = STAGES.findIndex((s) => s.id === stage);
  const isRunning = ["uploading", "stripping", "recognizing"].includes(stage);
  const avgConf = tracks.length
    ? Math.round(tracks.reduce((s, t) => s + t.score, 0) / tracks.length)
    : 0;

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

        <nav className={styles.pipeline}>
          {[
            { label: "Upload mix", done: stageIndex > 0, active: stage === "idle" || stage === "uploading" },
            { label: "Strip vocals", done: stageIndex > 2, active: stage === "stripping" },
            { label: "Identify songs", done: stageIndex > 3, active: stage === "recognizing" },
            { label: "Export tracklist", done: stage === "done", active: stage === "done" },
          ].map((step, i) => (
            <div key={i} className={`${styles.navStep} ${step.active ? styles.navActive : ""} ${step.done ? styles.navDone : ""}`}>
              <div className={styles.navDot} />
              <span>{step.label}</span>
            </div>
          ))}
        </nav>

        <div className={styles.sidebarFooter}>
          <div className={styles.footerLabel}>Powered by</div>
          <div className={styles.footerPill}>LALAL.AI</div>
          <div className={styles.footerPill}>AudD</div>
          <div className={styles.footerPill}>MusicBrainz</div>
        </div>
      </aside>

      <main className={styles.main}>
        <h1 className={styles.heading}>Mixtape tracklist generator</h1>
        <p className={styles.subheading}>
          Drop a DJ mix. We strip MC speech, fingerprint every song, and return a timestamped tracklist.
        </p>

        <UploadZone onFile={handleFile} disabled={isRunning} />

        {file && (
          <div className={styles.filePill}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
            {file.name}
            <span className={styles.fileSize}>{fmtSize(file.size)}</span>
          </div>
        )}

        <div className={styles.config}>
          <label className={styles.configLabel}>
            Scan density
            <span className={styles.configHint}>Every {scanInterval}s — shorter = more accurate, higher API cost</span>
          </label>
          <div className={styles.sliderRow}>
            <span className={styles.sliderMin}>10s</span>
            <input
              type="range"
              min="10"
              max="120"
              step="10"
              value={scanInterval}
              onChange={(e) => setScanInterval(Number(e.target.value))}
              className={styles.slider}
              disabled={isRunning}
            />
            <span className={styles.sliderMax}>120s</span>
          </div>
        </div>

        {(stage !== "idle" || isRunning) && (
          <div className={styles.progressBlock}>
            <StageRow
              icon="↑"
              label="Upload to LALAL.AI"
              detail={stage === "uploading" ? `Uploading ${file?.name}…` : uploadPct === 100 ? "Upload complete" : ""}
              status={stage === "uploading" ? "running" : stageIndex > 1 ? "done" : "idle"}
              progress={uploadPct}
            />
            <StageRow
              icon="✂"
              label="Strip MC vocals"
              detail={stripDetail}
              status={stage === "stripping" ? "running" : stageIndex > 2 ? "done" : "idle"}
              progress={stripPct}
            />
            <StageRow
              icon="⌥"
              label="AudD song fingerprinting"
              detail={stage === "recognizing" ? "Scanning instrumental for tracks…" : tracks.length ? `${tracks.length} tracks identified` : ""}
              status={stage === "recognizing" ? "running" : stage === "done" ? "done" : stage === "error" ? "error" : "idle"}
            />
          </div>
        )}

        {error && (
          <div className={styles.errorBox}>
            <strong>Error:</strong> {error}
            <p className={styles.errorHint}>Check that your API keys are set in <code>server/.env</code> and the server is running on port 3001.</p>
          </div>
        )}

        {!isRunning && (
          <button
            className={styles.runBtn}
            onClick={run}
            disabled={!file}
          >
            {stage === "done" ? "Run again" : stage === "error" ? "Retry" : "Generate tracklist"}
          </button>
        )}

        {stage === "done" && tracks.length > 0 && (
          <section className={styles.results}>
            <div className={styles.summaryRow}>
              <div className={styles.statCard}>
                <div className={styles.statLabel}>Tracks found</div>
                <div className={styles.statVal}>{tracks.length}</div>
              </div>
              <div className={styles.statCard}>
                <div className={styles.statLabel}>High confidence</div>
                <div className={styles.statVal}>{tracks.filter((t) => t.score >= 90).length}</div>
              </div>
              <div className={styles.statCard}>
                <div className={styles.statLabel}>Avg confidence</div>
                <div className={styles.statVal}>{avgConf}%</div>
              </div>
            </div>

            <div className={styles.tracklistHeader}>
              <h2 className={styles.tracklistTitle}>
                {file.name.replace(/\.mp3$/i, "").replace(/_/g, " ")}
              </h2>
              <button className={styles.exportBtn} onClick={() => exportCSV(tracks, file.name)}>
                ↓ Export CSV
              </button>
            </div>

            <div className={styles.tracklist}>
              {tracks.map((t, i) => (
                <TrackRow key={i} index={i} track={t} />
              ))}
            </div>
          </section>
        )}

        {stage === "done" && tracks.length === 0 && (
          <div className={styles.emptyState}>
            No tracks identified. Try a shorter scan interval or check that the instrumental URL is publicly accessible.
          </div>
        )}
      </main>
    </div>
  );
}
