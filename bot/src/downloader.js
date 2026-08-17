import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import {
  runYtdlp,
  runYtdlpProgress,
  aria2cArgs,
  soundcloudProxyArgs,
  runFfmpeg,
  ffmpegLocationArgs,
  hasAudioStream,
  checkFfmpeg,
} from "./ytdlp.js";

// Sifat/tezlik muvozanati: balandligi shundan oshmaydi (.env orqali o'zgartirsa bo'ladi)
const MAX_HEIGHT = Number(process.env.VIDEO_MAX_HEIGHT || 720);

// ffmpeg tekshiruvini bir marta bajaramiz — har yuklashda takrorlamaymiz
let ffmpegPromise = null;
function ffmpegStatus() {
  if (!ffmpegPromise) ffmpegPromise = checkFfmpeg();
  return ffmpegPromise;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DOWNLOADS_DIR = path.join(__dirname, "..", "downloads");

if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

function isUrl(text) {
  try {
    new URL(text);
    return true;
  } catch {
    return false;
  }
}

function isInstagramUrl(text) {
  return /instagram\.com/i.test(text);
}

function isYoutubeUrl(text) {
  return /(youtube\.com|youtu\.be)/i.test(text);
}

function isInstagramStoryUrl(text) {
  return /instagram\.com\/(stories|s)\//i.test(text);
}

function isSoundcloudUrl(text) {
  return /soundcloud\.com/i.test(text);
}

/**
 * Instagram uchun cookie sozlamalari.
 * Story'lar va yopiq postlar faqat tizimga kirgan holda ko'rinadi.
 *
 * .env da ikkita usuldan birini tanlash mumkin:
 *   INSTAGRAM_COOKIES_FILE=C:\...\cookies.txt   (eng ishonchli)
 *   COOKIES_FROM_BROWSER=firefox                (brauzerdan avtomatik)
 */
let cookieWarningShown = false;

function cookieArgs(url) {
  if (!isInstagramUrl(url)) return [];

  const cookieFile = process.env.INSTAGRAM_COOKIES_FILE;
  if (cookieFile && fs.existsSync(cookieFile)) {
    return ["--cookies", cookieFile];
  }

  const browser = process.env.COOKIES_FROM_BROWSER;
  if (browser) {
    return ["--cookies-from-browser", browser];
  }

  if (!cookieWarningShown) {
    cookieWarningShown = true;
    console.warn(
      "ℹ Instagram cookie sozlanmagan — story va yopiq postlar ishlamaydi.\n" +
        "  .env da INSTAGRAM_COOKIES_FILE yoki COOKIES_FROM_BROWSER ni to'ldiring."
    );
  }
  return [];
}

function hasCookiesConfigured() {
  const cookieFile = process.env.INSTAGRAM_COOKIES_FILE;
  return Boolean(
    (cookieFile && fs.existsSync(cookieFile)) || process.env.COOKIES_FROM_BROWSER
  );
}

/** Berilgan id bilan boshlanadigan yuklangan faylni topadi. */
function findDownloadedFile(id, extension) {
  const files = fs.readdirSync(DOWNLOADS_DIR).filter((f) => f.startsWith(id));
  if (extension) {
    return files.find((f) => f.endsWith(extension));
  }
  return files[0];
}

/**
 * YouTube vaqti-vaqti bilan 403 (Forbidden) qaytaradi. Bunday holatda
 * boshqa "player client" bilan qayta urinib ko'rish odatda yordam beradi.
 */
const YOUTUBE_CLIENTS = [
  null, // avval oddiy holatda
  "tv",
  "web_safari",
  "ios",
  "android",
];

function isRetriableError(message) {
  // DRM bilan himoyalangan yozuvni hech qanday client bilan olib bo'lmaydi —
  // qayta urinish faqat vaqtni yo'qotadi.
  if (/DRM|protected content/i.test(message)) return false;

  return /403|Forbidden|Sign in to confirm|unable to download video data/i.test(
    message
  );
}

/**
 * Berilgan argumentlar bilan yt-dlp ni ishga tushiradi; 403 kabi xatolarda
 * boshqa client bilan qayta uradi.
 */
async function runYtdlpWithFallback(baseArgs, onProgress) {
  let lastError;
  for (const client of YOUTUBE_CLIENTS) {
    const args = client
      ? [...baseArgs, "--extractor-args", `youtube:player_client=${client}`]
      : baseArgs;
    try {
      return onProgress
        ? await runYtdlpProgress(args, onProgress)
        : await runYtdlp(args);
    } catch (e) {
      lastError = e;
      if (!isRetriableError(e.message)) throw e;
      console.warn(
        `⚠ ${client || "standart"} client ishlamadi, keyingisi sinalmoqda...`
      );
    }
  }
  throw new Error(
    `${lastError.message}\n\nMaslahat: yt-dlp'ni yangilab ko'ring — npm run update`
  );
}

// Tezlik uchun: avval yaxlit (video+audio birga) mp4 — birlashtirish kerak emas.
// Instagram deyarli har doim shunday beradi, shuning uchun eng tez yo'l.
const FORMAT_FAST = `b[ext=mp4][height<=${MAX_HEIGHT}]/b[ext=mp4]/b`;
// Yaxlit format topilmasa: alohida video+audio, ffmpeg birlashtiradi
const FORMAT_MERGED =
  `bv*[height<=${MAX_HEIGHT}][ext=mp4]+ba[ext=m4a]/bv*[height<=${MAX_HEIGHT}]+ba/b`;

async function runDownload(url, format, onProgress) {
  const id = randomUUID();
  const outputTemplate = path.join(DOWNLOADS_DIR, `${id}.%(ext)s`);

  await runYtdlpWithFallback([
    url,
    "-o",
    outputTemplate,
    "-f",
    format,
    "--merge-output-format",
    "mp4",
    // Bo'laklarni parallel yuklash — sezilarli tezlashtiradi
    "-N",
    "16",
    // Ortiqcha tarmoq so'rovlarini kesamiz
    "--no-playlist",
    "--no-check-formats",
    "--no-write-thumbnail",
    ...cookieArgs(url),
    ...aria2cArgs(),
    ...ffmpegLocationArgs(),
    // Instagram'ning yopiq postlari uchun cookie kerak bo'lsa, quyidagini yoqing:
    // "--cookies", path.join(__dirname, "..", "cookies.txt"),
  ]);

  const videoFile = findDownloadedFile(id, ".mp4") || findDownloadedFile(id);
  if (!videoFile) {
    throw new Error("Video yuklab bo'lmadi (fayl topilmadi).");
  }
  return path.join(DOWNLOADS_DIR, videoFile);
}

const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];
const VIDEO_EXTENSIONS = [".mp4", ".mov", ".mkv", ".webm"];

function classifyFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (IMAGE_EXTENSIONS.includes(ext)) return "photo";
  if (VIDEO_EXTENSIONS.includes(ext)) return "video";
  return "document";
}

/** Berilgan id bilan boshlanadigan barcha fayllarni tartib bilan qaytaradi. */
function collectFiles(id) {
  return fs
    .readdirSync(DOWNLOADS_DIR)
    .filter((f) => f.startsWith(`${id}_`))
    .sort()
    .map((f) => path.join(DOWNLOADS_DIR, f));
}

function isNoVideoError(message) {
  return /no video|There is no video|only images|unsupported url/i.test(message);
}

/**
 * Havoladagi barcha mediani yuklaydi: video, rasm yoki karusel (bir nechta fayl).
 * @returns {Promise<Array<{path: string, type: "video"|"photo"|"document"}>>}
 */
async function downloadMedia(url, onProgress) {
  const id = randomUUID();
  const outputTemplate = path.join(DOWNLOADS_DIR, `${id}_%(autonumber)02d.%(ext)s`);
  const instagram = isInstagramUrl(url);

  const commonArgs = [
    url,
    "-o",
    outputTemplate,
    "-N",
    "16",
    "--no-progress",
    "--no-warnings",
    // Instagram karusel postlari bir nechta elementdan iborat bo'ladi
    instagram ? "--yes-playlist" : "--no-playlist",
    ...cookieArgs(url),
    ...aria2cArgs(),
    ...ffmpegLocationArgs(),
  ];

  try {
    await runYtdlpWithFallback(
      [
        ...commonArgs,
        "-f",
        FORMAT_FAST,
        "--merge-output-format",
        "mp4",
      ],
      onProgress
    );
  } catch (e) {
    if (!isNoVideoError(e.message)) throw e;

    // Postda video yo'q — demak bu rasm(lar). Rasmlarni alohida olamiz.
    console.warn("ℹ Postda video yo'q — rasm sifatida yuklanmoqda.");
    for (const file of collectFiles(id)) cleanupFile(file);

    await runYtdlpWithFallback([
      ...commonArgs,
      "--write-thumbnail",
      "--skip-download",
      "--convert-thumbnails",
      "jpg",
      // Rasm postlarida "format yo'q" xatosi normal holat — to'xtab qolmaymiz
      "--ignore-no-formats-error",
      // Karuseldagi bitta element ishlamasa, qolganlari yuklanaversin
      "--ignore-errors",
    ]);
  }

  const files = collectFiles(id);
  if (!files.length) {
    throw new Error("Bu havoladan hech narsa yuklab bo'lmadi.");
  }

  return files.map((filePath) => ({
    path: filePath,
    type: classifyFile(filePath),
  }));
}

/**
 * Instagram yoki YouTube linkidan videoni yuklab, mp4 fayl yo'lini qaytaradi.
 * Natijada ovoz borligini tekshiradi — bo'lmasa boshqa format bilan qayta uradi.
 */
async function downloadVideo(url, onProgress) {
  const ffmpeg = await ffmpegStatus();

  // Avval eng tez yo'l: yaxlit mp4 (birlashtirish yo'q)
  let videoPath = await runDownload(url, FORMAT_FAST, onProgress);

  if (await hasAudioStream(videoPath)) {
    return videoPath;
  }

  // Ovoz yo'q — demak yaxlit format topilmagan. ffmpeg bilan birlashtiramiz.
  cleanupFile(videoPath);
  if (!ffmpeg.ok) {
    throw new Error(
      "Ovozli video uchun ffmpeg kerak. `npm run setup` buyrug'ini bajaring."
    );
  }

  console.warn("⚠ Yaxlit format topilmadi — video va audio birlashtirilmoqda.");
  videoPath = await runDownload(url, FORMAT_MERGED, onProgress);

  if (!(await hasAudioStream(videoPath))) {
    cleanupFile(videoPath);
    throw new Error("Bu videoning ovozli versiyasini topib bo'lmadi.");
  }

  return videoPath;
}

/**
 * Mahalliy video fayldan ffmpeg orqali audio (mp3) ajratib oladi.
 */
async function extractAudioFromVideo(videoPath) {
  const outPath = path.join(DOWNLOADS_DIR, `${randomUUID()}.mp3`);
  await runFfmpeg([
    "-y",
    "-i",
    videoPath,
    "-vn",
    // Musiqani tanib olish uchun birinchi 20 soniya yetarli
    "-t",
    "20",
    "-acodec",
    "libmp3lame",
    "-q:a",
    "2",
    outPath,
  ]);
  return outPath;
}

/**
 * Havoladan faqat qisqa audio parcha yuklaydi (musiqani tanish uchun).
 * To'liq videoni yuklamagani uchun ancha tez ishlaydi.
 */
async function downloadAudioClip(url, seconds = 25) {
  const id = randomUUID();
  const outputTemplate = path.join(DOWNLOADS_DIR, `${id}.%(ext)s`);

  await runYtdlpWithFallback([
    url,
    "-o",
    outputTemplate,
    "-f",
    "ba/b",
    "-x",
    "--audio-format",
    "mp3",
    "--audio-quality",
    "5",
    "--download-sections",
    `*0-${seconds}`,
    "--no-playlist",
    "--no-warnings",
    "--no-progress",
    ...cookieArgs(url),
    ...ffmpegLocationArgs(),
  ]);

  const audioFile = findDownloadedFile(id, ".mp3");
  if (!audioFile) {
    throw new Error("Audio parchani ajratib bo'lmadi.");
  }
  return path.join(DOWNLOADS_DIR, audioFile);
}

/**
 * YouTube'da qidirib, natijalar ro'yxatini qaytaradi (yuklamasdan — tez ishlaydi).
 * @returns {Promise<Array<{id, title, uploader, duration, url, official}>>}
 */
async function searchOnce(searchSpec, source) {
  const output = await runYtdlpWithFallback([
    searchSpec,
    "--flat-playlist",
    "--dump-json",
    "--no-warnings",
    "--no-progress",
    ...(source === "soundcloud" ? soundcloudProxyArgs() : []),
  ]);

  const results = [];
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const entry = JSON.parse(trimmed);
      if (!entry.id) continue;

      const uploader = entry.uploader || entry.channel || "";
      const url =
        source === "youtube"
          ? `https://www.youtube.com/watch?v=${entry.id}`
          : entry.url || entry.webpage_url;
      if (!url) continue;

      results.push({
        id: entry.id,
        source,
        title: entry.title || "Nomsiz",
        uploader,
        duration: entry.duration || 0,
        url,
        // YouTube rasmiy audio kanallari "... - Topic" deb nomlanadi.
        // Aynan ular ko'pincha DRM bilan himoyalangan bo'ladi.
        drmRisk: source === "youtube" && /-\s*Topic$/i.test(uploader),
      });
    } catch {
      /* buzuq qatorni o'tkazib yuboramiz */
    }
  }
  return results;
}

/**
 * YouTube va SoundCloud'da bir vaqtda qidiradi.
 * SoundCloud'da DRM yo'q — shuning uchun u ishonchli zaxira manba.
 */
async function searchCandidates(query, limit = 10) {
  const [youtube, soundcloud] = await Promise.all([
    searchOnce(`ytsearch${limit}:${query}`, "youtube").catch((e) => {
      console.warn("YouTube qidiruvi ishlamadi:", e.message);
      return [];
    }),
    searchOnce(`scsearch5:${query}`, "soundcloud").catch((e) => {
      console.warn("SoundCloud qidiruvi ishlamadi:", e.message);
      return [];
    }),
  ]);

  // DRM xavfi bor yozuvlarni pastga tushiramiz (o'chirmaymiz — tanlov foydalanuvchida)
  const safeYoutube = youtube.filter((item) => !item.drmRisk);
  const riskyYoutube = youtube.filter((item) => item.drmRisk);

  // SoundCloud'ga doim joy qoldiramiz — aks holda YouTube natijalari limitni
  // to'liq band qilib, ishonchli zaxira manba hech qachon sinalmay qoladi.
  const youtubeBudget = Math.max(limit - soundcloud.length, 0);
  return [...safeYoutube.slice(0, youtubeBudget), ...soundcloud, ...riskyYoutube].slice(
    0,
    limit
  );
}

/** Aniq bir havoladan mp3 yuklaydi. */
async function downloadAudioByUrl(url) {
  const id = randomUUID();
  const outputTemplate = path.join(DOWNLOADS_DIR, `${id}.%(ext)s`);

  await runYtdlpWithFallback([
    url,
    "-o",
    outputTemplate,
    "-f",
    "ba/b",
    "-x",
    "--audio-format",
    "mp3",
    "--audio-quality",
    "5",
    "-N",
    "16",
    "--no-playlist",
    "--no-warnings",
    "--no-progress",
    ...aria2cArgs(),
    ...ffmpegLocationArgs(),
    ...(isSoundcloudUrl(url) ? soundcloudProxyArgs() : []),
  ]);

  const audioFile = findDownloadedFile(id, ".mp3");
  if (!audioFile) {
    throw new Error("Qo'shiqni yuklab bo'lmadi.");
  }
  return path.join(DOWNLOADS_DIR, audioFile);
}

/**
 * Nomzodlar ro'yxatidan birinchi muvaffaqiyatli yuklanadiganini topadi.
 * Bitta natija ishlamasa (DRM, tarmoq, 403 yoki boshqa xato) — taslim
 * bo'lmasdan ro'yxatdagi keyingisini sinaydi.
 * @returns {Promise<{audioPath: string, item: object}>}
 */
async function downloadFirstAvailable(candidates) {
  let lastError;
  for (const candidate of candidates) {
    try {
      const audioPath = await downloadAudioByUrl(candidate.url);
      return { audioPath, item: candidate };
    } catch (e) {
      lastError = e;
      console.warn(
        `⚠ "${candidate.title}" yuklanmadi (${e.message.slice(0, 80)}), keyingisi sinalmoqda...`
      );
    }
  }
  throw lastError;
}

/**
 * YouTube'da matn (qo'shiq nomi) bo'yicha qidirib, mp3 yuklaydi.
 * Eng mos natija ko'pincha rasmiy "Artist - Topic" auto-kanalida bo'ladi,
 * bunday kanal videolari esa deyarli har doim DRM bilan himoyalangan —
 * shuning uchun bir nechta nomzod (YouTube + SoundCloud) orasidan birinchi
 * ishlaydiganini tanlaymiz.
 */
async function searchAndDownloadAudio(query) {
  const candidates = await searchCandidates(query, 10);
  if (!candidates.length) {
    throw new Error("Qo'shiq topilmadi.");
  }

  const { audioPath } = await downloadFirstAvailable(candidates);
  return audioPath;
}

function cleanupFile(filePath) {
  fs.unlink(filePath, () => {});
}

/**
 * downloads/ papkasini diskdan tekshirib, belgilangan yoshdan katta fayllarni
 * o'chiradi. Xotiradagi mediaCache'dan mustaqil ishlaydi — shuning uchun bot
 * qayta ishga tushgandan keyin ham, yuklash yarim yo'lda uzilib qolgan
 * bo'lak fayllar (masalan *.f251.webm, *.fdash-xxx.m4a) ham tozalanadi.
 */
function sweepOldDownloads(maxAgeMs = 30 * 60 * 1000) {
  let files;
  try {
    files = fs.readdirSync(DOWNLOADS_DIR);
  } catch {
    return;
  }

  const now = Date.now();
  for (const file of files) {
    if (file === ".gitkeep") continue;
    const filePath = path.join(DOWNLOADS_DIR, file);
    try {
      const stats = fs.statSync(filePath);
      if (!stats.isFile()) continue;
      if (now - stats.mtimeMs > maxAgeMs) {
        fs.unlinkSync(filePath);
      }
    } catch {
      /* fayl allaqachon o'chirilgan yoki band bo'lishi mumkin */
    }
  }
}

export {
  isUrl,
  isInstagramUrl,
  isInstagramStoryUrl,
  isYoutubeUrl,
  hasCookiesConfigured,
  downloadVideo,
  downloadMedia,
  downloadAudioClip,
  searchCandidates,
  downloadAudioByUrl,
  downloadFirstAvailable,
  extractAudioFromVideo,
  searchAndDownloadAudio,
  cleanupFile,
  sweepOldDownloads,
};
