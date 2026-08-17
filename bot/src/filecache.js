// Bir marta yuborilgan fayllarni Telegram'ning o'zida qayta ishlatish uchun kesh.
//
// Telegram har bir yuborilgan faylga file_id beradi. O'sha file_id ni saqlab
// qo'ysak, keyingi safar shu havola so'ralganda faylni qaytadan yuklab
// o'tirmasdan, bir zumda yuborsak bo'ladi.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = path.join(__dirname, "..", "file-cache.json");
const MAX_ENTRIES = 5000;

let cache = new Map();

// Diskdan yuklaymiz
try {
  if (fs.existsSync(CACHE_FILE)) {
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
    cache = new Map(Object.entries(raw));
  }
} catch (e) {
  console.warn("⚠ Kesh faylini o'qib bo'lmadi:", e.message);
}

let saveTimer = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      // Eng eskilarini kesib tashlaymiz
      if (cache.size > MAX_ENTRIES) {
        const keys = [...cache.keys()].slice(0, cache.size - MAX_ENTRIES);
        for (const key of keys) cache.delete(key);
      }
      fs.writeFileSync(CACHE_FILE, JSON.stringify(Object.fromEntries(cache)));
    } catch (e) {
      console.warn("⚠ Keshni saqlab bo'lmadi:", e.message);
    }
  }, 2000);
}

/**
 * Havolani bir xil ko'rinishga keltiradi, shunda bir xil video uchun
 * turli ko'rinishdagi linklar bitta kalitga tushadi.
 */
function normalizeUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();

    // YouTube: faqat video id muhim
    if (host === "youtu.be") {
      return `yt:${url.pathname.slice(1)}`;
    }
    if (host.endsWith("youtube.com")) {
      const id = url.searchParams.get("v");
      if (id) return `yt:${id}`;
      // Shorts: /shorts/<id>
      const shorts = url.pathname.match(/\/shorts\/([\w-]+)/);
      if (shorts) return `yt:${shorts[1]}`;
    }

    // Instagram: /reel/<kod>/ yoki /p/<kod>/ — qolgan parametrlar keraksiz
    if (host.endsWith("instagram.com")) {
      const match = url.pathname.match(/\/(reel|reels|p|tv)\/([\w-]+)/);
      if (match) return `ig:${match[2]}`;
    }

    return `${host}${url.pathname}`.replace(/\/+$/, "");
  } catch {
    return rawUrl;
  }
}

function getCachedFileId(rawUrl) {
  return cache.get(normalizeUrl(rawUrl)) || null;
}

function setCachedFileId(rawUrl, fileId) {
  cache.set(normalizeUrl(rawUrl), fileId);
  scheduleSave();
}

function cacheSize() {
  return cache.size;
}

export { getCachedFileId, setCachedFileId, normalizeUrl, cacheSize };
