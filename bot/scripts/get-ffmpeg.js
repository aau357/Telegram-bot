// ffmpeg dasturini yuklab, bot/bin/ papkasiga joylashtiradi.
// Windows uchun to'liq avtomatik; Linux/macOS uchun ko'rsatma beradi.
import fs from "fs";
import path from "path";
import os from "os";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import { downloadWithProgress, formatMb } from "./download.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN_DIR = path.join(__dirname, "..", "bin");
const platform = os.platform();

// Bir nechta manba — biri ishlamasa, keyingisi sinaladi.
const WIN_URLS = [
  "https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip",
  "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip",
];

async function downloadArchive(zipPath) {
  let lastError;
  for (const url of WIN_URLS) {
    try {
      console.log(`ffmpeg yuklanmoqda (~80-150 MB, biroz vaqt oladi)...\n  ${url}\n`);
      return await downloadWithProgress(url, zipPath, 20);
    } catch (err) {
      lastError = err;
      console.error(`  ✖ Bu manbadan bo'lmadi: ${err.message}\n`);
    }
  }
  throw lastError;
}

async function setupWindows() {
  const ffmpegPath = path.join(BIN_DIR, "ffmpeg.exe");
  if (fs.existsSync(ffmpegPath)) {
    console.log(`✔ ffmpeg allaqachon mavjud: ${ffmpegPath}`);
    return;
  }

  const zipPath = path.join(BIN_DIR, "ffmpeg.zip");
  const size = await downloadArchive(zipPath);
  console.log(`  Yuklandi: ${formatMb(size)} MB. Ochilmoqda...`);

  const extractDir = path.join(BIN_DIR, "_ffmpeg_tmp");
  fs.mkdirSync(extractDir, { recursive: true });

  // Windows 10/11 da tar (bsdtar) zip fayllarni ocha oladi
  execFileSync("tar", ["-xf", zipPath, "-C", extractDir], { stdio: "inherit" });

  // Ochilgan papkadan ffmpeg.exe va ffprobe.exe ni topamiz
  const found = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/^(ffmpeg|ffprobe)\.exe$/i.test(entry.name)) found.push(full);
    }
  })(extractDir);

  if (!found.length) {
    throw new Error("Arxiv ichidan ffmpeg.exe topilmadi.");
  }

  for (const file of found) {
    fs.copyFileSync(file, path.join(BIN_DIR, path.basename(file)));
    console.log(`  ✔ ${path.basename(file)}`);
  }

  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.rmSync(zipPath, { force: true });
  console.log(`✅ Tayyor: ${ffmpegPath}`);
}

async function main() {
  fs.mkdirSync(BIN_DIR, { recursive: true });

  if (platform === "win32") {
    await setupWindows();
    return;
  }

  console.log(
    "Bu skript ffmpeg'ni faqat Windows uchun avtomatik o'rnatadi.\n" +
      "Sizning tizimingizda quyidagicha o'rnating:\n" +
      (platform === "darwin"
        ? "  brew install ffmpeg"
        : "  sudo apt install ffmpeg")
  );
}

main().catch((err) => {
  console.error("\n❌ ffmpeg o'rnatilmadi:", err.message);
  console.error(
    "\nQo'lda o'rnatish yo'llari:\n" +
      "  1) PowerShell: winget install Gyan.FFmpeg\n" +
      `  2) Brauzerda oching: ${WIN_URLS[0]}\n` +
      `     Arxivni oching va ichidagi bin\\ffmpeg.exe va bin\\ffprobe.exe\n` +
      `     fayllarini shu papkaga ko'chiring: ${BIN_DIR}`
  );
  process.exit(1);
});
