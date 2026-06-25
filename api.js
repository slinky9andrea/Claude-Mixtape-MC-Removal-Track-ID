const BASE = "/api";

/**
 * Upload a mixtape MP3 to LALAL.AI for vocal separation.
 * Returns { fileId } to poll for completion.
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
 * Calls onProgress({ status, progress }) during processing.
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
      } catch (err) {
        reject(err);
      }
    };
    check();
  });
}

/**
 * Send a DJ mix URL to AudD's enterprise endpoint.
 * Returns a de-duplicated, timestamp-sorted array of tracks.
 *
 * skip/every control the scan density vs cost tradeoff:
 *   skip=4, every=1 → scan 12s, skip 48s → ~1 req/min of audio
 *   skip=1, every=1 → scan 12s, skip 12s → ~2.5 req/min (more accurate, costs more)
 */
export async function recognizeMix(url, { skip = 4, every = 1 } = {}) {
  const res = await fetch(`${BASE}/audd/recognize-mix`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, skip, every }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "AudD recognition failed");
  return data;
}

/**
 * Check server health — verifies API keys are configured.
 */
export async function checkHealth() {
  const res = await fetch(`${BASE.replace("/api", "")}/health`);
  return res.json();
}
