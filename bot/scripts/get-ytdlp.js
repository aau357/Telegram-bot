// yt-dlp dasturini to'g'ridan-to'g'ri GitHub relizidan yuklab oladi.
// GitHub API ishlatilmaydi (shuning uchun "rate limit" xatosi chiqmaydi).
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { downloadWithProgress, formatMb } from "./download.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN_DIR = path.join(__dirname, "..", "bin");

const platform = os.platform();
const asset =
  platform === "win32"
    ? "yt-dlp.exe"
    : platform === "darwin"
    ? "yt-dlp_macos"
    : "yt-dlp";

const targetName = platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
const targetPath = path.join(BIN_DIR, targetName);
const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`;

// `npm run update` — mavjud bo'lsa ham qayta yuklaydi
const force = process.argv.includes("--force");

async function main() {
  fs.mkdirSync(BIN_DIR, { recursive: true });

  if (fs.existsSync(targetPath) && !force) {
    console.log(`✔ yt-dlp allaqachon mavjud: ${targetPath}`);
    console.log("  Yangilash uchun: npm run update");
    return;
  }

  if (force && fs.existsSync(targetPath)) {
    console.log("Eski versiya o'chirilmoqda...");
    fs.rmSync(targetPath, { force: true });
  }

  console.log(`yt-dlp yuklanmoqda...\n  ${url}\n`);
  const size = await downloadWithProgress(url, targetPath);

  if (platform !== "win32") {
    fs.chmodSync(targetPath, 0o755);
  }
  console.log(`✅ Tayyor: ${targetPath} (${formatMb(size)} MB)`);
}

main().catch((err) => {
  console.error("\n❌ Xatolik:", err.message);
  console.error(
    "\nQo'lda yuklash yo'li:\n" +
      `  1) Brauzerda oching: ${url}\n` +
      `  2) Yuklangan faylni shu papkaga saqlang: ${BIN_DIR}\n` +
      "\nYoki PowerShell orqali:\n" +
      `  Invoke-WebRequest -Uri "${url}" -OutFile "${targetPath}"`
  );
  process.exit(1);
});
