export const pad = (n: number) => String(n).padStart(2, "0");

export function formatClock(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total / 60) % 60))}:${pad(total % 60)}`;
}

export function durationMinutes(start: number, end: number): number {
  const m = Math.round((end - start) / 60000);
  return m > 0 ? m : 1;
}

export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Monday-based start of week. */
export function startOfWeek(d: Date): Date {
  const x = startOfDay(d);
  const dow = x.getDay();
  x.setDate(x.getDate() - (dow === 0 ? 6 : dow - 1));
  return x;
}

/** ISO-8601 week number. */
export function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

export function formatDate(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

export function dayTitle(d: Date): string {
  const today = startOfDay(new Date()).getTime();
  const t = startOfDay(d).getTime();
  if (t === today) return "Today";
  if (t === today - 86400000) return "Yesterday";
  return formatDate(d);
}

export function weekTitle(weekStart: Date): string {
  const thisWeek = startOfWeek(new Date()).getTime();
  const t = weekStart.getTime();
  if (t === thisWeek) return "This week";
  if (t === thisWeek - 7 * 86400000) return "Last week";
  const end = new Date(weekStart);
  end.setDate(end.getDate() + 6);
  return `Week ${isoWeek(weekStart)} · ${weekStart.toLocaleDateString(undefined, { day: "numeric", month: "short" })} – ${end.toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
}
