/**
 * MixMeta.jsx — mix tagging form shown after tracks are identified.
 * Collects: DJ name, date recorded, genre/style, event name, notes.
 */
import React, { useState } from "react";
import styles from "./App.module.css";

export default function MixMeta({ filename, defaultMeta, onSave, onSkip, saving }) {
  const [meta, setMeta] = useState({
    dj:           defaultMeta?.dj           || "",
    dateRecorded: defaultMeta?.dateRecorded || "",
    genre:        defaultMeta?.genre        || "",
    event:        defaultMeta?.event        || filename?.replace(/\.(mp3|mp4|mov|mkv|avi|webm|flac|wav|m4a|aac)$/i, "").replace(/_/g, " ") || "",
    notes:        "",
  });

  const set = (k, v) => setMeta((m) => ({ ...m, [k]: v }));
  const canSave = meta.dj.trim() || meta.event.trim();

  return (
    <div className={styles.metaCard}>
      <div className={styles.metaHeader}>
        <h3 className={styles.metaTitle}>Save to library</h3>
        <p className={styles.metaSubtitle}>Tag this mix before saving. You can edit these later.</p>
      </div>

      <div className={styles.metaGrid}>
        <div className={styles.metaField}>
          <label className={styles.metaLabel}>DJ / Artist *</label>
          <input
            className={styles.metaInput}
            placeholder="e.g. Andy C"
            value={meta.dj}
            onChange={(e) => set("dj", e.target.value)}
          />
        </div>
        <div className={styles.metaField}>
          <label className={styles.metaLabel}>Event name</label>
          <input
            className={styles.metaInput}
            placeholder="e.g. Champion of Champions 1994"
            value={meta.event}
            onChange={(e) => set("event", e.target.value)}
          />
        </div>
        <div className={styles.metaField}>
          <label className={styles.metaLabel}>Date recorded</label>
          <input
            className={styles.metaInput}
            type="date"
            value={meta.dateRecorded}
            onChange={(e) => set("dateRecorded", e.target.value)}
          />
        </div>
        <div className={styles.metaField}>
          <label className={styles.metaLabel}>Genre / style</label>
          <input
            className={styles.metaInput}
            placeholder="e.g. Drum & Bass"
            value={meta.genre}
            onChange={(e) => set("genre", e.target.value)}
          />
        </div>
        <div className={styles.metaField} style={{ gridColumn: "span 2" }}>
          <label className={styles.metaLabel}>Notes</label>
          <textarea
            className={styles.metaTextarea}
            placeholder="Venue, source, quality notes..."
            rows={3}
            value={meta.notes}
            onChange={(e) => set("notes", e.target.value)}
          />
        </div>
      </div>

      <div className={styles.metaActions}>
        <button className={styles.metaSkip} onClick={onSkip} disabled={saving}>
          Skip for now
        </button>
        <button
          className={styles.metaSave}
          onClick={() => onSave(meta)}
          disabled={!canSave || saving}
        >
          {saving ? "Saving..." : "Save to library"}
        </button>
      </div>
    </div>
  );
}
