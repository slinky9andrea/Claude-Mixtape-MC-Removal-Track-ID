/**
 * MixesDBImport.jsx
 * Lets the user paste a MixesDB URL and imports the tracklist.
 * Appears below the AudD results as an option to fill gaps or replace
 * an unidentified tracklist entirely.
 */
import React, { useState } from "react";
import styles from "./App.module.css";

export async function fetchMixesDB(url) {
  const res = await fetch("/api/mixesdb/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Import failed");
  return data;
}

export default function MixesDBImport({ existingTracks, onImport }) {
  const [url, setUrl]         = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);
  const [preview, setPreview] = useState(null);
  const [mode, setMode]       = useState("replace"); // "replace" | "merge"
  const [open, setOpen]       = useState(false);

  const handleFetch = async () => {
    if (!url.trim()) return;
    setLoading(true);
    setError(null);
    setPreview(null);
    try {
      const data = await fetchMixesDB(url.trim());
      setPreview(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleImport = () => {
    if (!preview) return;

    let finalTracks;

    if (mode === "replace") {
      // Replace the whole tracklist with MixesDB data, preserving AudD
      // offsets where the track title matches
      finalTracks = preview.tracks.map((mbTrack) => {
        // Try to find a matching AudD track to inherit the timestamp
        const auddMatch = existingTracks.find((t) =>
          t.title?.toLowerCase().includes(mbTrack.title?.toLowerCase().slice(0, 8)) ||
          mbTrack.title?.toLowerCase().includes(t.title?.toLowerCase().slice(0, 8))
        );
        return {
          ...mbTrack,
          offset: auddMatch?.offset || "",
          score: auddMatch ? auddMatch.score : 0,
          confirmed: false,
        };
      });
    } else {
      // Merge: add MixesDB tracks that aren't already identified by AudD
      const auddTitles = new Set(
        existingTracks.map((t) => t.title?.toLowerCase().trim())
      );
      const newTracks = preview.tracks.filter(
        (t) => !auddTitles.has(t.title?.toLowerCase().trim())
      );
      finalTracks = [...existingTracks, ...newTracks];
    }

    onImport(finalTracks, preview.meta);
    setOpen(false);
    setPreview(null);
    setUrl("");
  };

  if (!open) {
    return (
      <button className={styles.mixesdbTrigger} onClick={() => setOpen(true)}>
        <MixesDBIcon />
        Import tracklist from MixesDB
      </button>
    );
  }

  return (
    <div className={styles.mixesdbPanel}>
      <div className={styles.mixesdbHeader}>
        <div className={styles.mixesdbTitle}>
          <MixesDBIcon />
          Import from MixesDB
        </div>
        <button className={styles.mixesdbClose} onClick={() => { setOpen(false); setPreview(null); setError(null); }}>
          &times;
        </button>
      </div>

      <p className={styles.mixesdbHint}>
        Paste a MixesDB mix URL to import its tracklist. Useful for older mixes
        where tracks aren't in AudD's database.
      </p>

      <div className={styles.mixesdbInputRow}>
        <input
          className={styles.mixesdbInput}
          placeholder="https://www.mixesdb.com/w/1995-02-18_-_Andy_C_@_Syrous..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleFetch()}
          disabled={loading}
        />
        <button
          className={styles.mixesdbFetchBtn}
          onClick={handleFetch}
          disabled={loading || !url.trim()}
        >
          {loading ? "Fetching..." : "Fetch"}
        </button>
      </div>

      {error && (
        <div className={styles.mixesdbError}>{error}</div>
      )}

      {preview && (
        <div className={styles.mixesdbPreview}>
          <div className={styles.mixesdbPreviewHeader}>
            <div className={styles.mixesdbPreviewTitle}>{preview.pageTitle}</div>
            <span className={styles.mixesdbPreviewCount}>{preview.tracks.length} tracks</span>
          </div>

          {preview.meta?.dj && (
            <div className={styles.mixesdbPreviewMeta}>
              {[preview.meta.dj, preview.meta.event, preview.meta.dateRecorded, preview.meta.genre]
                .filter(Boolean).join(" · ")}
            </div>
          )}

          <div className={styles.mixesdbTrackList}>
            {preview.tracks.slice(0, 8).map((t, i) => (
              <div key={i} className={styles.mixesdbTrackRow}>
                <span className={styles.mixesdbTrackNum}>{i + 1}</span>
                <div className={styles.mixesdbTrackInfo}>
                  <span className={styles.mixesdbTrackTitle}>{t.title}</span>
                  <span className={styles.mixesdbTrackArtist}>{t.artist}</span>
                  {t.label && <span className={styles.mixesdbTrackLabel}>{t.label}</span>}
                  {t.isUnreleased && <span className={styles.mixesdbUnreleased}>dubplate / unreleased</span>}
                </div>
              </div>
            ))}
            {preview.tracks.length > 8 && (
              <div className={styles.mixesdbMore}>
                +{preview.tracks.length - 8} more tracks
              </div>
            )}
          </div>

          {existingTracks.length > 0 && (
            <div className={styles.mixesdbModeRow}>
              <button
                className={`${styles.mixesdbModeBtn} ${mode === "replace" ? styles.mixesdbModeBtnActive : ""}`}
                onClick={() => setMode("replace")}
              >
                Replace tracklist
                <span className={styles.mixesdbModeDesc}>Use MixesDB as the primary tracklist, inheriting AudD timestamps where possible</span>
              </button>
              <button
                className={`${styles.mixesdbModeBtn} ${mode === "merge" ? styles.mixesdbModeBtnActive : ""}`}
                onClick={() => setMode("merge")}
              >
                Merge with AudD results
                <span className={styles.mixesdbModeDesc}>Add MixesDB tracks not already identified by AudD</span>
              </button>
            </div>
          )}

          <button className={styles.mixesdbImportBtn} onClick={handleImport}>
            Import {preview.tracks.length} tracks
          </button>
        </div>
      )}
    </div>
  );
}

function MixesDBIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
    </svg>
  );
}
