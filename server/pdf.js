/**
 * pdf.js — generate a formatted tracklist PDF using pdfkit.
 * Called from the /api/library/:id/pdf route.
 */

const PDFDocument = require("pdfkit");

// Colors
const BLACK      = "#0a0a0a";
const DARK_GRAY  = "#333333";
const MID_GRAY   = "#666666";
const LIGHT_GRAY = "#999999";
const RULE_GRAY  = "#e0e0e0";
const GREEN      = "#1db954";
const AMBER      = "#f59e0b";
const RED        = "#ef4444";
const ACCENT_BG  = "#f7f7f7";

function confColor(score) {
  if (score >= 90) return GREEN;
  if (score >= 75) return AMBER;
  return RED;
}

function formatDate(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      year: "numeric", month: "long", day: "numeric",
    });
  } catch { return iso; }
}

/**
 * Generate a tracklist PDF and pipe it to the given response stream.
 * @param {object} mix  - The full mix record from library.json
 * @param {object} res  - Express response object
 */
function generateTracklistPDF(mix, res) {
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 56, bottom: 56, left: 56, right: 56 },
    info: {
      Title: mix.meta?.event || mix.filename || "Tracklist",
      Author: mix.meta?.dj || "Unknown DJ",
      Subject: "DJ Mix Tracklist",
      Creator: "Mixtape Tracklist Generator",
    },
  });

  // Pipe directly to response
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${(mix.meta?.event || mix.filename || "tracklist").replace(/[^a-z0-9]/gi, "_")}.pdf"`
  );
  doc.pipe(res);

  const W = doc.page.width - 112; // usable width
  const L = 56;                    // left margin

  // ── Header bar ────────────────────────────────────────────────────────────
  doc.rect(L, 56, W, 64).fill(BLACK);

  doc.fillColor("white")
     .fontSize(20).font("Helvetica-Bold")
     .text(mix.meta?.event || mix.filename || "Untitled Mix", L + 16, 68, { width: W - 32 });

  doc.fontSize(10).font("Helvetica")
     .text(
       [mix.meta?.dj, mix.meta?.genre, mix.meta?.dateRecorded ? formatDate(mix.meta.dateRecorded) : null]
         .filter(Boolean).join("  ·  "),
       L + 16, 92, { width: W - 32 }
     );

  let y = 140;

  // ── Notes ─────────────────────────────────────────────────────────────────
  if (mix.meta?.notes) {
    doc.rect(L, y, W, 1).fill(RULE_GRAY);
    y += 12;
    doc.fillColor(MID_GRAY).fontSize(9).font("Helvetica-Oblique")
       .text(mix.meta.notes, L, y, { width: W });
    y += doc.heightOfString(mix.meta.notes, { width: W }) + 16;
  }

  // ── Stats row ─────────────────────────────────────────────────────────────
  doc.rect(L, y, W, 1).fill(RULE_GRAY);
  y += 12;

  const stats = [
    { label: "Tracks", val: String(mix.tracks?.length || 0) },
    { label: "High confidence", val: String((mix.tracks || []).filter((t) => t.score >= 90).length) },
    { label: "MC mode", val: { none: "No MC", between: "MC between tracks", throughout: "MC throughout" }[mix.mcMode] || mix.mcMode },
    { label: "Generated", val: formatDate(mix.createdAt) },
  ];

  const colW = W / stats.length;
  stats.forEach((s, i) => {
    doc.fillColor(LIGHT_GRAY).fontSize(8).font("Helvetica")
       .text(s.label.toUpperCase(), L + i * colW, y, { width: colW - 8 });
    doc.fillColor(DARK_GRAY).fontSize(14).font("Helvetica-Bold")
       .text(s.val, L + i * colW, y + 12, { width: colW - 8 });
  });

  y += 44;
  doc.rect(L, y, W, 1).fill(RULE_GRAY);
  y += 16;

  // ── Column headers ────────────────────────────────────────────────────────
  doc.fillColor(LIGHT_GRAY).fontSize(8).font("Helvetica-Bold");
  doc.text("#",         L,        y, { width: 20 });
  doc.text("TIME",      L + 24,   y, { width: 44 });
  doc.text("TITLE",     L + 72,   y, { width: 200 });
  doc.text("ARTIST",    L + 276,  y, { width: 140 });
  doc.text("LABEL",     L + 420,  y, { width: 80 });
  doc.text("CONF",      L + W - 30, y, { width: 30, align: "right" });

  y += 14;
  doc.rect(L, y, W, 0.5).fill(RULE_GRAY);
  y += 8;

  // ── Track rows ────────────────────────────────────────────────────────────
  const tracks = mix.tracks || [];

  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];
    const rowH = 28;

    // Zebra stripe
    if (i % 2 === 0) {
      doc.rect(L, y, W, rowH).fill(ACCENT_BG);
    }

    // Flag unconfirmed / low confidence
    if (t.unidentified) {
      doc.rect(L, y, 3, rowH).fill(LIGHT_GRAY);
    } else if (t.score < 75) {
      doc.rect(L, y, 3, rowH).fill(AMBER);
    } else if (t.confirmed) {
      doc.rect(L, y, 3, rowH).fill(GREEN);
    }

    const textY = y + 8;

    // Track number
    doc.fillColor(LIGHT_GRAY).fontSize(8).font("Helvetica")
       .text(String(i + 1), L + 6, textY, { width: 16, align: "right" });

    // Timestamp
    doc.fillColor(MID_GRAY).fontSize(9).font("Helvetica")
       .text(t.offset || "--:--", L + 24, textY, { width: 44 });

    if (t.unidentified) {
      doc.fillColor(LIGHT_GRAY).fontSize(9).font("Helvetica-Oblique")
         .text("Unidentified", L + 72, textY, { width: 340 });
    } else {
      // Title
      doc.fillColor(BLACK).fontSize(9).font("Helvetica-Bold")
         .text(t.title || "Unknown", L + 72, textY, { width: 198, ellipsis: true });

      // Artist
      doc.fillColor(DARK_GRAY).fontSize(9).font("Helvetica")
         .text(t.artist || "Unknown", L + 276, textY, { width: 138, ellipsis: true });

      // Label
      doc.fillColor(LIGHT_GRAY).fontSize(8).font("Helvetica")
         .text(t.label || "", L + 420, textY, { width: 78, ellipsis: true });

      // Confidence pill
      const confStr = t.confirmed ? "✓" : `${t.score || 0}%`;
      doc.fillColor(confColor(t.score || 0)).fontSize(8).font("Helvetica-Bold")
         .text(confStr, L + W - 30, textY, { width: 30, align: "right" });
    }

    y += rowH;

    // Sub-row: album + ISRC if present
    if ((t.album || t.isrc || t.releaseYear) && !t.unidentified) {
      const sub = [t.album, t.releaseYear, t.isrc ? `ISRC: ${t.isrc}` : null].filter(Boolean).join("  ·  ");
      if (i % 2 === 0) doc.rect(L, y, W, 12).fill(ACCENT_BG);
      doc.fillColor(LIGHT_GRAY).fontSize(7).font("Helvetica")
         .text(sub, L + 72, y + 2, { width: W - 72 - 30, ellipsis: true });
      y += 12;
    }

    // Page break if needed
    if (y > doc.page.height - 80) {
      doc.addPage();
      y = 56;
    }
  }

  // ── Footer ─────────────────────────────────────────────────────────────────
  y = doc.page.height - 56;
  doc.rect(L, y - 8, W, 0.5).fill(RULE_GRAY);
  doc.fillColor(LIGHT_GRAY).fontSize(8).font("Helvetica")
     .text(
       `Generated by Mixtape Tracklist Generator  ·  ${formatDate(mix.createdAt)}`,
       L, y, { width: W, align: "center" }
     );

  doc.end();
}

module.exports = { generateTracklistPDF };
