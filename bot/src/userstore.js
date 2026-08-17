// Bot bilan yozishgan barcha foydalanuvchilar ro'yxati — /broadcast buyrug'i
// shu ro'yxatdagi hammaga xabar yuborish uchun ishlatiladi.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USERS_FILE = path.join(__dirname, "..", "users.json");

let users = new Set();
try {
  if (fs.existsSync(USERS_FILE)) {
    users = new Set(JSON.parse(fs.readFileSync(USERS_FILE, "utf8")));
  }
} catch (e) {
  console.warn("⚠ Foydalanuvchilar ro'yxatini o'qib bo'lmadi:", e.message);
}

let saveTimer = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.writeFileSync(USERS_FILE, JSON.stringify([...users]));
    } catch (e) {
      console.warn("⚠ Foydalanuvchilar ro'yxatini saqlab bo'lmadi:", e.message);
    }
  }, 2000);
}

function rememberUser(id) {
  if (users.has(id)) return;
  users.add(id);
  scheduleSave();
}

function getAllUsers() {
  return [...users];
}

function userCount() {
  return users.size;
}

export { rememberUser, getAllUsers, userCount };
