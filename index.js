require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3001;
const MAX_MB = parseInt(process.env.MAX_UPLOAD_MB || "500");

// ── Middleware ────────────────────────────────────────────────────────────────

app.use(cors({ origin: ["http://localhost:5173", "http://localhost:3000"] }));
app.use(express.json());

const upload = multer({
  dest: "uploads/",
  limits: { fileSize: MAX_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("audio/") || file.originalname.endsWith(".mp3")) {
      cb(null, true);
    } else {
      cb(new Error("Only audio files are accepted"));
    }
  },
});

// Ensure uploads dir exists
if (!fs.existsSync("uploads")) fs.mkdirSync("uploads");

// ── Health check ──────────────────────────────────────────────────────────────

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    lalalConfigured: !!process.env.LALAL_API_KEY,
    auddConfigured: !!process.env.AUDD_API_TOKEN,
  });
});

// ── LALAL.AI routes ───────────────────────────────────────────────────────────

/**
 * POST /api/lalal/upload
 * Uploads an MP3 to LALAL.AI and kicks off vocal separation.
 * Returns { fileId, status } — poll /api/lalal/status/:fileId for completion.
 *
 * LALAL.AI API docs: https://www.lalal.ai/api/
 * Stem options: vocals, drums, bass, piano, electric_guitar, acoustic_guitar,
 *               synthesizer, strings, wind, drums
 */
app.post("/api/lalal/upload", upload.single("audio"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No audio file provided" });

  const apiKey = process.env.LALAL_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "LALAL_API_KEY not configured on server" });

  try {
    const fileStream = fs.createReadStream(req.file.path);
    const form = new FormData();
    form.append("file", fileStream, {
      filename: req.file.originalname || "mixtape.mp3",
      contentType: req.file.mimetype || "audio/mpeg",
    });

    // Step 1: Upload file to LALAL.AI
    const uploadRes = await axios.post("https://www.lalal.ai/api/upload/", form, {
      headers: {
        ...form.getHeaders(),
        Authorization: `license ${apiKey}`,
      },
      maxBodyLength: Infinity,
    });

    const fileId = uploadRes.data?.id;
    if (!fileId) throw new Error("No file ID returned from LALAL.AI");

    // Step 2: Start processing — extract vocals stem to isolate instrumental
    // stem=vocals means LALAL returns both the isolated vocal track and the
    // "no-vocals" instrumental, which is what we feed to AudD.
    await axios.post(
      "https://www.lalal.ai/api/preview/",
      { id: fileId, stem: "vocals", splitter: "orion" },
      { headers: { Authorization: `license ${apiKey}`, "Content-Type": "application/json" } }
    );

    res.json({ fileId, status: "processing", message: "Vocal separation started" });
  } catch (err) {
    console.error("LALAL upload error:", err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data?.error || err.message });
  } finally {
    // Clean up temp file
    if (req.file?.path) fs.unlink(req.file.path, () => {});
  }
});

/**
 * GET /api/lalal/status/:fileId
 * Polls LALAL.AI for processing status.
 * Returns { status, instrumentalUrl } when done.
 */
app.get("/api/lalal/status/:fileId", async (req, res) => {
  const apiKey = process.env.LALAL_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "LALAL_API_KEY not configured" });

  try {
    const response = await axios.get(
      `https://www.lalal.ai/api/check/?id=${req.params.fileId}`,
      { headers: { Authorization: `license ${apiKey}` } }
    );

    const data = response.data;
    const task = data?.task;

    if (!task) return res.json({ status: "unknown" });

    // task.status: "queued" | "processing" | "success" | "error"
    if (task.status === "success") {
      return res.json({
        status: "done",
        // stem_track = instrumental (no vocals), stem_other = isolated vocals
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

// ── AudD routes ───────────────────────────────────────────────────────────────

/**
 * POST /api/audd/recognize
 * Sends a public URL or base64 audio to AudD for song identification.
 * Body: { url, returnFields }
 * returnFields defaults to: timecode,song_link,musicbrainz,spotify
 *
 * AudD docs: https://docs.audd.io/
 */
app.post("/api/audd/recognize", async (req, res) => {
  const apiToken = process.env.AUDD_API_TOKEN;
  if (!apiToken) return res.status(500).json({ error: "AUDD_API_TOKEN not configured" });

  const { url, returnFields = "timecode,song_link,musicbrainz,spotify" } = req.body;
  if (!url) return res.status(400).json({ error: "url is required" });

  try {
    const form = new FormData();
    form.append("api_token", apiToken);
    form.append("url", url);
    form.append("return", returnFields);

    const response = await axios.post("https://api.audd.io/", form, {
      headers: form.getHeaders(),
    });

    res.json(response.data);
  } catch (err) {
    console.error("AudD recognize error:", err.response?.data || err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/audd/recognize-mix
 * Sends a full-length DJ mix URL to AudD's enterprise endpoint.
 * AudD scans the entire file and returns every song with timestamps.
 *
 * Body: { url, skip, every }
 *   skip  — seconds to skip between scan windows (default 4 = skip 48s between 12s scans)
 *   every — scan every N windows (default 1)
 *
 * Cost formula: requests = file_duration_seconds / (12 * (skip + every))
 * Example: 60min mix, skip=4, every=1 → 60 requests at $2-5/1000 ≈ $0.01
 *
 * AudD enterprise docs: https://docs.audd.io/enterprise/
 */
app.post("/api/audd/recognize-mix", async (req, res) => {
  const apiToken = process.env.AUDD_API_TOKEN;
  if (!apiToken) return res.status(500).json({ error: "AUDD_API_TOKEN not configured" });

  const { url, skip = 4, every = 1 } = req.body;
  if (!url) return res.status(400).json({ error: "url is required" });

  try {
    const form = new FormData();
    form.append("api_token", apiToken);
    form.append("url", url);
    form.append("skip", String(skip));
    form.append("every", String(every));
    form.append("accurate_offsets", "true");
    form.append("return", "timecode,song_link,musicbrainz,spotify");

    // Enterprise endpoint — handles files of any length, returns all tracks + timestamps
    const response = await axios.post("https://enterprise.audd.io/", form, {
      headers: form.getHeaders(),
      timeout: 300000, // 5 min timeout for long mixes
    });

    // De-duplicate tracks — AudD may return the same song from overlapping windows
    const raw = response.data?.result || [];
    const seen = new Map();

    for (const chunk of raw) {
      for (const song of chunk.songs || []) {
        const key = `${song.artist}|${song.title}`;
        if (!seen.has(key) || (song.score > seen.get(key).score)) {
          seen.set(key, { ...song, offset: chunk.offset });
        }
      }
    }

    const tracks = Array.from(seen.values()).sort((a, b) => {
      // Sort by timestamp offset
      const toSec = (t) => {
        const parts = t.split(":").map(Number);
        return parts.length === 3
          ? parts[0] * 3600 + parts[1] * 60 + parts[2]
          : parts[0] * 60 + parts[1];
      };
      return toSec(a.offset) - toSec(b.offset);
    });

    res.json({ status: "success", total: tracks.length, tracks });
  } catch (err) {
    console.error("AudD enterprise error:", err.response?.data || err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Error handler ─────────────────────────────────────────────────────────────

app.use((err, req, res, next) => {
  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: `File too large. Max size is ${MAX_MB}MB.` });
  }
  res.status(500).json({ error: err.message });
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n🎧 Mixtape server running on http://localhost:${PORT}`);
  console.log(`   LALAL.AI: ${process.env.LALAL_API_KEY ? "✓ configured" : "✗ missing LALAL_API_KEY"}`);
  console.log(`   AudD:     ${process.env.AUDD_API_TOKEN ? "✓ configured" : "✗ missing AUDD_API_TOKEN"}\n`);
});
