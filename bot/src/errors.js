// Texnik xatolarni foydalanuvchiga tushunarli, sodda matnga aylantiradi.
//
// Foydalanuvchi hech qachon `npm run setup`, "ffmpeg topilmadi", "HTTP 403"
// kabi narsalarni ko'rmasligi kerak — bular faqat konsolga yoziladi.

const RULES = [
  {
    // Nusxa ko'chirishdan himoyalangan yozuvlar — yuklab bo'lmaydi
    test: /DRM|protected content/i,
    message:
      "🔒 Bu variant himoyalangan — yuklab bo'lmaydi.\nRo'yxatdan boshqa raqamni bosing.",
  },
  {
    // Bot muhitidagi nosozlik — foydalanuvchining aybi emas
    test: /yt-dlp topilmadi|ffmpeg topilmadi|ffprobe topilmadi|ENOENT|npm run setup/i,
    message:
      "⚠️ Botda vaqtinchalik texnik nosozlik. Iltimos, birozdan keyin urinib ko'ring.",
  },
  {
    // Yopiq / o'chirilgan Instagram postlari
    test: /login required|private|not available|rate-limit reached|empty media response|requested content is not available/i,
    message:
      "🔒 Bu post yopiq yoki o'chirilgan. Ochiq havola yuboring.",
  },
  {
    test: /Video unavailable|This video is not available|removed by the user|does not exist|404/i,
    message: "🔍 Video topilmadi — o'chirilgan yoki havola noto'g'ri bo'lishi mumkin.",
  },
  {
    test: /age.?restricted|confirm your age/i,
    message: "🔞 Bu video yosh chekloviga ega, shuning uchun yuklab bo'lmadi.",
  },
  {
    test: /Unsupported URL|is not a valid URL/i,
    message: "🤔 Bu havolani tanimadim. Instagram yoki YouTube havolasini yuboring.",
  },
  {
    test: /403|Forbidden|Sign in to confirm|unable to download video data/i,
    message:
      "😔 Hozir bu videoni yuklab bo'lmadi. Birozdan keyin qayta urinib ko'ring.",
  },
  {
    test: /timed? out|ETIMEDOUT|ECONNRESET|ENOTFOUND|network/i,
    message: "🌐 Internet aloqasida muammo bo'ldi. Qaytadan urinib ko'ring.",
  },
  {
    test: /AUDD_API_TOKEN|api_token/i,
    message: "⚠️ Musiqa tanish xizmati hozir ishlamayapti. Keyinroq urinib ko'ring.",
  },
];

const DEFAULT_MESSAGE =
  "😔 Amalga oshmadi. Birozdan keyin qayta urinib ko'ring.";

/**
 * Xatoni foydalanuvchiga ko'rsatiladigan matnga aylantiradi.
 * Texnik tafsilot konsolga yoziladi.
 */
function toUserMessage(error, context = "") {
  const raw = error?.message || String(error);
  console.error(`[xato]${context ? ` ${context}:` : ""} ${raw}`);

  for (const rule of RULES) {
    if (rule.test.test(raw)) return rule.message;
  }
  return DEFAULT_MESSAGE;
}

/**
 * Agar .env da ADMIN_CHAT_ID ko'rsatilgan bo'lsa, texnik tafsilotni
 * bot egasiga yuboradi (foydalanuvchi buni ko'rmaydi).
 */
async function notifyAdmin(telegram, error, context = "") {
  const adminId = process.env.ADMIN_CHAT_ID;
  if (!adminId) return;
  const raw = error?.message || String(error);
  try {
    await telegram.sendMessage(
      adminId,
      `🐞 Xato${context ? ` (${context})` : ""}:\n\`\`\`\n${raw.slice(0, 3000)}\n\`\`\``,
      { parse_mode: "Markdown" }
    );
  } catch {
    /* admin xabarini yubora olmasak, jim o'tamiz */
  }
}

export { toUserMessage, notifyAdmin };
