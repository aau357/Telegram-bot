# Video &amp; Musiqa Telegram Bot

Instagram va YouTube'dan video yuklab beradigan, videodagi fon musiqasini
(Shazam kabi) tanib oladigan va qo'shiq nomi/matni bo'yicha qidirib
mp3 topib beradigan Telegram bot. Backend — Node.js (Telegraf), frontend
(ixtiyoriy boshqaruv/mini-app) — React.

## Loyiha tuzilishi

```
telegram-video-music-bot/
├── bot/                  # Telegram bot + REST API (Node.js)
│   ├── src/
│   │   ├── index.js      # Bot (asosiy fayl — shuni ishga tushirasiz)
│   │   ├── api.js        # React mini-app uchun REST API (ixtiyoriy)
│   │   ├── downloader.js # yt-dlp orqali video/audio yuklash
│   │   ├── ytdlp.js      # yt-dlp dasturini topish va ishga tushirish
│   │   └── recognizer.js # AudD.io orqali musiqani tanib olish
│   ├── scripts/
│   │   └── get-ytdlp.js  # yt-dlp ni yuklab oluvchi skript (npm run setup)
│   ├── bin/              # yt-dlp shu yerga yuklanadi
│   ├── .env.example
│   └── package.json
└── miniapp/              # React frontend (Telegram Mini App sifatida ham ishlaydi)
    ├── src/App.jsx
    └── package.json
```

## Qanday ishlaydi

1. **Link yuborilsa** (Instagram yoki YouTube) → bot videoni yuklab beradi,
   so'ng undan audio ajratib, fondagi musiqani AudD.io orqali aniqlaydi va
   topilgan qo'shiqni mp3 holida alohida yuboradi.
2. **Ovozli xabar / audio / video yuborilsa** → to'g'ridan-to'g'ri o'sha
   audio bo'yicha musiqa aniqlanadi (Shazam kabi).
3. **Oddiy matn yuborilsa** (qo'shiq nomi yoki matni/lyrics) → bot (agar
   Genius kaliti bo'lsa) eng mos qo'shiqni topadi, keyin uni YouTube'dan
   qidirib, mp3 qilib yuboradi.

`miniapp/` — bu ixtiyoriy React ilova. U botdagi barcha funksiyalarni
veb-interfeys orqali (yoki Telegram Mini App sifatida bot ichida) taqdim
etadi va `bot/src/api.js` orqali ishlaydigan API'ga so'rov yuboradi.

## 1-qadam: Kerakli narsalarni tayyorlash

- **Node.js 18+** (sizda allaqachon bor bo'lishi kerak)
- **ffmpeg** — video/audio konvertatsiya uchun. O'rnatish:
  - Windows: https://ffmpeg.org/download.html dan yuklab, PATH'ga qo'shing
  - Mac: `brew install ffmpeg`
  - Linux: `sudo apt install ffmpeg`
- **Telegram bot tokeni** — Telegram'da [@BotFather](https://t.me/BotFather)
  ga yozib, `/newbot` orqali oling.
- **AudD.io API kaliti** — musiqani tanib olish uchun.
  https://dashboard.audd.io/ da ro'yxatdan o'ting (bepul tarif mavjud,
  cheklangan so'rovlar bilan). Kalitni oling.
- *(Ixtiyoriy)* **Genius API tokeni** — qo'shiq matni/lyrics bo'yicha
  qidiruvni aniqroq qilish uchun: https://genius.com/api-clients

## 2-qadam: Botni o'rnatish va ishga tushirish

```bash
cd "D:\Telegram bot\bot"
npm install       # npm paketlari
npm run setup     # yt-dlp dasturini yuklab oladi (bin/ papkasiga)
```

Keyin `.env` faylini yarating (`.env.example` dan nusxa olib) va to'ldiring:

```
BOT_TOKEN=BotFather_bergan_token
AUDD_API_TOKEN=audd.io_dan_olingan_token
GENIUS_ACCESS_TOKEN=   # ixtiyoriy, bo'sh qoldirsa ham bo'ladi
```

Botni ishga tushirish:

```bash
npm start
```

Ishga tushganda bot avval muhitni tekshiradi va `✔ yt-dlp topildi`,
`✔ ffmpeg topildi` deb yozadi. Agar `✖` belgisi chiqsa, o'sha dastur
o'rnatilmagan — pastdagi bo'limga qarang.

### yt-dlp yoki ffmpeg topilmasa

**yt-dlp:** `npm run setup` buyrug'i uni GitHub relizidan `bot/bin/`
papkasiga yuklab oladi. Agar internet cheklovi tufayli ishlamasa, faylni
qo'lda yuklang: https://github.com/yt-dlp/yt-dlp/releases/latest —
Windows uchun `yt-dlp.exe` ni olib, `bot/bin/` papkasiga tashlang.
Yoki tizimga o'rnatib qo'ysangiz ham bo'ladi: `winget install yt-dlp`.

**ffmpeg:** Windows'da eng oson yo'li — `winget install Gyan.FFmpeg`.
So'ng terminalni yopib qayta oching va `ffmpeg -version` bilan
tekshiring. Muqobil variant: https://ffmpeg.org/download.html dan
yuklab, `bin` papkasini PATH ga qo'shish.

Konsolda `✅ Bot ishga tushdi (polling rejimida).` chiqsa — tayyor!
Endi Telegram'da botingizga o'ting va `/start` bosing.

## 3-qadam (ixtiyoriy): React mini-app'ni ishga tushirish

Avval API serverni ishga tushiring (bot bilan bir vaqtda, alohida
terminalda):

```bash
cd telegram-video-music-bot/bot
npm run api
```

Keyin React ilovani:

```bash
cd telegram-video-music-bot/miniapp
npm install
cp .env.example .env
npm run dev
```

Brauzerda `http://localhost:5173` ochiladi — u yerda link yuklash, qo'shiq
qidirish va audio orqali musiqa aniqlashni sinab ko'rishingiz mumkin.

### Buni haqiqiy Telegram Mini App qilish

Bot ichida tugma sifatida ochish uchun React ilovani (build qilib) biror
HTTPS manzilga joylashtirishingiz kerak (masalan Vercel/Netlify — bepul),
so'ng [@BotFather](https://t.me/BotFather) orqali `/newapp` yoki
`/mybots → Bot Settings → Menu Button` bo'limida shu URL'ni belgilaysiz.
Xohlasangiz, keyingi qadam sifatida shu qismni ham birga sozlab beraman.

## Cheklovlar va eslatmalar

- Instagram'dagi ba'zi (masalan, faqat login qilingandan keyin ko'rinadigan
  yoki himoyalangan) postlarni yuklab bo'lmasligi mumkin — bunday holda
  brauzer cookie faylini (`cookies.txt`) qo'shish kerak bo'ladi
  (`downloader.js` faylida shu joy izohlab qo'yilgan).
- Telegram bot API orqali 50 MB dan katta faylni yuborib bo'lmaydi
  (`.env`dagi `MAX_FILE_SIZE_MB` shuni nazorat qiladi).
- AudD.io bepul tarifida so'rovlar soni cheklangan; ko'p foydalanish uchun
  pullik tarifga o'tish kerak bo'lishi mumkin.
- Boshqalarning mualliflik huquqi bilan himoyalangan video/musiqasini
  yuklab olish va tarqatish mualliflik huquqi qoidalariga bog'liq —
  botdan faqat shaxsiy va qonuniy maqsadlarda foydalaning.
