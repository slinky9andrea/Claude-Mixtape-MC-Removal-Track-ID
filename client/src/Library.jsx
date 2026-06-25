/**
 * Library.jsx — browse and manage saved mixes.
 * Shows as a panel when the user clicks "Library" in the sidebar.
 */
import React, { useState, useEffect } from "react";
import { listMixes, deleteMixApi } from "./api.js";
import styles from "./App.module.css";

function formatDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function confColor(score) {
  if (score >= 90) return "#1db954";
  if (score >= 75) return "#f59e0b";
  return "#ef4444";
}

function MixCard({ mix, onOpen, onDelete }) {
  const [confirming, setConfirming] = useState(false);

  return (
    <div className={styles.mixCard}>
      <div className={styles.mixCardMain} onClick={() => onOpen(mix.id)}>
        <div className={styles.mixCardTitle}>
          {mix.meta?.event || mix.filename || "Untitled mix"}
        </div>
        <div className={styles.mixCardMeta}>
          {mix.meta?.dj && <span>{mix.meta.dj}</span>}
          {mix.meta?.genre && <span>{mix.meta.genre}</span>}
          {mix.meta?.dateRecorded && <span>{formatDate(mix.meta.dateRecorded)}</span>}
        </div>
        <div className={styles.mixCardStats}>
          <span className={styles.mixStat}>{mix.trackCount} tracks</span>
          <span className={styles.mixStat} style={{ color: confColor(mix.avgConfidence) }}>
            {mix.avgConfidence}% avg confidence
          </span>
          <span className={styles.mixStatDate}>{formatDate(mix.createdAt)}</span>
        </div>
      </div>
      <div className={styles.mixCardActions}>
        <a
          href={`/api/library/${mix.id}/pdf`}
          target="_blank"
          rel="noreferrer"
          className={styles.mixActionBtn}
          title="Download PDF"
          onClick={(e) => e.stopPropagation()}
        >
          PDF
        </a>
        <a
          href={`/api/library/${mix.id}/csv`}
          download
          className={styles.mixActionBtn}
          title="Download CSV"
          onClick={(e) => e.stopPropagation()}
        >
          CSV
        </a>
        {confirming ? (
          <div className={styles.mixDeleteConfirm}>
            <span>Delete?</span>
            <button onClick={(e) => { e.stopPropagation(); onDelete(mix.id); setConfirming(false); }}>Yes</button>
            <button onClick={(e) => { e.stopPropagation(); setConfirming(false); }}>No</button>
          </div>
        ) : (
          <button
            className={styles.mixDeleteBtn}
            onClick={(e) => { e.stopPropagation(); setConfirming(true); }}
            title="Delete mix"
          >
            &times;
          </button>
        )}
      </div>
    </div>
  );
}

export default function Library({ onOpenMix, visible }) {
  const [mixes, setMixes]     = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch]   = useState("");
  const [sortBy, setSortBy]   = useState("date");

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    listMixes()
      .then((data) => setMixes(data.mixes || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [visible]);

  const handleDelete = async (id) => {
    await deleteMixApi(id);
    setMixes((prev) => prev.filter((m) => m.id !== id));
  };

  const filtered = mixes
    .filter((m) => {
      if (!search) return true;
      const s = search.toLowerCase();
      return (
        m.meta?.dj?.toLowerCase().includes(s) ||
        m.meta?.event?.toLowerCase().includes(s) ||
        m.meta?.genre?.toLowerCase().includes(s) ||
        m.filename?.toLowerCase().includes(s)
      );
    })
    .sort((a, b) => {
      if (sortBy === "date") return new Date(b.createdAt) - new Date(a.createdAt);
      if (sortBy === "dj")   return (a.meta?.dj || "").localeCompare(b.meta?.dj || "");
      if (sortBy === "conf") return (b.avgConfidence || 0) - (a.avgConfidence || 0);
      return 0;
    });

  if (!visible) return null;

  return (
    <div className={styles.libraryPanel}>
      <div className={styles.libraryHeader}>
        <h2 className={styles.libraryTitle}>Mix library</h2>
        <span className={styles.libraryCount}>{mixes.length} saved</span>
      </div>

      <div className={styles.libraryControls}>
        <input
          className={styles.librarySearch}
          placeholder="Search by DJ, event, genre..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className={styles.librarySort}
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
        >
          <option value="date">Newest first</option>
          <option value="dj">By DJ</option>
          <option value="conf">By confidence</option>
        </select>
      </div>

      {loading && <div className={styles.libraryEmpty}>Loading...</div>}

      {!loading && filtered.length === 0 && (
        <div className={styles.libraryEmpty}>
          {mixes.length === 0
            ? "No mixes saved yet. Generate a tracklist and save it to your library."
            : "No mixes match your search."}
        </div>
      )}

      <div className={styles.mixList}>
        {filtered.map((mix) => (
          <MixCard key={mix.id} mix={mix} onOpen={onOpenMix} onDelete={handleDelete} />
        ))}
      </div>
    </div>
  );
}
