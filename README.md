# Mixtape MC Removal & Track ID

> **Finding: Audio fingerprinting is not viable for pre-digital underground music archives.**
>
> AudD and MusicBrainz identified only a small fraction of tracks in the mixes tested. Most 1992–1999 jungle, hardcore techno, and drum & bass recordings were released on small UK vinyl labels with no digital distribution — they were never catalogued in any fingerprinting database. Some tracks were misidentified. For this specific use case, community archives like [MixesDB](https://www.mixesdb.com) are the only reliable source.
>
> The app itself functions correctly and may be useful for mixes containing commercially distributed tracks from the late 1990s onward. If you are interested in how it was constructed, see below. This ecosystem was designed using Gemini and Claude, and vibe-coded with Claude.

---

Identify every song in a DJ mix. Upload audio or video, tag the mix, review the tracklist, and save it to a persistent library. Exports to PDF and CSV.

## How it works

The pipeline adapts based on whether there is an MC and how active they are:

### No MC
```
Upload → AudD fingerprint (original) → MusicBrainz enrich → review → save
```

### MC between tracks
```
Upload → AudD fingerprint (original) → MusicBrainz enrich → review → save
```
Songs are identified from the unmodified audio for maximum fingerprint accuracy. LALAL.AI is available on demand to clean gap regions after the tracklist is generated.

### MC throughout (e.g. Andy C / MC Dynamite style)
```
Upload → AudD fingerprint (original) → LALAL.AI full vocal strip → AudD fingerprint (instrumental) → merge results → MusicBrainz enrich → review → save
```
Two-pass strategy: AudD runs on both the original and the LALAL.AI instrumental. Results are merged, keeping the highest-confidence hit per track. This catches songs where the MC was louder than the music in the original.

## Features

- **Audio and video input** — MP3, FLAC, WAV, M4A, AAC, MP4, MOV, MKV, AVI, WebM. Audio is extracted from video automatically via FFmpeg.
- **Three MC pipelines** — no MC, MC between tracks, or MC throughout. The right processing path is chosen based on your selection.
- **AudD enterprise fingerprinting** — scans the full mix and returns every song with timestamps, confidence scores, ISRC codes, and Spotify/MusicBrainz links.
- **MusicBrainz enrichment** — automatically adds release year, label, and catalog number to every identified track after fingerprinting.
- **Inline track editing** — click any track to edit artist, title, or album. Low-confidence tracks (under 75%) are highlighted amber and flagged for review.
- **Track review workflow** — confirm correct tracks with a tick, mark unrecognized tracks as unidentified. Confirmed tracks are visually distinguished in exports.
- **Mix tagging** — tag each mix with DJ name, event name, date recorded, genre/style, and notes before saving.
- **Persistent mix library** — saved to disk on the server, survives restarts. Browse, search, and sort all saved mixes.
- **PDF export** — formatted tracklist with mix metadata header, stats, track-by-track detail including ISRC and catalog numbers, confidence indicators, and footer.
- **CSV export** — full tracklist with all enriched metadata fields, confirmation status, and confidence scores.

## Supported formats

| Type | Formats | Max size |
|---|---|---|
| Audio | MP3, FLAC, WAV, M4A, AAC | 300 MB |
| Video | MP4, MOV, MKV, AVI, WebM | 2 GB |

Maximum audio duration: **90 minutes** (configurable via `MAX_DURATION_MINUTES` in `.env`).

## Prerequisites

- Node.js 18+
- FFmpeg — for audio extraction from video and duration checking
- ngrok — to expose the local server so AudD can fetch audio files (free account at ngrok.com)
- A [LALAL.AI](https://www.lalal.ai/api/) API key (requires Pro plan, ~$15/month — only needed for MC stripping)
- An [AudD](https://dashboard.audd.io/) API token (300 free requests on signup, no credit card)

## Setup

```bash
# 1. Install FFmpeg
brew install ffmpeg        # macOS
sudo apt install ffmpeg    # Ubuntu/Debian

# 2. Install ngrok and authenticate
brew install ngrok
ngrok config add-authtoken YOUR_NGROK_TOKEN   # from dashboard.ngrok.com/get-started/your-authtoken

# 3. Clone and install all dependencies
git clone https://github.com/YOUR_USERNAME/Claude-Mixtape-MC-Removal-Track-ID.git
cd Claude-Mixtape-MC-Removal-Track-ID
npm run install:all

# 4. Configure API keys
cp server/.env.example server/.env
# Edit server/.env — add your LALAL_API_KEY, AUDD_API_TOKEN, and PUBLIC_HOST

# 5. Start ngrok in a terminal tab
ngrok http 3001
# Copy the https://xxxx.ngrok-free.app URL into PUBLIC_HOST in server/.env

# 6. Start the app in another terminal tab
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

You will need three terminal tabs running simultaneously:
- **Tab 1** — `npm run dev` (server + client)
- **Tab 2** — `ngrok http 3001`
- **Tab 3** — spare for commands

## Configuration

All settings live in `server/.env`. Copy `server/.env.example` to get started.

```env
# Required
LALAL_API_KEY=your_lalal_api_key_here      # from lalal.ai profile page (activation key)
AUDD_API_TOKEN=your_audd_api_token_here    # from dashboard.audd.io

# Required for AudD to fetch audio files — set to your ngrok URL each session
# In production, set to your deployed server's public URL instead
PUBLIC_HOST=https://xxxx.ngrok-free.app

# Optional — override defaults
PORT=3001
MAX_AUDIO_MB=300
MAX_VIDEO_MB=2048
MAX_DURATION_MINUTES=90

# Optional — shared secret to lock down /api/* routes (recommended if exposed beyond localhost)
# CLIENT_SECRET=your_random_secret_here
```

API keys are only used server-side and never exposed to the browser.

**Note on ngrok:** The free plan generates a new URL every time you restart ngrok. Update `PUBLIC_HOST` in `.env` and restart the dev server each session. The URL stays the same while ngrok is running.

## Cost estimates

| Service | Free tier | Paid |
|---|---|---|
| LALAL.AI | 10 min | Pro: $15/mo (250 min + API access) |
| AudD | 300 requests | $2–5 per 1,000 requests |
| ngrok | Free (URL changes per session) | $10/mo for stable URLs |
| MusicBrainz | Free, no key needed | — |

A 60-minute mixtape with 30s scan interval uses ~120 AudD requests ≈ $0.24–$0.60.
LALAL.AI bills by audio duration — a 60-minute file costs 60 minutes from your plan balance.
The two-pass (MC throughout) pipeline uses LALAL.AI minutes for the full mix plus double AudD requests.

## Security guardrails

The server implements multiple layers of protection against malicious use and resource abuse.

### Rate limiting
- **Uploads**: max 5 per IP per hour — prevents API credit drain from automated abuse
- **Status polling**: max 30 per IP per minute — prevents polling floods
- **AudD recognition**: max 10 per IP per hour — protects AudD credit balance

### File validation
- **Magic byte checking**: reads the actual binary file header to confirm the file is genuinely audio or video. A renamed `.exe` or other malicious file will be rejected even if the extension and MIME type look correct.
- **Duration cap**: FFprobe measures the real audio duration before uploading to LALAL.AI. Files over `MAX_DURATION_MINUTES` (default 90 min) are rejected — prevents surprise LALAL.AI billing on multi-hour files.
- **Size caps**: enforced both client-side (instant feedback before upload) and server-side via multer (300 MB audio, 2 GB video).
- **Extension allowlist**: only `.mp3`, `.flac`, `.wav`, `.m4a`, `.aac`, `.mp4`, `.mov`, `.mkv`, `.avi`, `.webm` are accepted.

### SSRF protection
The AudD `url` parameter is validated before being forwarded:
- Must be a valid HTTPS URL (HTTP rejected) — localhost is allowed for the local serve route only
- Internal network addresses are blocked: `10.x`, `192.168.x`, `172.16–31.x`, `169.254.x`
- Prevents an attacker from using the server to probe your internal network

### Input sanitization
- LALAL.AI `fileId` validated against a strict hex format before use in API calls
- AudD `skip` and `every` parameters clamped to sane ranges (skip: 0–20, every: 1–5)
- JSON request body capped at 1 MB

### Concurrency lock
Only one LALAL.AI upload can be processed at a time. A second upload attempt while one is in progress returns a `429` with a clear error message.

### Stale file cleanup
A background job runs every hour and deletes any temp files in `uploads/` and `served/` older than 1 hour. Prevents disk buildup from failed or interrupted uploads.

### Optional client secret
Set `CLIENT_SECRET` in `.env` to require all `/api/*` requests to include the header `X-Client-Secret: <value>`. Recommended if you ever expose the server beyond localhost. The `/api/serve/` route is exempt so AudD can fetch audio files without auth.

## API routes

| Method | Endpoint | Rate limit | Description |
|---|---|---|---|
| `GET` | `/health` | none | Server status, API key config, FFmpeg availability |
| `POST` | `/api/prepare` | 5/hr per IP | Upload audio/video, validate, extract audio from video, serve locally |
| `GET` | `/api/serve/:filename` | none | Serve prepared audio file to AudD (auto-deleted after download) |
| `POST` | `/api/audd/recognize-mix` | 10/hr per IP | Fingerprint full mix, get all tracks with timestamps |
| `POST` | `/api/musicbrainz/enrich` | none | Enrich track list with MusicBrainz release metadata |
| `POST` | `/api/lalal/upload` | 5/hr per IP | Upload audio/video to LALAL.AI for vocal separation |
| `GET` | `/api/lalal/status/:fileId` | 30/min per IP | Poll LALAL.AI separation status |
| `GET` | `/api/library` | none | List all saved mixes |
| `GET` | `/api/library/:id` | none | Get single mix with full track list |
| `POST` | `/api/library` | none | Save a new mix to the library |
| `PATCH` | `/api/library/:id` | none | Update mix metadata or tracks |
| `DELETE` | `/api/library/:id` | none | Delete a mix |
| `GET` | `/api/library/:id/pdf` | none | Generate and stream a formatted PDF tracklist |
| `GET` | `/api/library/:id/csv` | none | Generate and stream a CSV tracklist |

## Project structure

```
├── server/
│   ├── index.js          # Express server — all API routes, pipeline logic, guardrails
│   ├── library.js        # Persistent mix library (read/write library.json)
│   ├── pdf.js            # PDF tracklist generation using pdfkit
│   ├── library.json      # Auto-created on first save (gitignored)
│   ├── uploads/          # Temp upload directory (auto-cleaned hourly)
│   ├── served/           # Temp serve directory for AudD (auto-cleaned hourly)
│   ├── .env              # Your API keys (gitignored)
│   ├── .env.example      # Configuration template
│   └── package.json
├── client/
│   ├── src/
│   │   ├── App.jsx           # Main app — pipeline orchestration, layout
│   │   ├── App.module.css    # All styles
│   │   ├── api.js            # API service layer
│   │   ├── MixMeta.jsx       # Mix tagging form (DJ, event, date, genre, notes)
│   │   ├── TrackEditor.jsx   # Inline editable tracklist with review workflow
│   │   ├── Library.jsx       # Mix library browser with search and sort
│   │   └── main.jsx          # React entry point
│   ├── index.html
│   └── vite.config.js
└── package.json              # Root — runs both server and client with concurrently
```

## Deployment

For production deployment the local file serving and ngrok approach should be replaced:

- **Audio file hosting**: upload prepared audio to S3, R2, or Cloudflare and pass the public URL to AudD instead of the local serve route. Set `PUBLIC_HOST` to your storage bucket's public URL.
- **Server**: Railway, Render, or Fly.io — set all env vars in the platform dashboard. FFmpeg must be available in the build environment (most Node.js buildpacks include it, or add via `Dockerfile`).
- **Client**: Vercel or Netlify — update the Vite proxy config to point to your deployed server URL.
- **Library storage**: `library.json` works for personal use. For multi-user or high-volume use, migrate to SQLite (via `better-sqlite3`) or PostgreSQL.

Set `CLIENT_SECRET` in production to prevent unauthorized access to your API endpoints.

## License

MIT
