// Fayl yuklab olish uchun umumiy yordamchi (progress ko'rsatgichi bilan).
import fs from "fs";

export function formatMb(bytes) {
  return (bytes / 1024 / 1024).toFixed(1);
}

/**
 * URL'dan faylni yuklab, targetPath ga saqlaydi va jarayonni ko'rsatadi.
 */
export async function downloadWithProgress(url, targetPath, timeoutMinutes = 10) {
  const tempPath = `${targetPath}.part`;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    timeoutMinutes * 60 * 1000
  );

  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }

    const total = Number(res.headers.get("content-length")) || 0;
    let received = 0;
    let lastPrint = 0;

    const fileStream = fs.createWriteStream(tempPath);
    for await (const chunk of res.body) {
      fileStream.write(chunk);
      received += chunk.length;

      const now = Date.now();
      if (now - lastPrint > 500) {
        lastPrint = now;
        const percent = total
          ? ` (${((received / total) * 100).toFixed(0)}%)`
          : "";
        process.stdout.write(
          `\r  ${formatMb(received)} MB${
            total ? ` / ${formatMb(total)} MB` : ""
          }${percent}   `
        );
      }
    }
    await new Promise((resolve) => fileStream.end(resolve));

    fs.renameSync(tempPath, targetPath);
    process.stdout.write("\r");
    return received;
  } catch (err) {
    fs.rmSync(tempPath, { force: true });
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
