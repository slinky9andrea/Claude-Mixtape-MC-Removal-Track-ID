require("dotenv").config({ path: __dirname + "/.env" });
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const rateLimit = require("express-rate-limit");
const { readLibrary, saveMix, updateMix, deleteMix, getMix } = require("./library");
const { generateTracklistPDF } = require("./pdf");

const app = express();
const PORT = process.env.PORT || 3001;
const MAX_AUDIO_MB = parseInt(process.env.MAX_AUDIO_MB || "300");
const MAX_VIDEO_MB = parseInt(process.env.MAX_VIDEO_MB || "2048");
const MAX_DURATION_MINUTES = parseInt(process.env.MAX_DURATION_MINUTES || "90");
const CLIENT_SECRET = process.env.CLIENT_SECRET || null;

// ── Magic bytes ───────────────────────────────────────────────────────────────

const MAGIC_SIGNATURES = [
  { ext: "mp3",  offset: 0, bytes: [0x49, 0x44, 0x33] },
  { ext: "mp3",  offset: 0, bytes: [0xff, 0xfb] },
  { ext: "mp3",  offset: 0, bytes: [0xff, 0xf3] },
  { ext: "mp3",  offset: 0, bytes: [0xff, 0xf2] },
  { ext: "flac", offset: 0, bytes: [0x66, 0x4c, 0x61, 0x43] },
  { ext: "wav",  offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] },
  { ext: "m4a",  offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] },
  { ext: "aac",  offset: 0, bytes: [0xff, 0xf1] },
  { ext: "mp4",  offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] },
  { ext: "mov",  offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] },
  { ext: "mov",  offset: 4, bytes: [0x6d, 0x6f, 0x6f, 0x76] },
  { ext: "mkv",  offset: 0, bytes: [0x1a, 0x45, 0xdf, 0xa3] },
  { ext: "avi",  offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] },
  { ext: "webm", offset: 0, bytes: [0x1a, 0x45, 0xdf, 0xa3] },
];

function validateMagicBytes(filePath) {
  return new Promise((resolve) => {
    const stream = fs.createReadStream(filePath, { start: 0, end: 11 });
    const chunks = [];
    stream.on("data", (c) => chunks.push(c));
    stream.on("end", () => {
      const header = Buffer.concat(chunks);
      const valid = MAGIC_SIGNATURES.some((sig) => {
        const slice = header.slice(sig.offset, sig.offset + sig.bytes.length);
        return sig.bytes.every((b, i) => slice[i] === b);
      });
      resolve(valid);
    });
    stream.on("error", () => resolve(false));
  });
}

// ── FFmpeg / FFprobe helpers ──────────────────────────────────────────────────

function getAudioDurationMinutes(filePath) {
  return new Promise((resolve, reject) => {
    execFile(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration",
       "-of", "default=noprint_wrappers=1:nokey=1", filePath],
      { timeout: 30000 },
      (err, stdout) => {
        if (err) return reject(new Error("Could not read file duration"));
        const seconds = parseFloat(stdout.trim());
        if (isNaN(seconds)) return reject(new Error("Invalid duration returned"));
        resolve(seconds / 60);
      }
    );
  });
}

function extractAudioFromVideo(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    execFile(
      "ffmpeg",
      ["-i", inputPath, "-vn", "-acodec", "libmp3lame",
       "-ab", "192k", "-ar", "44100", "-y", outputPath],
      { timeout: 600000 },
      (err, stdout, stderr) => {
        if (err) {
          console.error("FFmpeg error:", stderr);
          reject(new Error("FFmpeg audio extraction failed: " + err.message));
        } else resolve(outputPath);
      }
    );
  });
}

/**
 * Serve a local file over HTTP so AudD can fetch it.
 * Returns a public URL pointing to /api/serve/:filename.
 * The file is deleted after AudD downloads it (or after 30 min).
 */
function localServeUrl(filename) {
  const host = process.env.PUBLIC_HOST || `http://localhost:${PORT}`;
  return `${host}/api/serve/${encodeURIComponent(filename)}`;
}

function isVideoFile(mimetype, originalname) {
  return mimetype.startsWith("video/") ||
    /\.(mp4|mov|mkv|avi|webm)$/i.test(originalname);
}

function cleanupFile(...paths) {
  for (const p of paths) if (p) fs.unlink(p, () => {});
}

// ── Stale file cleanup ────────────────────────────────────────────────────────

function cleanupStaleUploads() {
  const dirs = [
    path.join(__dirname, "uploads"),
    path.join(__dirname, "served"),
  ];
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    fs.readdir(dir, (err, files) => {
      if (err) return;
      for (const file of files) {
        const fp = path.join(dir, file);
        fs.stat(fp, (err, stat) => {
          if (!err && stat.mtimeMs < oneHourAgo) fs.unlink(fp, () => {});
        });
      }
    });
  }
}
setInterval(cleanupStaleUploads, 60 * 60 * 1000);

// ── Concurrency lock ──────────────────────────────────────────────────────────

let uploadInProgress = false;

// ── Middleware ────────────────────────────────────────────────────────────────

app.use(cors({ origin: ["http://localhost:5173", "http://localhost:3000"] }));
app.use(express.json({ limit: "1mb" }));

app.use("/api", (req, res, next) => {
  // Skip secret check on the serve route — AudD needs unauthenticated access
  if (req.path.startsWith("/serve/")) return next();
  if (!CLIENT_SECRET) return next();
  if (req.headers["x-client-secret"] !== CLIENT_SECRET)
    return res.status(401).json({ error: "Unauthorized" });
  next();
});

const uploadLimiter    = rateLimit({ windowMs: 60*60*1000, max: 5,  message: { error: "Too many uploads. Try again in an hour." } });
const pollLimiter      = rateLimit({ windowMs: 60*1000,    max: 30, message: { error: "Too many requests. Slow down." } });
const recognizeLimiter = rateLimit({ windowMs: 60*60*1000, max: 10, message: { error: "Too many recognition requests. Try again in an hour." } });

const upload = multer({
  dest: "uploads/",
  limits: { fileSize: MAX_VIDEO_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const isAudio = file.mimetype.startsWith("audio/");
    const isVideo = file.mimetype.startsWith("video/");
    const knownExt = /\.(mp3|mp4|mov|mkv|avi|webm|flac|wav|m4a|aac)$/i.test(file.originalname);
    if (isAudio || isVideo || knownExt) cb(null, true);
    else cb(new Error("Only audio or video files are accepted"));
  },
});

if (!fs.existsSync("uploads")) fs.mkdirSync("uploads");
if (!fs.existsSync("served"))  fs.mkdirSync("served");

// ── File serving route ────────────────────────────────────────────────────────
// AudD enterprise needs a public URL to fetch audio from.
// For local dev the server hosts the processed file itself.
// In production, replace this with S3/R2/Cloudflare and set PUBLIC_HOST.

app.get("/api/serve/:filename", (req, res) => {
  const filename = path.basename(req.params.filename); // strip any path traversal
  const filePath = path.join(__dirname, "served", filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "File not found or already cleaned up" });
  }

  res.setHeader("Content-Type", "audio/mpeg");
  res.setHeader("Content-Disposition", `inline; filename="${filename}"`);

  const stream = fs.createReadStream(filePath);
  stream.pipe(res);

  // Delete after AudD has fully downloaded it (stream ends)
  stream.on("end", () => {
    setTimeout(() => cleanupFile(filePath), 5000);
  });
});

// ── Health check ──────────────────────────────────────────────────────────────

app.get("/health", async (req, res) => {
  const ffmpegAvailable = await new Promise((resolve) => {
    execFile("ffmpeg", ["-version"], (err) => resolve(!err));
  });
  res.json({
    status: "ok",
    lalalConfigured: !!process.env.LALAL_API_KEY,
    auddConfigured: !!process.env.AUDD_API_TOKEN,
    ffmpegAvailable,
    uploadInProgress,
    maxAudioMb: MAX_AUDIO_MB,
    maxVideoMb: MAX_VIDEO_MB,
    maxDurationMinutes: MAX_DURATION_MINUTES,
  });
});

// ── NEW PIPELINE: Step 1 — Upload + prepare audio ────────────────────────────
//
// Accepts audio or video. Runs validation, extracts audio from video if needed,
// then copies the audio into the /served directory so AudD can fetch it directly.
// Returns { serveUrl, durationMinutes } — client passes serveUrl straight to AudD.
//
// LALAL.AI is no longer called first. We fingerprint the ORIGINAL audio with AudD,
// which gives it the best possible signal (vocals intact in songs).
// LALAL.AI is only used if the user wants to clean specific gap regions afterward.

app.post("/api/prepare", uploadLimiter, upload.single("audio"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file provided" });

  if (uploadInProgress) {
    cleanupFile(req.file.path);
    return res.status(429).json({ error: "Another file is already being processed. Please wait." });
  }

  uploadInProgress = true;
  let audioPath = req.file.path;
  let extractedAudio = false;

  try {
    // 1. Magic byte validation
    const validFile = await validateMagicBytes(req.file.path);
    if (!validFile) {
      return res.status(400).json({ error: "File contents don't match a supported audio or video format." });
    }

    // 2. Extract audio from video if needed
    if (isVideoFile(req.file.mimetype, req.file.originalname)) {
      console.log(`Video detected — extracting audio: ${req.file.originalname}`);
      const mp3Path = req.file.path + ".mp3";
      await extractAudioFromVideo(req.file.path, mp3Path);
      cleanupFile(req.file.path);
      audioPath = mp3Path;
      extractedAudio = true;
      console.log("Audio extracted successfully");
    } else {
      const audioMb = req.file.size / 1024 / 1024;
      if (audioMb > MAX_AUDIO_MB) {
        return res.status(413).json({ error: `Audio file too large. Max is ${MAX_AUDIO_MB} MB.` });
      }
    }

    // 3. Duration check
    const durationMinutes = await getAudioDurationMinutes(audioPath);
    console.log(`Duration: ${durationMinutes.toFixed(1)} minutes`);
    if (durationMinutes > MAX_DURATION_MINUTES) {
      return res.status(400).json({
        error: `File is ${Math.round(durationMinutes)} minutes long. Maximum allowed is ${MAX_DURATION_MINUTES} minutes.`,
      });
    }

    // 4. Move audio into served/ with a stable filename for chunking
    const serveFilename = `${req.file.filename}.mp3`;
    const servePath = path.join(__dirname, "served", serveFilename);
    fs.copyFileSync(audioPath, servePath);
    cleanupFile(audioPath);

    console.log(`File prepared for chunking: ${servePath}`);

    res.json({
      status: "ready",
      audioPath: servePath,          // absolute path — used by /api/audd/recognize-mix
      durationMinutes: Math.round(durationMinutes),
      filename: req.file.originalname,
    });
  } catch (err) {
    console.error("Prepare error:", err.message);
    res.status(500).json({ error: err.message });
  } finally {
    uploadInProgress = false;
    // Clean up original upload if still around
    if (!extractedAudio) cleanupFile(req.file?.path);
  }
});

// ── AudD fingerprinting via FFmpeg chunking ──────────────────────────────────
//
// The AudD Indie plan ($5/mo) uses the standard api.audd.io endpoint.
// This does NOT support URL-based full-file recognition — each request
// must upload a single audio clip (max ~20s for reliable ID).
//
// Strategy:
//   1. FFmpeg slices the audio into CHUNK_SECONDS segments
//   2. Each chunk is uploaded as a file POST to api.audd.io
//   3. Results are deduplicated and sorted by timestamp
//   4. Chunk files are cleaned up after processing
//
// This runs entirely server-side — no public URL or ngrok needed for AudD.

const CHUNK_SECONDS = 12; // 12s is AudD's recommended clip length

function secToTimecode(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h > 0
    ? `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`
    : `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}

function sliceAudioChunk(inputPath, startSec, outputPath) {
  return new Promise((resolve, reject) => {
    execFile(
      "ffmpeg",
      ["-ss", String(startSec), "-i", inputPath,
       "-t", String(CHUNK_SECONDS), "-acodec", "libmp3lame",
       "-ab", "128k", "-y", outputPath],
      { timeout: 30000 },
      (err) => err ? reject(err) : resolve(outputPath)
    );
  });
}

async function recognizeChunk(apiToken, chunkPath, startSec) {
  const form = new FormData();
  form.append("api_token", apiToken);
  form.append("file", fs.createReadStream(chunkPath), {
    filename: path.basename(chunkPath),
    contentType: "audio/mpeg",
    knownLength: fs.statSync(chunkPath).size,
  });
  form.append("return", "timecode,song_link,musicbrainz,spotify");

  try {
    const res = await axios.post("https://api.audd.io/", form, {
      headers: form.getHeaders(),
      timeout: 15000,
    });
    const result = res.data?.result;
    if (!result) return null;
    // Standard AudD endpoint returns score as a top-level field on the result.
    // Normalize to match the shape the rest of the pipeline expects.
    return {
      artist:      result.artist,
      title:       result.title,
      album:       result.album,
      label:       result.label,
      release_date: result.release_date,
      song_link:   result.song_link,
      score:       result.score ?? 100, // standard endpoint doesn't always return score; default 100 if matched
      timecode:    result.timecode,
      musicbrainz: result.musicbrainz || null,
      spotify:     result.spotify || null,
      offset:      secToTimecode(startSec),
      offsetSec:   startSec,
    };
  } catch {
    return null; // skip failed chunks, don't abort whole scan
  }
}

// POST /api/audd/recognize-mix
// Body: { audioPath, intervalSeconds }
// audioPath — absolute path to audio file on server disk (set by /api/prepare)
// intervalSeconds — scan every N seconds (default 30)

app.post("/api/audd/recognize-mix", recognizeLimiter, async (req, res) => {
  const apiToken = process.env.AUDD_API_TOKEN;
  if (!apiToken) return res.status(500).json({ error: "AUDD_API_TOKEN not configured" });

  const { audioPath, intervalSeconds = 30 } = req.body;
  if (!audioPath) return res.status(400).json({ error: "audioPath is required" });

  // Security: only allow paths within the served/ directory
  const servedDir = path.resolve(__dirname, "served");
  const resolvedPath = path.resolve(audioPath);
  if (!resolvedPath.startsWith(servedDir)) {
    return res.status(400).json({ error: "Invalid audio path" });
  }
  if (!fs.existsSync(resolvedPath)) {
    return res.status(404).json({ error: "Audio file not found — it may have been cleaned up. Re-upload." });
  }

  const safeInterval = Math.min(Math.max(parseInt(intervalSeconds) || 30, 10), 120);
  const chunksDir = path.join(__dirname, "chunks");
  if (!fs.existsSync(chunksDir)) fs.mkdirSync(chunksDir);

  try {
    // Get duration
    const durationMinutes = await getAudioDurationMinutes(resolvedPath);
    const durationSec = Math.round(durationMinutes * 60);
    const offsets = [];
    for (let s = 0; s < durationSec; s += safeInterval) offsets.push(s);

    console.log(`AudD chunking: ${offsets.length} chunks at ${safeInterval}s intervals over ${Math.round(durationSec/60)} min`);

    const seen = new Map();
    let processed = 0;

    for (const startSec of offsets) {
      const chunkFile = path.join(chunksDir, `chunk_${Date.now()}_${startSec}.mp3`);
      try {
        await sliceAudioChunk(resolvedPath, startSec, chunkFile);
        const hit = await recognizeChunk(apiToken, chunkFile, startSec);
        if (hit?.artist && hit?.title) {
          const key = `${hit.artist}|${hit.title}`;
          if (!seen.has(key) || (hit.score || 0) > (seen.get(key).score || 0)) {
            seen.set(key, hit);
          }
          console.log(`  ${secToTimecode(startSec)} → ${hit.artist} - ${hit.title} (${hit.score ?? "?"}%)`);
        } else {
          console.log(`  ${secToTimecode(startSec)} → no match`);
        }
      } finally {
        cleanupFile(chunkFile);
      }
      processed++;
      // Brief pause every 10 chunks to avoid overwhelming AudD
      if (processed % 10 === 0) await new Promise(r => setTimeout(r, 500));
    }

    const toSec = (t) => {
      const parts = (t || "0:00").split(":").map(Number);
      return parts.length === 3 ? parts[0]*3600+parts[1]*60+parts[2] : parts[0]*60+parts[1];
    };

    const tracks = Array.from(seen.values())
      .sort((a, b) => toSec(a.offset) - toSec(b.offset));

    console.log(`AudD complete: ${tracks.length} unique tracks from ${offsets.length} chunks`);
    res.json({ status: "success", total: tracks.length, tracks });
  } catch (err) {
    console.error("AudD chunking error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── OPTIONAL: LALAL.AI vocal strip on demand ──────────────────────────────────
//
// Now used as an optional post-processing step, not the first step.
// Upload a specific gap segment (already sliced by FFmpeg client-side or here)
// to clean MC speech from a region between identified tracks.

app.post("/api/lalal/upload", uploadLimiter, upload.single("audio"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file provided" });

  const apiKey = process.env.LALAL_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "LALAL_API_KEY not configured on server" });

  if (uploadInProgress) {
    cleanupFile(req.file.path);
    return res.status(429).json({ error: "Another file is already being processed. Please wait." });
  }

  uploadInProgress = true;
  let audioPath = req.file.path;
  let audioName = req.file.originalname || "segment.mp3";
  let extractedAudio = false;

  try {
    const validFile = await validateMagicBytes(req.file.path);
    if (!validFile) {
      return res.status(400).json({ error: "File contents don't match a supported audio or video format." });
    }

    if (isVideoFile(req.file.mimetype, req.file.originalname)) {
      const mp3Path = req.file.path + ".mp3";
      await extractAudioFromVideo(req.file.path, mp3Path);
      cleanupFile(req.file.path);
      audioPath = mp3Path;
      audioName = req.file.originalname.replace(/\.[^.]+$/, ".mp3");
      extractedAudio = true;
    }

    const durationMinutes = await getAudioDurationMinutes(audioPath);
    if (durationMinutes > MAX_DURATION_MINUTES) {
      return res.status(400).json({
        error: `File is ${Math.round(durationMinutes)} min long. Max is ${MAX_DURATION_MINUTES} min.`,
      });
    }

    const fileStream = fs.createReadStream(audioPath);
    const form = new FormData();
    form.append("file", fileStream, {
      filename: audioName,
      contentType: "audio/mpeg",
      knownLength: fs.statSync(audioPath).size,
    });

    const uploadRes = await axios.post("https://www.lalal.ai/api/upload/", form, {
      headers: {
        ...form.getHeaders(),
        Authorization: `license ${apiKey}`,
        "Content-Disposition": `attachment; filename="${audioName}"`,
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });

    console.log("LALAL.AI upload response:", JSON.stringify(uploadRes.data, null, 2));
    const fileId = uploadRes.data?.id;
    if (!fileId) throw new Error("No file ID returned from LALAL.AI");

    await axios.post(
      "https://www.lalal.ai/api/preview/",
      { id: fileId, stem: "vocals", splitter: "orion" },
      { headers: { Authorization: `license ${apiKey}`, "Content-Type": "application/json" } }
    );

    res.json({ fileId, status: "processing", durationMinutes: Math.round(durationMinutes) });
  } catch (err) {
    console.error("LALAL upload error:", err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data?.error || err.message });
  } finally {
    uploadInProgress = false;
    cleanupFile(req.file?.path);
    if (extractedAudio) cleanupFile(audioPath);
  }
});

app.get("/api/lalal/status/:fileId", pollLimiter, async (req, res) => {
  if (!/^[a-f0-9-]{8,64}$/i.test(req.params.fileId)) {
    return res.status(400).json({ error: "Invalid file ID format" });
  }

  const apiKey = process.env.LALAL_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "LALAL_API_KEY not configured" });

  try {
    const response = await axios.get(
      `https://www.lalal.ai/api/check/?id=${req.params.fileId}`,
      { headers: { Authorization: `license ${apiKey}` } }
    );

    const task = response.data?.task;
    if (!task) return res.json({ status: "unknown" });

    if (task.status === "success") {
      console.log("LALAL.AI success:", JSON.stringify(task, null, 2));
      return res.json({
        status: "done",
        instrumentalUrl: task.stem_track,
        vocalsUrl: task.stem_other,
        durationSeconds: task.audio_duration,
      });
    }

    if (task.status === "error") {
      return res.json({ status: "error", message: task.error || "Unknown LALAL.AI error" });
    }

    res.json({ status: task.status, progress: task.progress || 0 });
  } catch (err) {
    console.error("LALAL status error:", err.response?.data || err.message);
    res.status(500).json({ error: err.message });
  }
});


// ── MixesDB import ────────────────────────────────────────────────────────────

const importLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many import requests. Slow down.' },
});

app.post('/api/mixesdb/import', importLimiter, async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url is required' });
  let parsed;
  try { parsed = new URL(url); } catch { return res.status(400).json({ error: 'Invalid URL' }); }
  if (!parsed.hostname.includes('mixesdb.com')) return res.status(400).json({ error: 'Only mixesdb.com URLs are supported' });
  try {
    console.log('Fetching MixesDB:', url);
    const response = await axios.get(url, {
      headers: { 'User-Agent': 'MixtapeTracklistGenerator/1.0', 'Accept': 'text/html' },
      timeout: 10000,
    });
    const html = response.data;
    const titleMatch = html.match(/<title>([^<]+)<\/title>/);
    const pageTitle = titleMatch ? titleMatch[1].replace(' | DJ sets tracklists on MixesDB', '').trim() : '';
    let dj = '', event = '', dateRecorded = '';
    const tp = pageTitle.match(/^(\d{4}-\d{2}-\d{2})\s*-\s*(.+?)\s*@\s*(.+)$/);
    if (tp) { dateRecorded = tp[1]; dj = tp[2].trim(); event = tp[3].trim(); } else { event = pageTitle; }
    const gm = html.match(/Category:(Jungle|Drum[^"<]*Bass|Hardcore|Breakbeat|UK Garage|House|Techno|Trance)/i);
    const genre = gm ? gm[1].trim() : '';
    const tlMatch = html.match(/<h2[^>]*>\s*(?:<[^>]+>\s*)*Tracklist\s*(?:<\/[^>]+>\s*)*<\/h2>([\s\S]*?)(?:<h2|<div class="printfooter")/i);
    const tracks = [];
    if (tlMatch) {
      const liMatches = [...tlMatch[1].matchAll(/<li[^>]*>(.*?)<\/li>/gis)];
      for (const m of liMatches) {
        const raw = m[1].replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/&ndash;/g,'-').trim();
        if (!raw) continue;
        const lm = raw.match(/\[([^\]]+)\]\s*$/);
        const label = lm ? lm[1].trim() : '';
        const wl = raw.replace(/\[[^\]]+\]\s*$/,'').trim();
        const di = wl.indexOf(' - ');
        const artist = di !== -1 ? wl.slice(0, di).trim() : '';
        const title  = di !== -1 ? wl.slice(di + 3).trim() : wl;
        const isUnreleased = /unreleased|dubplate|dub plate/i.test(raw);
        tracks.push({ artist, title, label, score: 0, confirmed: false, unidentified: false, source: 'mixesdb', isUnreleased, offset: '' });
      }
    }
    if (tracks.length === 0) return res.status(404).json({ error: 'No tracklist found on this page.' });
    console.log('MixesDB: imported', tracks.length, 'tracks from', pageTitle);
    res.json({ tracks, meta: { dj, event, dateRecorded, genre, source: url }, pageTitle });
  } catch (err) {
    console.error('MixesDB import error:', err.message);
    if (err.response?.status === 404) return res.status(404).json({ error: 'MixesDB page not found.' });
    res.status(500).json({ error: 'Failed to fetch MixesDB page: ' + err.message });
  }
});

// ── Error handler ─────────────────────────────────────────────────────────────

app.use((err, req, res, next) => {
  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({
      error: `File too large. Max ${MAX_AUDIO_MB} MB for audio, ${MAX_VIDEO_MB} MB for video.`,
    });
  }
  console.error("Unhandled error:", err.message);
  res.status(500).json({ error: err.message });
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n🎧 Mixtape server running on http://localhost:${PORT}`);
  console.log(`   LALAL.AI:      ${process.env.LALAL_API_KEY ? "✓ configured" : "✗ missing LALAL_API_KEY"}`);
  console.log(`   AudD:          ${process.env.AUDD_API_TOKEN ? "✓ configured" : "✗ missing AUDD_API_TOKEN"}`);
  console.log(`   Client secret: ${CLIENT_SECRET ? "✓ enabled" : "— disabled (set CLIENT_SECRET in .env to enable)"}`);
  console.log(`   Max audio:     ${MAX_AUDIO_MB} MB`);
  console.log(`   Max video:     ${MAX_VIDEO_MB} MB`);
  console.log(`   Max duration:  ${MAX_DURATION_MINUTES} min`);
  console.log(`   Pipeline:      FFmpeg chunking → api.audd.io (Indie plan)\n`);
});
