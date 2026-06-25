/**
 * library.js — persistent mix library stored as JSON on disk.
 * Each saved mix has: id, meta (DJ, date, genre, event, notes),
 * tracks (edited tracklist), mcMode, createdAt.
 */

const fs   = require("fs");
const path = require("path");

const LIBRARY_PATH = path.join(__dirname, "library.json");

function readLibrary() {
  if (!fs.existsSync(LIBRARY_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(LIBRARY_PATH, "utf8"));
  } catch {
    return [];
  }
}

function writeLibrary(mixes) {
  fs.writeFileSync(LIBRARY_PATH, JSON.stringify(mixes, null, 2), "utf8");
}

function saveMix(mix) {
  const library = readLibrary();
  const id = `mix_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const record = { id, createdAt: new Date().toISOString(), ...mix };
  library.unshift(record); // newest first
  writeLibrary(library);
  return record;
}

function updateMix(id, updates) {
  const library = readLibrary();
  const idx = library.findIndex((m) => m.id === id);
  if (idx === -1) return null;
  library[idx] = { ...library[idx], ...updates, updatedAt: new Date().toISOString() };
  writeLibrary(library);
  return library[idx];
}

function deleteMix(id) {
  const library = readLibrary();
  const filtered = library.filter((m) => m.id !== id);
  writeLibrary(filtered);
  return filtered.length < library.length;
}

function getMix(id) {
  return readLibrary().find((m) => m.id === id) || null;
}

module.exports = { readLibrary, saveMix, updateMix, deleteMix, getMix };
