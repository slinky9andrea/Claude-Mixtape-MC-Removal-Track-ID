const BASE = "/api";

/**
 * Step 1 — Upload and prepare the file for fingerprinting.
 * Server validates, extracts audio from video if needed, and serves
 * the original audio locally so AudD can fetch it directly.
 * Returns { serveUrl, durationMinutes, filename }.
 */
export async function prepareFile(file, onProgress) {
  const form = new FormData();
  form.append("audio", file);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${BASE}/prepare`);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 400) reject(new Error(data.error || "Upload failed"));
        else resolve(data);
      } catch {
        reject(new Error("Invalid server response"));
      }
    };

    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.send(form);
  });
}

/**
 * Step 2 — Fingerprint audio with AudD using FFmpeg chunking.
 * Server slices the audio into intervalSeconds chunks and uploads
 * each one directly to api.audd.io — no public URL needed.
 * Returns de-duplicated, timestamp-sorted tracks with confidence scores.
 *
 * intervalSeconds controls scan density vs cost:
 *   30s → 1 request per 30s of audio (recommended, ~120 req/hr mix)
 *   10s → 1 request per 10s (more accurate, 3x more requests)
 */
export async function recognizeMix(audioPath, { intervalSeconds = 30 } = {}) {
  const res = await fetch(`${BASE}/audd/recognize-mix`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ audioPath, intervalSeconds }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "AudD recognition failed");
  return data;
}

/**
 * Optional Step 3 — Upload a specific segment to LALAL.AI to strip MC vocals.
 * Only needed if the user wants to clean a specific gap region.
 * Returns { fileId } to poll with pollLalalStatus.
 */
export async function uploadToLalal(file, onProgress) {
  const form = new FormData();
  form.append("audio", file);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${BASE}/lalal/upload`);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 400) reject(new Error(data.error || "Upload failed"));
        else resolve(data);
      } catch {
        reject(new Error("Invalid server response"));
      }
    };

    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.send(form);
  });
}

/**
 * Poll LALAL.AI until vocal separation completes.
 * Resolves with { instrumentalUrl, vocalsUrl, durationSeconds }.
 */
export async function pollLalalStatus(fileId, onProgress, intervalMs = 3000) {
  return new Promise((resolve, reject) => {
    const check = async () => {
      try {
        const res = await fetch(`${BASE}/lalal/status/${fileId}`);
        const data = await res.json();
        if (data.status === "done") return resolve(data);
        if (data.status === "error") return reject(new Error(data.message || "LALAL.AI processing failed"));
        onProgress?.({ status: data.status, progress: data.progress || 0 });
        setTimeout(check, intervalMs);
      } catch (err) { reject(err); }
    };
    check();
  });
}

/**
 * Check server health.
 */
export async function checkHealth() {
  const res = await fetch(`/health`);
  return res.json();
}

/**
 * Returns true if the file is a video format.
 */
export function isVideoFile(file) {
  return file.type.startsWith("video/") || /\.(mp4|mov|mkv|avi|webm)$/i.test(file.name);
}

// ── MusicBrainz enrichment ────────────────────────────────────────────────────

/**
 * Enrich a list of tracks with release year, label, catalog from MusicBrainz.
 * Server queues requests at 1/sec to respect MusicBrainz rate limits.
 */
export async function enrichTracks(tracks) {
  const res = await fetch(`${BASE}/musicbrainz/enrich`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tracks }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Enrichment failed");
  return data.tracks;
}

// ── Library API ───────────────────────────────────────────────────────────────

export async function listMixes() {
  const res = await fetch(`${BASE}/library`);
  return res.json();
}

export async function saveMixToLibrary(payload) {
  const res = await fetch(`${BASE}/library`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Save failed");
  return data;
}

export async function updateMixInLibrary(id, updates) {
  const res = await fetch(`${BASE}/library/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Update failed");
  return data;
}

export async function deleteMixApi(id) {
  const res = await fetch(`${BASE}/library/${id}`, { method: "DELETE" });
  return res.json();
}
