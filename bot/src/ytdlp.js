// yt-dlp va ffmpeg dasturlarini topish va ishga tushirish uchun yordamchi modul.
// Hech qanday qo'shimcha npm paketiga bog'liq emas.
import { execFile, spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN_DIR = path.join(__dirname, "..", "bin");
const isWin = os.platform() === "win32";

const cache = {};

/**
 * Dastur joylashuvini aniqlaydi:
 *   1) .env dagi maxsus yo'l (masalan YTDLP_PATH / FFMPEG_PATH)
 *   2) loyihaning bin/ papkasi (npm run setup shu yerga yuklaydi)
 *   3) tizim PATH'i
 */
function resolveBinary(name, envVar) {
  if (cache[name]) return cache[name];

  const fromEnv = process.env[envVar];
  if (fromEnv && fs.existsSync(fromEnv)) {
    cache[name] = fromEnv;
    return cache[name];
  }

  const localBinary = path.join(BIN_DIR, isWin ? `${name}.exe` : name);
  if (fs.existsSync(localBinary)) {
    cache[name] = localBinary;
    return cache[name];
  }

  const fromWinget = findInWinget(name);
  if (fromWinget) {
    cache[name] = fromWinget;
    return cache[name];
  }

  cache[name] = name;
  return cache[name];
}

/**
 * winget orqali o'rnatilgan dasturlarni topadi.
 * PATH yangilanmagan bo'lsa ham ishlaydi (terminalni qayta ochish shart emas).
 */
function findInWinget(name) {
  if (!isWin) return null;
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return null;

  const exeName = `${name}.exe`;
  const wingetRoot = path.join(localAppData, "Microsoft", "WinGet");

  // 1) winget "Links" papkasidagi qisqartma
  const linkPath = path.join(wingetRoot, "Links", exeName);
  if (fs.existsSync(linkPath)) return linkPath;

  // 2) Packages papkasi ichidan qidiramiz (chuqurligi cheklangan)
  const packagesDir = path.join(wingetRoot, "Packages");
  if (!fs.existsSync(packagesDir)) return null;

  const found = searchForFile(packagesDir, exeName, 4);
  return found;
}

function searchForFile(dir, fileName, maxDepth) {
  if (maxDepth < 0) return null;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === fileName.toLowerCase()) {
      return full;
    }
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const result = searchForFile(path.join(dir, entry.name), fileName, maxDepth - 1);
      if (result) return result;
    }
  }
  return null;
}

const resolveYtdlp = () => resolveBinary("yt-dlp", "YTDLP_PATH");
const resolveFfmpeg = () => resolveBinary("ffmpeg", "FFMPEG_PATH");
const resolveFfprobe = () => resolveBinary("ffprobe", "FFPROBE_PATH");

function run(binary, args, notFoundHint) {
  return new Promise((resolve, reject) => {
    execFile(
      binary,
      args,
      { maxBuffer: 1024 * 1024 * 64 },
      (error, stdout, stderr) => {
        if (error) {
          if (error.code === "ENOENT") {
            return reject(new Error(notFoundHint));
          }
          const message = (stderr || error.message || "").trim();
          return reject(new Error(message.split("\n").slice(-3).join(" ")));
        }
        resolve(stdout);
      }
    );
  });
}

/** yt-dlp ni berilgan argumentlar bilan ishga tushiradi. */
function runYtdlp(args) {
  return run(
    resolveYtdlp(),
    args,
    "yt-dlp topilmadi. Bot papkasida `npm run setup` buyrug'ini bajaring."
  );
}

/** ffmpeg ni berilgan argumentlar bilan ishga tushiradi. */
function runFfmpeg(args) {
  return run(
    resolveFfmpeg(),
    args,
    "ffmpeg topilmadi. Bot papkasida `npm run setup` buyrug'ini bajaring."
  );
}

/**
 * yt-dlp ni ishga tushirib, yuklash jarayonini real vaqtda kuzatadi.
 * onProgress(percent) har bir yangilanishda chaqiriladi.
 */
function runYtdlpProgress(args, onProgress) {
  const binary = resolveYtdlp();
  return new Promise((resolve, reject) => {
    const child = spawn(binary, [...args, "--newline"], {
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      const text = data.toString();
      stdout += text;
      if (!onProgress) return;
      // Namuna: "[download]  45.2% of 12.34MiB at 1.20MiB/s ETA 00:05"
      for (const match of text.matchAll(/\[download\]\s+(\d+(?:\.\d+)?)%/g)) {
        onProgress(Number(match[1]));
      }
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("error", (error) => {
      if (error.code === "ENOENT") {
        return reject(
          new Error("yt-dlp topilmadi. `npm run setup` buyrug'ini bajaring.")
        );
      }
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) return resolve(stdout);
      const message = (stderr || stdout || "").trim();
      reject(new Error(message.split("\n").slice(-3).join(" ")));
    });
  });
}

/** aria2c mavjud bo'lsa, undan foydalanamiz — yuklash sezilarli tezlashadi. */
let aria2cChecked = false;
let aria2cAvailable = false;

function aria2cArgs() {
  if (!aria2cChecked) {
    aria2cChecked = true;
    const candidate = resolveBinary("aria2c", "ARIA2C_PATH");
    // resolveBinary topa olmasa shunchaki "aria2c" qaytaradi — mavjudligini
    // tekshirish uchun bin/ yoki to'liq yo'l bo'lishi kerak
    aria2cAvailable = candidate !== "aria2c" && fs.existsSync(candidate);
    if (aria2cAvailable) {
      cache["aria2c"] = candidate;
    }
  }
  if (!aria2cAvailable) return [];
  return [
    "--downloader",
    cache["aria2c"],
    "--downloader-args",
    "aria2c:-x16 -s16 -k1M",
  ];
}

/**
 * SoundCloud so'rovlari uchun proxy (agar .env da SOUNDCLOUD_PROXY
 * ko'rsatilgan bo'lsa). Ba'zi tarmoqlarda soundcloud.com to'g'ridan-to'g'ri
 * bloklangan bo'ladi — bunday holda faqat shu so'rovlarni proxy orqali
 * yuboramiz, YouTube esa proxysiz tezroq ishlayveradi.
 */
function soundcloudProxyArgs() {
  const proxy = process.env.SOUNDCLOUD_PROXY;
  if (!proxy) return [];
  return ["--proxy", proxy];
}

/** ffprobe ni ishga tushiradi (fayl ichidagi oqimlarni tekshirish uchun). */
function runFfprobe(args) {
  return run(resolveFfprobe(), args, "ffprobe topilmadi.");
}

/**
 * Video faylning kengligi/balandligi va davomiyligini o'qiydi. Bularni
 * Telegram'ga sendVideo bilan birga yubormasak, Telegram nisbatni o'zi
 * taxmin qiladi — natijada tik (portrait) videolar cho'zilib/torayib
 * noto'g'ri ko'rinishi mumkin. ffprobe topilmasa yoki xato bersa, bo'sh
 * obyekt qaytaramiz — Telegram odatdagidek o'zi aniqlashga urinadi.
 */
async function getVideoMetadata(filePath) {
  try {
    const output = await runFfprobe([
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-show_entries",
      "format=duration",
      "-of",
      "json",
      filePath,
    ]);
    const data = JSON.parse(output);
    const stream = data.streams?.[0] || {};
    const duration = Number(data.format?.duration);
    return {
      width: stream.width || undefined,
      height: stream.height || undefined,
      duration: Number.isFinite(duration) ? Math.round(duration) : undefined,
    };
  } catch {
    return {};
  }
}

/**
 * Faylda audio oqimi bor-yo'qligini tekshiradi.
 * ffprobe topilmasa, tekshirmasdan "bor" deb hisoblaymiz.
 */
async function hasAudioStream(filePath) {
  try {
    const output = await runFfprobe([
      "-v",
      "error",
      "-select_streams",
      "a",
      "-show_entries",
      "stream=codec_type",
      "-of",
      "csv=p=0",
      filePath,
    ]);
    return output.trim().length > 0;
  } catch {
    return true;
  }
}

/**
 * yt-dlp ning o'zi ham ffmpeg'ga muhtoj (video+audio birlashtirish, mp3 ajratish).
 * ffmpeg PATH'da bo'lmasa, uning joyini yt-dlp ga ko'rsatib beramiz.
 */
function ffmpegLocationArgs() {
  const ffmpegPath = resolveFfmpeg();
  if (ffmpegPath === "ffmpeg") return []; // PATH'dan topiladi
  return ["--ffmpeg-location", path.dirname(ffmpegPath)];
}

/** yt-dlp o'rnatilganini va ishlayotganini tekshiradi. */
async function checkYtdlp() {
  try {
    const version = await runYtdlp(["--version"]);
    return { ok: true, version: version.trim(), path: resolveYtdlp() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** ffmpeg mavjudligini tekshiradi. */
async function checkFfmpeg() {
  try {
    const output = await runFfmpeg(["-version"]);
    const version = output.split("\n")[0].trim();
    return { ok: true, version, path: resolveFfmpeg() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export {
  runYtdlp,
  runYtdlpProgress,
  aria2cArgs,
  soundcloudProxyArgs,
  runFfmpeg,
  runFfprobe,
  checkYtdlp,
  checkFfmpeg,
  resolveYtdlp,
  resolveFfmpeg,
  resolveFfprobe,
  ffmpegLocationArgs,
  hasAudioStream,
  getVideoMetadata,
};
