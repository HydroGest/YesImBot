export function parseTimestamp(timestamp: string): Date {
  const [yyyy, mm, dd, hh, min, sec] = timestamp.split("/").map(Number);
  return new Date(yyyy, mm - 1, dd, hh, min, sec);
}

export function getCurrentTimestamp(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  const sec = String(now.getSeconds()).padStart(2, "0");
  return `${yyyy}/${mm}/${dd}/${hh}/${min}/${sec}`;
}
