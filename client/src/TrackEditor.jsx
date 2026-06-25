/**
 * TrackEditor.jsx — editable tracklist with inline review workflow.
 * Low-confidence tracks (<75%) are highlighted amber and flagged for review.
 * Users can edit artist/title/album inline, mark as confirmed, or mark as unidentified.
 */
import React, { useState } from "react";
import styles from "./App.module.css";

function confColor(score) {
  if (score >= 90) return "#1db954";
  if (score >= 75) return "#f59e0b";
  return "#ef4444";
}

function TrackRow({ track, index, onChange }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState({ ...track });

  const needsReview = !track.confirmed && !track.unidentified && track.score < 75;
  const isUnidentified = track.unidentified;

  const save = () => {
    onChange(index, { ...draft, confirmed: true });
    setEditing(false);
  };

  const cancel = () => {
    setDraft({ ...track });
    setEditing(false);
  };

  const markUnidentified = () => {
    onChange(index, { ...track, unidentified: true, confirmed: false });
    setEditing(false);
  };

  const markConfirmed = () => {
    onChange(index, { ...track, confirmed: true, unidentified: false });
  };

  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));

  return (
    <div className={`${styles.trackRow} ${needsReview ? styles.trackNeedsReview : ""} ${isUnidentified ? styles.trackUnidentified : ""} ${track.confirmed ? styles.trackConfirmed : ""}`}>
      <span className={styles.trackNum}>{index + 1}</span>
      <span className={styles.trackTime}>{track.offset}</span>

      {editing ? (
        <div className={styles.trackEditForm}>
          <input
            className={styles.trackEditInput}
            value={draft.title}
            onChange={(e) => set("title", e.target.value)}
            placeholder="Title"
          />
          <input
            className={styles.trackEditInput}
            value={draft.artist}
            onChange={(e) => set("artist", e.target.value)}
            placeholder="Artist"
          />
          <input
            className={styles.trackEditInput}
            value={draft.album || ""}
            onChange={(e) => set("album", e.target.value)}
            placeholder="Album (optional)"
          />
          <div className={styles.trackEditActions}>
            <button className={styles.trackEditSave} onClick={save}>Save</button>
            <button className={styles.trackEditCancel} onClick={cancel}>Cancel</button>
            <button className={styles.trackEditUnid} onClick={markUnidentified}>Mark unidentified</button>
          </div>
        </div>
      ) : (
        <div className={styles.trackInfo} onClick={() => setEditing(true)} title="Click to edit">
          {isUnidentified ? (
            <div className={styles.trackTitle} style={{ color: "var(--text-tertiary)", fontStyle: "italic" }}>
              Unidentified
            </div>
          ) : (
            <>
              <div className={styles.trackTitle}>{track.title}</div>
              <div className={styles.trackArtist}>
                {track.artist}
                {track.album && <span className={styles.trackAlbum}> · {track.album}</span>}
                {track.label && <span className={styles.trackLabel}> · {track.label}</span>}
                {track.releaseYear && <span className={styles.trackLabel}> · {track.releaseYear}</span>}
              </div>
              {track.isrc && <div className={styles.trackIsrc}>ISRC: {track.isrc}</div>}
              {needsReview && (
                <div className={styles.reviewBadge}>Needs review — click to edit</div>
              )}
            </>
          )}
        </div>
      )}

      <div className={styles.trackActions}>
        {!editing && !isUnidentified && !track.confirmed && (
          <button className={styles.confirmBtn} onClick={markConfirmed} title="Mark as confirmed">
            <TickIcon />
          </button>
        )}
        {track.confirmed && !editing && (
          <span className={styles.confirmedBadge} title="Confirmed">
            <TickIcon color="#1db954" />
          </span>
        )}
        {!editing && (
          <button className={styles.editBtn} onClick={() => setEditing(true)} title="Edit">
            <PenIcon />
          </button>
        )}
      </div>

      {!editing && (
        <div className={styles.trackConf}>
          <div className={styles.confBar}>
            <div className={styles.confFill} style={{
              width: isUnidentified ? "100%" : `${track.score}%`,
              background: isUnidentified ? "var(--text-tertiary)" : confColor(track.score)
            }} />
          </div>
          <span className={styles.confLabel} style={{ color: isUnidentified ? "var(--text-tertiary)" : confColor(track.score) }}>
            {isUnidentified ? "—" : `${track.score}%`}
          </span>
        </div>
      )}
    </div>
  );
}

function TickIcon({ color = "currentColor" }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  );
}

function PenIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
    </svg>
  );
}

export default function TrackEditor({ tracks, onChange }) {
  const needsReview = tracks.filter((t) => !t.confirmed && !t.unidentified && t.score < 75).length;
  const confirmed   = tracks.filter((t) => t.confirmed).length;
  const unidentified = tracks.filter((t) => t.unidentified).length;

  const handleChange = (index, updated) => {
    const next = [...tracks];
    next[index] = updated;
    onChange(next);
  };

  return (
    <div>
      {needsReview > 0 && (
        <div className={styles.reviewBanner}>
          {needsReview} track{needsReview > 1 ? "s" : ""} need review — click any highlighted row to edit.
          {confirmed > 0 && ` ${confirmed} confirmed.`}
          {unidentified > 0 && ` ${unidentified} unidentified.`}
        </div>
      )}
      <div className={styles.tracklist}>
        {tracks.map((t, i) => (
          <TrackRow key={i} track={t} index={i} onChange={handleChange} />
        ))}
      </div>
    </div>
  );
}
