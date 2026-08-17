import "dotenv/config";
import { Telegraf, Markup } from "telegraf";
import fs from "fs";
import path from "path";
import axios from "axios";
import { randomUUID } from "crypto";
import {
  isUrl,
  isInstagramUrl,
  isYoutubeUrl,
  hasCookiesConfigured,
  downloadVideo,
  downloadMedia,
  downloadAudioClip,
  searchCandidates,
  downloadAudioByUrl,
  extractAudioFromVideo,
  searchAndDownloadAudio,
  cleanupFile,
  sweepOldDownloads,
  DOWNLOADS_DIR,
} from "./downloader.js";
import { recognizeAudio, findSongByText } from "./recognizer.js";
import { getCachedFileId, setCachedFileId, cacheSize } from "./filecache.js";
import { checkYtdlp, checkFfmpeg, getVideoMetadata } from "./ytdlp.js";
import { toUserMessage, notifyAdmin } from "./errors.js";
import { rememberUser, getAllUsers, userCount } from "./userstore.js";

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error("XATOLIK: .env faylida BOT_TOKEN ko'rsatilmagan.");
  process.exit(1);
}

const MAX_FILE_SIZE_MB = Number(process.env.MAX_FILE_SIZE_MB || 48);
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const CACHE_TTL_MS = 20 * 60 * 1000; // 20 daqiqa

const bot = new Telegraf(BOT_TOKEN);

// MUHIM: Telegraf'da bot.catch() sozlanmasa, handler ichida ushlanmagan
// xato (masalan Telegram tarmog'ida vaqtinchalik uzilish) butun Node
// jarayonini qulatib yuboradi. Shuning uchun bu yerda ushlab, faqat
// konsolga yozamiz — bot ishlashda davom etadi.
bot.catch((err, ctx) => {
  console.error(`[telegraf xato] ${ctx.updateType}:`, err?.message || err);
  notifyAdmin(ctx.telegram, err, `telegraf: ${ctx.updateType}`);
});

// Qo'shimcha ehtiyot chorasi: Telegraf tashqarisida sodir bo'lgan
// kutilmagan xatolar ham botni to'xtatib qo'ymasin.
process.on("unhandledRejection", (err) => {
  console.error("[ushlanmagan promise xatosi]", err?.message || err);
});
process.on("uncaughtException", (err) => {
  console.error("[ushlanmagan xato]", err?.message || err);
});

// /broadcast buyrug'i shu ro'yxatdagi hammaga xabar yuborish uchun ishlatadi
bot.use((ctx, next) => {
  if (ctx.from) rememberUser(ctx.from.id);
  return next();
});

// ---------------------------------------------------------------------------
// Vaqtinchalik xotira: yuklangan fayllar va topilgan qo'shiqlar
// ---------------------------------------------------------------------------
const mediaCache = new Map(); // key -> { filePath, createdAt }
const songCache = new Map(); // key -> { title, artist, createdAt }
const urlCache = new Map(); // key -> { url, createdAt }
const searchCache = new Map(); // key -> { results, query, createdAt }

function cacheSearch(query, results) {
  const key = randomUUID().slice(0, 8);
  searchCache.set(key, { query, results, createdAt: Date.now() });
  return key;
}

function cacheMedia(filePath) {
  const key = randomUUID().slice(0, 8);
  mediaCache.set(key, { filePath, createdAt: Date.now() });
  return key;
}

function cacheUrl(url) {
  const key = randomUUID().slice(0, 8);
  urlCache.set(key, { url, createdAt: Date.now() });
  return key;
}

function cacheSong(song) {
  const key = randomUUID().slice(0, 8);
  songCache.set(key, { ...song, createdAt: Date.now() });
  return key;
}

// Eskirgan fayllarni muntazam tozalab turamiz
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of mediaCache) {
    if (now - value.createdAt > CACHE_TTL_MS) {
      cleanupFile(value.filePath);
      mediaCache.delete(key);
    }
  }
  for (const [key, value] of songCache) {
    if (now - value.createdAt > CACHE_TTL_MS) songCache.delete(key);
  }
  for (const [key, value] of urlCache) {
    if (now - value.createdAt > CACHE_TTL_MS) urlCache.delete(key);
  }
  for (const [key, value] of searchCache) {
    if (now - value.createdAt > CACHE_TTL_MS) searchCache.delete(key);
  }

  // Diskdagi eskirgan fayllarni ham tozalaymiz — bot qayta ishga tushganda
  // yoki yuklash yarim yo'lda uzilib qolganda mediaCache buni bilmaydi.
  sweepOldDownloads(CACHE_TTL_MS);
}, 5 * 60 * 1000);

// ---------------------------------------------------------------------------
// Yordamchi funksiyalar
// ---------------------------------------------------------------------------
function checkFileSize(filePath, ctx) {
  const stats = fs.statSync(filePath);
  if (stats.size > MAX_FILE_SIZE_BYTES) {
    ctx.reply(
      `📦 Bu fayl juda katta (${(stats.size / 1024 / 1024).toFixed(1)} MB). ` +
        `Telegram orqali ${MAX_FILE_SIZE_MB} MB gacha yuborsam bo'ladi.`
    );
    return false;
  }
  return true;
}

/** Soniyani 3:52 ko'rinishiga keltiradi. */
function formatDuration(seconds) {
  if (!seconds) return "";
  const min = Math.floor(seconds / 60);
  const sec = String(Math.floor(seconds % 60)).padStart(2, "0");
  return `${min}:${sec}`;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** "Lola - Bilmaysan" ko'rinishidagi sarlavhani ijrochi va nomga ajratadi. */
function splitTitle(item) {
  const clean = item.title
    .replace(/\((official|lyrics?|audio|video|hd|4k)[^)]*\)/gi, "")
    .replace(/\[(official|lyrics?|audio|video|hd|4k)[^\]]*\]/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  const parts = clean.split(/\s+[-–—]\s+/);
  if (parts.length >= 2) {
    return { artist: parts[0].trim(), title: parts.slice(1).join(" - ").trim() };
  }
  // Ajratib bo'lmasa: kanal nomini ijrochi deb olamiz
  const uploader = item.uploader.replace(/\s*-\s*Topic$/i, "").trim();
  return { artist: uploader || "Noma'lum", title: clean };
}

/** Fayl nomi uchun taqiqlangan belgilarni olib tashlaydi. */
function safeFileName(name) {
  return name.replace(/[\\/:*?"<>|]/g, "").slice(0, 80) || "audio";
}

/** Qidiruv natijalarini raqamlangan ro'yxat qilib chiqaradi. */
function buildResultsText(query, results) {
  const lines = [`<b>${escapeHtml(query)}</b>`, ""];
  results.forEach((item, index) => {
    const duration = formatDuration(item.duration);
    const mark = item.source === "soundcloud" ? "☁️ " : "";
    lines.push(
      `${index + 1}. ${mark}<i>${escapeHtml(item.title)}</i>` +
        (duration ? `  <code>${duration}</code>` : "")
    );
  });
  lines.push("", "Kerakli raqamni tanlang 👇");
  return lines.join("\n");
}

/** 1..10 raqamli tugmalarni ikki qatorda joylashtiradi. */
function buildResultsKeyboard(searchKey, count) {
  const buttons = [];
  for (let i = 0; i < count; i++) {
    buttons.push(Markup.button.callback(String(i + 1), `pick:${searchKey}:${i}`));
  }
  const rows = [];
  for (let i = 0; i < buttons.length; i += 5) {
    rows.push(buttons.slice(i, i + 5));
  }
  return Markup.inlineKeyboard(rows);
}

/** Audio faylni chiroyli nom va teglar bilan yuboradi. */
async function sendAudio(ctx, filePath, { title, artist, duration }) {
  return ctx.replyWithAudio(
    {
      source: filePath,
      filename: `${safeFileName(`${artist} - ${title}`)}.mp3`,
    },
    {
      title,
      performer: artist,
      ...(duration ? { duration: Math.floor(duration) } : {}),
    }
  );
}

/** Topilgan qo'shiq haqidagi xabarni mp3 tugmasi bilan yuboradi. */
async function replySongInfo(ctx, song) {
  const songKey = cacheSong(song);
  return ctx.reply(
    `\ud83c\udfb5 *${song.title}*\n\ud83d\udc64 ${song.artist}${
      song.songLink ? `\n\n${song.songLink}` : ""
    }`,
    {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        Markup.button.callback("\u2b07\ufe0f Mp3 yuklab olish", `song:${songKey}`),
      ]),
    }
  );
}

async function safeDeleteMessage(ctx, messageId) {
  try {
    await ctx.telegram.deleteMessage(ctx.chat.id, messageId);
  } catch {
    /* xabar allaqachon o'chirilgan bo'lishi mumkin */
  }
}

// ---------------------------------------------------------------------------
// Buyruqlar
// ---------------------------------------------------------------------------
const AUTHOR_URL = "https://t.me/milliydeveloper";

bot.start((ctx) =>
  ctx.reply(
    [
      `<a href="${AUTHOR_URL}">Alimardon</a>ning yuklovchi botiga xush kelibsiz 👋`,
      "",
      "🎬 Instagram yoki YouTube link yuboring — videoni yuklab beraman",
      "🎧 Ovozli xabar / video yuborsangiz — musiqasini topaman (Shazam kabi)",
      "🔎 Qo'shiq nomi yoki matnini yozsangiz — mp3 qilib yuboraman",
      "",
      "Video yuklangandan keyin, xohlasangiz, tagidagi tugma orqali",
      "fonidagi musiqani ham topib bera olaman.",
    ].join("\n"),
    { parse_mode: "HTML", link_preview_options: { is_disabled: true } }
  )
);

bot.help((ctx) =>
  ctx.reply(
    "/start - botni ishga tushirish\n\nLink yuboring, ovoz/video yuboring yoki qo'shiq nomini yozing."
  )
);

// ---------------------------------------------------------------------------
// Admin: barcha foydalanuvchilarga xabar yuborish
// Ishlatilishi: yubormoqchi bo'lgan xabaringizga (matn/rasm/video — istalgan
// turi) javob (reply) qilib /broadcast deb yozing.
// ---------------------------------------------------------------------------
function isAdmin(ctx) {
  const adminId = process.env.ADMIN_CHAT_ID;
  return Boolean(adminId) && String(ctx.from?.id) === String(adminId);
}

bot.command("broadcast", async (ctx) => {
  if (!isAdmin(ctx)) return; // oddiy foydalanuvchilarga sezilmasin

  const replied = ctx.message.reply_to_message;
  if (!replied) {
    return ctx.reply(
      "Yubormoqchi bo'lgan xabaringizga javob (reply) qilib /broadcast deb yozing."
    );
  }

  const ids = getAllUsers();
  const statusMsg = await ctx.reply(`📢 ${ids.length} ta foydalanuvchiga yuborilmoqda...`);

  let sent = 0;
  let failed = 0;
  for (const id of ids) {
    try {
      await ctx.telegram.copyMessage(id, ctx.chat.id, replied.message_id);
      sent++;
    } catch {
      failed++;
    }
    // Telegram'ning flood-limitiga tushmaslik uchun har xabardan keyin ozgina kutamiz
    await new Promise((resolve) => setTimeout(resolve, 40));
  }

  await ctx.telegram.editMessageText(
    ctx.chat.id,
    statusMsg.message_id,
    undefined,
    `✅ Yuborildi: ${sent} ta\n❌ Yetib bormadi: ${failed} ta`
  );
});

// ---------------------------------------------------------------------------
// 1. Link yuborilganda: faqat videoni yuklaymiz (tez!)
// ---------------------------------------------------------------------------
async function handleLink(ctx, url) {
  const startedAt = Date.now();

  // 1) Bu havola avval yuklanganmi? Unda qaytadan yuklamaymiz — bir zumda yuboramiz.
  const cachedFileId = getCachedFileId(url);
  if (cachedFileId) {
    try {
      const urlKey = cacheUrl(url);
      await ctx.replyWithVideo(cachedFileId, {
        caption: "⚡ Tayyor (keshdan)",
        supports_streaming: true,
        ...Markup.inlineKeyboard([
          Markup.button.callback("🎧 Musiqasini top", `musicurl:${urlKey}`),
        ]),
      });
      return;
    } catch {
      // Rasm bo'lishi mumkin — rasm sifatida yuborib ko'ramiz
      try {
        await ctx.replyWithPhoto(cachedFileId, { caption: "⚡ Tayyor (keshdan)" });
        return;
      } catch {
        console.warn("Keshdagi file_id ishlamadi, qaytadan yuklanmoqda.");
      }
    }
  }

  const statusMsg = await ctx.reply("⏳ Yuklanmoqda...");

  // Progressni Telegram'ga juda tez-tez yozmaymiz (cheklovga tushmaslik uchun)
  let lastEdit = 0;
  let lastShown = -1;
  const onProgress = (percent) => {
    const now = Date.now();
    const rounded = Math.floor(percent / 5) * 5;
    if (now - lastEdit < 3000 || rounded === lastShown) return;
    lastEdit = now;
    lastShown = rounded;
    ctx.telegram
      .editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        undefined,
        `⏳ Yuklanmoqda... ${rounded}%`
      )
      .catch(() => {});
  };

  let items = [];
  try {
    items = await downloadMedia(url, onProgress);

    // Juda katta fayllarni chiqarib tashlaymiz
    items = items.filter((item) => {
      if (fs.statSync(item.path).size <= MAX_FILE_SIZE_BYTES) return true;
      cleanupFile(item.path);
      return false;
    });

    if (!items.length) {
      return ctx.reply(
        `📦 Fayl(lar) juda katta. Telegram orqali ${MAX_FILE_SIZE_MB} MB gacha yuborsam bo'ladi.`
      );
    }

    await ctx.telegram
      .editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        undefined,
        "📤 Telegram'ga yuborilmoqda..."
      )
      .catch(() => {});

    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    const caption = `✅ Tayyor (${seconds} s)`;

    // --- Bir nechta fayl (karusel) → albom qilib yuboramiz ---
    if (items.length > 1) {
      // width/height bermasak, Telegram nisbatni o'zi taxmin qiladi —
      // tik (portrait) videolar albomda cho'zilib noto'g'ri ko'rinadi.
      const media = await Promise.all(
        items.slice(0, 10).map(async (item, index) => ({
          type: item.type === "video" ? "video" : "photo",
          media: { source: item.path },
          ...(item.type === "video" ? await getVideoMetadata(item.path) : {}),
          ...(index === 0 ? { caption } : {}),
        }))
      );
      await ctx.replyWithMediaGroup(media);
      return;
    }

    // --- Bitta fayl ---
    const single = items[0];

    if (single.type === "photo") {
      const sent = await ctx.replyWithPhoto({ source: single.path }, { caption });
      const fileId = sent?.photo?.at(-1)?.file_id;
      if (fileId) setCachedFileId(url, fileId);
      return;
    }

    // width/height/duration bermasak, Telegram nisbatni o'zi taxmin qiladi —
    // buning natijasida tik (portrait) videolar cho'zilib noto'g'ri ko'rinadi.
    const meta = await getVideoMetadata(single.path);

    const key = cacheMedia(single.path);
    const sent = await ctx.replyWithVideo(
      { source: single.path },
      {
        ...meta,
        caption,
        supports_streaming: true,
        ...Markup.inlineKeyboard([
          Markup.button.callback("🎧 Musiqasini top", `music:${key}`),
        ]),
      }
    );

    // Keyingi safar uchun saqlab qo'yamiz
    if (sent?.video?.file_id) {
      setCachedFileId(url, sent.video.file_id);
    }
    return;
  } catch (e) {
    await ctx.reply(toUserMessage(e, "media yuklash"));
    notifyAdmin(ctx.telegram, e, "media yuklash");
  } finally {
    // mediaCache ga berilgan video keyinroq o'chiriladi, qolganini hozir tozalaymiz
    for (const item of items) {
      const inCache = [...mediaCache.values()].some((v) => v.filePath === item.path);
      if (!inCache) cleanupFile(item.path);
    }
    await safeDeleteMessage(ctx, statusMsg.message_id);
  }
}

// ---------------------------------------------------------------------------
// 2. "Musiqasini top" tugmasi bosilganda
// ---------------------------------------------------------------------------
bot.action(/^music:(.+)$/, async (ctx) => {
  const key = ctx.match[1];
  const cached = mediaCache.get(key);

  await ctx.answerCbQuery();

  if (!cached || !fs.existsSync(cached.filePath)) {
    return ctx.reply("⏱ Vaqt o'tib ketdi. Havolani qaytadan yuboring.");
  }

  const statusMsg = await ctx.reply("🎧 Musiqa aniqlanmoqda...");
  let audioPath;
  try {
    audioPath = await extractAudioFromVideo(cached.filePath);
    const song = await recognizeAudio(audioPath);

    if (!song) {
      return ctx.reply("😕 Fonidagi musiqani aniqlab bo'lmadi.");
    }

    await replySongInfo(ctx, song);
  } catch (e) {
    await ctx.reply(toUserMessage(e, "musiqa aniqlash"));
    notifyAdmin(ctx.telegram, e, "musiqa aniqlash");
  } finally {
    if (audioPath) cleanupFile(audioPath);
    await safeDeleteMessage(ctx, statusMsg.message_id);
  }
});

// ---------------------------------------------------------------------------
// 2b. Keshdan kelgan video uchun "Musiqasini top" — havoladan qisqa parcha olamiz
// ---------------------------------------------------------------------------
bot.action(/^musicurl:(.+)$/, async (ctx) => {
  const key = ctx.match[1];
  const cached = urlCache.get(key);

  await ctx.answerCbQuery();

  if (!cached) {
    return ctx.reply("⏱ Vaqt o'tib ketdi. Havolani qaytadan yuboring.");
  }

  const statusMsg = await ctx.reply("🎧 Musiqa aniqlanmoqda...");
  let audioPath;
  try {
    audioPath = await downloadAudioClip(cached.url);
    const song = await recognizeAudio(audioPath);

    if (!song) {
      return ctx.reply("😕 Fonidagi musiqani aniqlab bo'lmadi.");
    }

    await replySongInfo(ctx, song);
  } catch (e) {
    await ctx.reply(toUserMessage(e, "musiqa aniqlash"));
    notifyAdmin(ctx.telegram, e, "musiqa aniqlash");
  } finally {
    if (audioPath) cleanupFile(audioPath);
    await safeDeleteMessage(ctx, statusMsg.message_id);
  }
});

// ---------------------------------------------------------------------------
// 3. "Mp3 yuklab olish" tugmasi bosilganda
// ---------------------------------------------------------------------------
bot.action(/^song:(.+)$/, async (ctx) => {
  const key = ctx.match[1];
  const song = songCache.get(key);

  await ctx.answerCbQuery();

  if (!song) {
    return ctx.reply("⏱ Vaqt o'tib ketdi. Qaytadan urinib ko'ring.");
  }

  const statusMsg = await ctx.reply("⏳ Mp3 yuklanmoqda...");
  let audioPath;
  try {
    audioPath = await searchAndDownloadAudio(`${song.artist} ${song.title}`);
    if (!checkFileSize(audioPath, ctx)) return;

    await sendAudio(ctx, audioPath, { title: song.title, artist: song.artist });
  } catch (e) {
    await ctx.reply(toUserMessage(e, "mp3 yuklash"));
    notifyAdmin(ctx.telegram, e, "mp3 yuklash");
  } finally {
    if (audioPath) cleanupFile(audioPath);
    await safeDeleteMessage(ctx, statusMsg.message_id);
  }
});

// ---------------------------------------------------------------------------
// 4. Matn: link bo'lsa video, aks holda qo'shiq qidiruvi
// ---------------------------------------------------------------------------
bot.on("text", async (ctx) => {
  const text = ctx.message.text.trim();
  if (text.startsWith("/")) return;

  if (isUrl(text)) {
    if (isInstagramUrl(text) || isYoutubeUrl(text)) {
      return handleLink(ctx, text);
    }
    return ctx.reply(
      "🤔 Bu havolani tanimadim. Instagram yoki YouTube havolasini yuboring."
    );
  }

  const statusMsg = await ctx.reply("🔎 Qidirilmoqda...");
  try {
    // Matn qo'shiq so'zlari bo'lishi mumkin — avval nomini aniqlaymiz
    const { searchQuery } = await findSongByText(text);
    const results = await searchCandidates(searchQuery, 10);

    if (!results.length) {
      return ctx.reply("🔍 Hech narsa topilmadi. Boshqacha yozib ko'ring.");
    }

    // Tartibni o'zgartirmaymiz — YouTube'ning o'z moslik tartibi eng yaxshisi.
    // (Rasmiy "- Topic" yozuvlari ko'pincha DRM bilan himoyalangan bo'ladi.)
    const searchKey = cacheSearch(text, results);
    await ctx.reply(buildResultsText(text, results), {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      ...buildResultsKeyboard(searchKey, results.length),
    });
  } catch (e) {
    await ctx.reply(toUserMessage(e, "qo'shiq qidirish"));
    notifyAdmin(ctx.telegram, e, "qo'shiq qidirish");
  } finally {
    await safeDeleteMessage(ctx, statusMsg.message_id);
  }
});

// ---------------------------------------------------------------------------
// 4b. Ro'yxatdan raqam tanlanganda: o'sha qo'shiqni mp3 qilib yuboramiz
// ---------------------------------------------------------------------------
bot.action(/^pick:([^:]+):(\d+)$/, async (ctx) => {
  const [, searchKey, indexStr] = ctx.match;
  const search = searchCache.get(searchKey);

  await ctx.answerCbQuery();

  if (!search) {
    return ctx.reply("⏱ Vaqt o'tib ketdi. Qaytadan qidiring.");
  }

  const item = search.results[Number(indexStr)];
  if (!item) return;

  const { title, artist } = splitTitle(item);

  // Bu qo'shiq avval yuborilganmi? Unda qaytadan yuklamaymiz.
  const cachedAudioId = getCachedFileId(item.url);
  if (cachedAudioId) {
    try {
      await ctx.replyWithAudio(cachedAudioId, { title, performer: artist });
      return;
    } catch {
      console.warn("Keshdagi audio file_id ishlamadi, qaytadan yuklanmoqda.");
    }
  }

  const statusMsg = await ctx.reply(`⏳ Yuklanmoqda: ${item.title}`);
  let audioPath;
  try {
    try {
      audioPath = await downloadAudioByUrl(item.url);
    } catch (e) {
      // Aynan shu havola ishlamasa (masalan DRM) — ro'yxatdagi BOSHQA
      // qo'shiqqa o'tmaymiz, faqat xuddi shu qo'shiqning boshqa
      // yuklamasini (nomi/ijrochisi bo'yicha) qidirib topamiz.
      console.warn(
        `⚠ Tanlangan havola ishlamadi (${e.message.slice(0, 80)}), xuddi shu qo'shiqning boshqa manbasi sinalmoqda...`
      );
      audioPath = await searchAndDownloadAudio(`${artist} ${title}`);
    }
    if (!checkFileSize(audioPath, ctx)) return;

    const sent = await sendAudio(ctx, audioPath, {
      title,
      artist,
      duration: item.duration,
    });
    if (sent?.audio?.file_id) {
      setCachedFileId(item.url, sent.audio.file_id);
    }
  } catch (e) {
    // Ro'yxat xabari o'chirilmaydi — foydalanuvchi boshqa raqamni bosa oladi
    await ctx.reply(toUserMessage(e, "mp3 yuklash"));
    notifyAdmin(ctx.telegram, e, "mp3 yuklash");
  } finally {
    if (audioPath) cleanupFile(audioPath);
    await safeDeleteMessage(ctx, statusMsg.message_id);
  }
});

// ---------------------------------------------------------------------------
// 5. Ovoz / audio / video yuborilganda: musiqani aniqlash
// ---------------------------------------------------------------------------
async function handleMediaRecognition(ctx, fileId, extension) {
  const statusMsg = await ctx.reply("🎧 Musiqa aniqlanmoqda...");
  let localPath;
  try {
    const link = await ctx.telegram.getFileLink(fileId);
    const response = await axios.get(link.href, { responseType: "arraybuffer" });

    localPath = path.join(DOWNLOADS_DIR, `${randomUUID()}.${extension}`);
    fs.writeFileSync(localPath, response.data);

    const song = await recognizeAudio(localPath);
    if (!song) {
      return ctx.reply(
        "😕 Musiqani aniqlab bo'lmadi. Boshqa parcha bilan urinib ko'ring."
      );
    }

    await replySongInfo(ctx, song);
  } catch (e) {
    await ctx.reply(toUserMessage(e, "media aniqlash"));
    notifyAdmin(ctx.telegram, e, "media aniqlash");
  } finally {
    if (localPath) cleanupFile(localPath);
    await safeDeleteMessage(ctx, statusMsg.message_id);
  }
}

bot.on("voice", (ctx) => handleMediaRecognition(ctx, ctx.message.voice.file_id, "ogg"));
bot.on("audio", (ctx) => handleMediaRecognition(ctx, ctx.message.audio.file_id, "mp3"));
bot.on("video", (ctx) => handleMediaRecognition(ctx, ctx.message.video.file_id, "mp4"));
bot.on("video_note", (ctx) =>
  handleMediaRecognition(ctx, ctx.message.video_note.file_id, "mp4")
);

// ---------------------------------------------------------------------------
// Ishga tushirishdan oldin muhitni tekshirish
// ---------------------------------------------------------------------------
async function preflight() {
  // Oldingi ishga tushganda diskda qolib ketgan eski fayllarni tozalaymiz
  sweepOldDownloads(CACHE_TTL_MS);

  const ytdlp = await checkYtdlp();
  if (ytdlp.ok) {
    console.log(`✔ yt-dlp topildi (${ytdlp.version})`);
  } else {
    console.error("✖ yt-dlp topilmadi! Tuzatish: npm run setup");
  }

  const ffmpeg = await checkFfmpeg();
  if (ffmpeg.ok) {
    console.log(`✔ ffmpeg topildi\n  ${ffmpeg.path}`);
  } else {
    console.error("✖ ffmpeg topilmadi! Tuzatish: npm run setup");
  }

  if (!process.env.AUDD_API_TOKEN) {
    console.warn("⚠ AUDD_API_TOKEN sozlanmagan — musiqani tanish ishlamaydi.");
  }

  console.log(
    hasCookiesConfigured()
      ? "✔ Instagram cookie sozlangan (story va yopiq postlar ishlaydi)"
      : "ℹ Instagram cookie sozlanmagan — story va yopiq postlar ishlamaydi"
  );

  if (cacheSize() > 0) {
    console.log(`✔ Keshda ${cacheSize()} ta tayyor video bor`);
  }

  console.log(`✔ Ro'yxatda ${userCount()} ta foydalanuvchi bor (/broadcast uchun)`);

  if (!process.env.ADMIN_CHAT_ID) {
    console.warn(
      "⚠ ADMIN_CHAT_ID sozlanmagan — /broadcast buyrug'i hech kim uchun ishlamaydi."
    );
  }
}

preflight().then(() => {
  // bot.launch() promise'i bot to'xtaganda hal bo'ladi, shuning uchun
  // xabarni kutmasdan chiqaramiz.
  bot.launch().catch((err) => {
    console.error("\n❌ Bot ishga tushmadi:", err.message);
    console.error("  BOT_TOKEN to'g'ri ekanini va internet borligini tekshiring.");
    process.exit(1);
  });
  console.log("\n✅ Bot ishga tushdi. To'xtatish uchun: Ctrl+C");
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
