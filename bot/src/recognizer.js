import axios from "axios";
import fs from "fs";
import FormData from "form-data";

const AUDD_API_URL = "https://api.audd.io/";
const GENIUS_API_URL = "https://api.genius.com/search";

/**
 * Audio/video faylni AudD.io ga yuborib, qo'shiqni (Shazam kabi) tanib oladi.
 * @param {string} filePath - audio yoki video fayl yo'li
 * @returns {Promise<{title: string, artist: string, song_link?: string} | null>}
 */
async function recognizeAudio(filePath) {
  const apiToken = process.env.AUDD_API_TOKEN;
  if (!apiToken) {
    throw new Error(
      "AUDD_API_TOKEN sozlanmagan. .env faylida AudD.io API kalitini kiriting."
    );
  }

  const form = new FormData();
  form.append("api_token", apiToken);
  form.append("file", fs.createReadStream(filePath));
  form.append("return", "spotify,apple_music");

  const { data } = await axios.post(AUDD_API_URL, form, {
    headers: form.getHeaders(),
    maxBodyLength: Infinity,
  });

  if (data.status !== "success" || !data.result) {
    return null;
  }

  return {
    title: data.result.title,
    artist: data.result.artist,
    album: data.result.album,
    songLink: data.result.song_link,
  };
}

/**
 * Qo'shiq nomi yoki matn (lyrics) bo'yicha Genius orqali eng mos qo'shiqni topadi.
 * Bu YouTube qidiruvi uchun aniqroq so'rov (artist + title) tayyorlaydi.
 */
async function findSongByText(query) {
  const token = process.env.GENIUS_ACCESS_TOKEN;
  if (!token) {
    // Genius sozlanmagan bo'lsa, so'zni to'g'ridan-to'g'ri YouTube qidiruviga beramiz
    return { searchQuery: query, matched: false };
  }

  try {
    const { data } = await axios.get(GENIUS_API_URL, {
      params: { q: query },
      headers: { Authorization: `Bearer ${token}` },
    });

    const hit = data?.response?.hits?.[0]?.result;
    if (!hit) {
      return { searchQuery: query, matched: false };
    }

    const searchQuery = `${hit.primary_artist?.name || ""} ${hit.title || ""}`.trim();
    return {
      searchQuery,
      matched: true,
      title: hit.title,
      artist: hit.primary_artist?.name,
    };
  } catch {
    return { searchQuery: query, matched: false };
  }
}

export { recognizeAudio, findSongByText };
