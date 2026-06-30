export function parseTimeToSeconds(input: string): number {
  const raw = input.trim().toLowerCase();
  if (!raw) return Number.NaN;

  const minuteSecond = raw.match(/^(\d+(?:\.\d+)?)\s*m(?:in(?:ute)?s?)?\s*(?:(\d+(?:\.\d+)?)\s*s(?:ec(?:ond)?s?)?)?$/);
  if (minuteSecond) {
    const minutes = Number(minuteSecond[1]);
    const seconds = minuteSecond[2] ? Number(minuteSecond[2]) : 0;
    return minutes * 60 + seconds;
  }

  const secondsOnly = raw.match(/^(\d+(?:\.\d+)?)\s*(?:s|sec|secs|second|seconds)$/);
  if (secondsOnly) return Number(secondsOnly[1]);

  const colon = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (colon) {
    const first = Number(colon[1]);
    const second = Number(colon[2]);
    const third = colon[3] ? Number(colon[3]) : undefined;
    if (second >= 60 || (third !== undefined && third >= 60)) return Number.NaN;
    return third === undefined ? first * 60 + second : first * 3600 + second * 60 + third;
  }

  const number = raw.match(/^(\d+(?:\.\d+)?)$/);
  if (number) return Number(number[1]);

  return Number.NaN;
}

export function parseTimeToMs(input: string): number {
  const seconds = parseTimeToSeconds(input);
  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : Number.NaN;
}

export function formatSeconds(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function formatMs(ms: number): string {
  return formatSeconds(ms / 1000);
}
