import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import path from "path";
import {
  isUrl,
  isInstagramUrl,
  isYoutubeUrl,
  downloadVideo,
  extractAudioFromVideo,
  searchAndDownloadAudio,
  cleanupFile,
  DOWNLOADS_DIR,
} from "./downloader.js";
import { recognizeAudio, findSongByText } from "./recognizer.js";

// Bu server React mini-app (yoki istalgan frontend) uchun oddiy REST API beradi.
// Botning o'zi (index.js) mustaqil ishlaydi; bu ixtiyoriy qo'shimcha xizmat.

const app = express();
app.use(cors());
app.use(express.json());
app.use("/files", express.static(DOWNLOADS_DIR));

const upload = multer({ dest: path.join(DOWNLOADS_DIR, "uploads") });

function publicUrl(req, absPath) {
  const filename = path.basename(absPath);
  return `${req.protocol}://${req.get("host")}/files/${filename}`;
}

// Video/audio yuklab olish: { url: "https://instagram.com/..." }
app.post("/api/download", async (req, res) => {
  const { url } = req.body;
  if (!url || !isUrl(url) || !(isInstagramUrl(url) || isYoutubeUrl(url))) {
    return res.status(400).json({ error: "Instagram yoki YouTube linki kiriting." });
  }
  try {
    const videoPath = await downloadVideo(url);
    res.json({ videoUrl: publicUrl(req, videoPath) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Yuklangan video/audio fayldan fon musiqasini aniqlash (Shazam kabi)
app.post("/api/recognize", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Fayl yuborilmadi." });
  try {
    const song = await recognizeAudio(req.file.path);
    res.json({ song });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    cleanupFile(req.file.path);
  }
});

// Qo'shiq nomi yoki matni bo'yicha qidirish: { query: "..." }
app.post("/api/search-song", async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: "So'rov matni kerak." });
  try {
    const { searchQuery, matched, title, artist } = await findSongByText(query);
    const audioPath = await searchAndDownloadAudio(searchQuery);
    res.json({
      audioUrl: publicUrl(req, audioPath),
      title: matched ? title : undefined,
      artist: matched ? artist : undefined,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.API_PORT || 3001;
app.listen(PORT, () => console.log(`✅ API server ${PORT}-portda ishga tushdi.`));
