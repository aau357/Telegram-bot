import { useState } from "react";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:3001";

const TABS = [
  { id: "download", label: "🎬 Video yuklash" },
  { id: "search", label: "🔎 Qo'shiq qidirish" },
  { id: "recognize", label: "🎧 Musiqani aniqlash" },
];

export default function App() {
  const [tab, setTab] = useState("download");

  return (
    <div style={styles.page}>
      <h1 style={styles.title}>Video &amp; Musiqa Bot</h1>
      <div style={styles.tabs}>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              ...styles.tabButton,
              ...(tab === t.id ? styles.tabButtonActive : {}),
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "download" && <DownloadTab />}
      {tab === "search" && <SearchTab />}
      {tab === "recognize" && <RecognizeTab />}
    </div>
  );
}

function DownloadTab() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [videoUrl, setVideoUrl] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setVideoUrl("");
    try {
      const res = await fetch(`${API_BASE}/api/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Xatolik yuz berdi");
      setVideoUrl(data.videoUrl);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.card}>
      <form onSubmit={handleSubmit} style={styles.form}>
        <input
          style={styles.input}
          placeholder="Instagram yoki YouTube link"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
        />
        <button style={styles.button} disabled={loading}>
          {loading ? "Yuklanmoqda..." : "Yuklab olish"}
        </button>
      </form>
      {error && <p style={styles.error}>{error}</p>}
      {videoUrl && (
        <video src={videoUrl} controls style={styles.media} />
      )}
    </div>
  );
}

function SearchTab() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/search-song`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Xatolik yuz berdi");
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.card}>
      <form onSubmit={handleSubmit} style={styles.form}>
        <input
          style={styles.input}
          placeholder="Qo'shiq nomi yoki matni"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          required
        />
        <button style={styles.button} disabled={loading}>
          {loading ? "Qidirilmoqda..." : "Qidirish"}
        </button>
      </form>
      {error && <p style={styles.error}>{error}</p>}
      {result && (
        <div>
          {result.title && (
            <p>
              🎵 <strong>{result.title}</strong> — {result.artist}
            </p>
          )}
          <audio src={result.audioUrl} controls style={styles.media} />
        </div>
      )}
    </div>
  );
}

function RecognizeTab() {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [song, setSong] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!file) return;
    setLoading(true);
    setError("");
    setSong(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`${API_BASE}/api/recognize`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Xatolik yuz berdi");
      setSong(data.song);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.card}>
      <form onSubmit={handleSubmit} style={styles.form}>
        <input
          type="file"
          accept="audio/*,video/*"
          onChange={(e) => setFile(e.target.files[0])}
          required
        />
        <button style={styles.button} disabled={loading}>
          {loading ? "Aniqlanmoqda..." : "Musiqani aniqlash"}
        </button>
      </form>
      {error && <p style={styles.error}>{error}</p>}
      {song ? (
        <p>
          🎵 <strong>{song.title}</strong> — {song.artist}
        </p>
      ) : (
        song === null &&
        !loading &&
        !error && <p style={{ color: "#888" }}>Audio yoki video fayl tanlang</p>
      )}
    </div>
  );
}

const styles = {
  page: {
    fontFamily: "system-ui, sans-serif",
    maxWidth: 480,
    margin: "0 auto",
    padding: 16,
  },
  title: { fontSize: 20, textAlign: "center", marginBottom: 12 },
  tabs: { display: "flex", gap: 8, marginBottom: 16 },
  tabButton: {
    flex: 1,
    padding: "8px 4px",
    fontSize: 12,
    border: "1px solid #ddd",
    borderRadius: 8,
    background: "#f5f5f5",
    cursor: "pointer",
  },
  tabButtonActive: { background: "#2b7cff", color: "#fff", borderColor: "#2b7cff" },
  card: { border: "1px solid #eee", borderRadius: 12, padding: 16 },
  form: { display: "flex", flexDirection: "column", gap: 8 },
  input: { padding: 10, borderRadius: 8, border: "1px solid #ccc", fontSize: 14 },
  button: {
    padding: 10,
    borderRadius: 8,
    border: "none",
    background: "#2b7cff",
    color: "#fff",
    fontSize: 14,
    cursor: "pointer",
  },
  error: { color: "#d33", fontSize: 13 },
  media: { width: "100%", marginTop: 12 },
};
