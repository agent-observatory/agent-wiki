// One shared format for every human-facing timestamp in the app: 24-hour,
// no AM/PM marker, "26. 09. 14. 14:51" style, always Asia/Seoul. Framework-
// free so it works from server or client code.
export const KST_DATETIME: Intl.DateTimeFormatOptions = {
  timeZone: "Asia/Seoul",
  year: "2-digit",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
};
export function formatWhen(value: string | Date, withSeconds = false) {
  return new Date(value).toLocaleString(
    "ko-KR",
    withSeconds ? { ...KST_DATETIME, second: "2-digit" } : KST_DATETIME,
  );
}
