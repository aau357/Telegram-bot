// Muhitni tekshirish: yt-dlp, ffmpeg, ffprobe va .env sozlamalari.
import "dotenv/config";
import {
  checkYtdlp,
  checkFfmpeg,
  resolveFfprobe,
  runFfprobe,
} from "../src/ytdlp.js";

console.log("=== Muhit tekshiruvi ===\n");

const ytdlp = await checkYtdlp();
console.log(
  ytdlp.ok
    ? `✔ yt-dlp    ${ytdlp.version}\n            ${ytdlp.path}`
    : `✖ yt-dlp    topilmadi — ${ytdlp.error}`
);

const ffmpeg = await checkFfmpeg();
console.log(
  ffmpeg.ok
    ? `✔ ffmpeg    ${ffmpeg.version}\n            ${ffmpeg.path}`
    : `✖ ffmpeg    topilmadi — ${ffmpeg.error}`
);

try {
  await runFfprobe(["-version"]);
  console.log(`✔ ffprobe   ${resolveFfprobe()}`);
} catch (e) {
  console.log(`✖ ffprobe   topilmadi — ${e.message}`);
}

console.log(
  `\n${process.env.BOT_TOKEN ? "✔" : "✖"} BOT_TOKEN        ${
    process.env.BOT_TOKEN ? "sozlangan" : "yo'q"
  }`
);
console.log(
  `${process.env.AUDD_API_TOKEN ? "✔" : "✖"} AUDD_API_TOKEN   ${
    process.env.AUDD_API_TOKEN ? "sozlangan" : "yo'q"
  }`
);

const cookieFile = process.env.INSTAGRAM_COOKIES_FILE;
const cookieBrowser = process.env.COOKIES_FROM_BROWSER;
const fsMod = await import("fs");

if (cookieFile && fsMod.existsSync(cookieFile)) {
  console.log(`\u2714 Instagram cookie  fayl: ${cookieFile}`);
} else if (cookieBrowser) {
  console.log(`\u2714 Instagram cookie  brauzer: ${cookieBrowser}`);
} else {
  console.log(
    "\u2716 Instagram cookie  sozlanmagan \u2014 story va yopiq postlar ishlamaydi"
  );
}

if (!ffmpeg.ok) {
  console.log(
    "\nffmpeg topilmasa, videolar ovozsiz kelishi mumkin.\n" +
      "Tuzatish: npm run setup   yoki   winget install Gyan.FFmpeg\n" +
      "Agar o'rnatilgan bo'lsa-yu topilmasa, .env ga to'liq yo'lni yozing:\n" +
      "  FFMPEG_PATH=C:\\...\\ffmpeg.exe"
  );
}
