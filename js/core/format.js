/**
 * 資料解析與格式化：YouTube 網址、時間碼、日期、Hashtag。
 * 這裡都是「純函式」（不碰畫面），方便測試。
 */
import { LIMITS } from "../config.js";

const VIDEO_ID = /^[\w-]{11}$/;

/** 檢查是否為合法的 YouTube 影片 ID（11 碼英數、底線、減號） */
export const isVideoId = (id) => typeof id === "string" && VIDEO_ID.test(id);

/** 把網址字串轉成 URL 物件（沒寫 https:// 也可以），失敗回傳 null */
function toUrl(input) {
  try { return new URL(/^https?:\/\//i.test(input) ? input : "https://" + input); }
  catch { return null; }
}

/**
 * 從各種 YouTube 網址取出影片 ID。
 * 支援 watch?v=、youtu.be/、shorts/、embed/、live/，或直接輸入 11 碼 ID。
 */
export function parseVideoId(input) {
  const s = String(input || "").trim();
  if (!s) return null;
  if (isVideoId(s)) return s;

  const url = toUrl(s);
  if (!url) return null;
  const host = url.hostname.replace(/^(www|m|music)\./, "");

  if (host === "youtu.be") {
    const id = url.pathname.slice(1).split("/")[0];
    return isVideoId(id) ? id : null;
  }
  if (/(^|\.)youtube(-nocookie)?\.com$/.test(host)) {
    const v = url.searchParams.get("v");
    if (isVideoId(v)) return v;
    const m = url.pathname.match(/\/(?:shorts|embed|live|v)\/([\w-]{11})/);
    if (m) return m[1];
  }
  return null;
}

/** 取出網址裡的 t= 或 start= 時間（秒），沒有則回傳 null */
export function parseUrlTime(input) {
  const url = toUrl(String(input || "").trim());
  const t = url && (url.searchParams.get("t") || url.searchParams.get("start"));
  return t ? parseTime(t) : null;
}

/**
 * 把時間碼文字轉成秒數。
 * 支援：83（秒）、1:23、01:02:03、1m23s、1h2m3s。看不懂回傳 null。
 */
export function parseTime(input) {
  const s = String(input || "").trim().toLowerCase().replace(/\s+/g, "");
  if (!s) return null;

  if (/^\d+(\.\d+)?$/.test(s)) return Math.floor(Number(s));

  const hms = s.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (hms && (hms[1] || hms[2] || hms[3])) {
    return (Number(hms[1]) || 0) * 3600 + (Number(hms[2]) || 0) * 60 + (Number(hms[3]) || 0);
  }

  const parts = s.split(/[:：]/);
  if (parts.length >= 2 && parts.length <= 3 && parts.every((p) => /^\d+$/.test(p))) {
    return parts.reduce((total, p) => total * 60 + Number(p), 0);
  }
  return null;
}

/** 是否有時間碼（沒有時間碼的說明，t 為 null，代表整部影片） */
export const hasTime = (t) => Number.isInteger(t) && t >= 0;

/** 秒數轉成 1:23 或 1:02:03 */
export function formatTime(seconds) {
  const t = Math.max(0, Math.floor(seconds));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const ss = String(t % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** 毫秒時間轉成 2024/05/12 */
export function formatDate(ms) {
  const d = new Date(ms);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}/${mm}/${dd}`;
}

/** 「#演唱會 現場, 必看」→ ["演唱會", "現場", "必看"]（去除重複、限制長度與數量） */
export function parseTags(input) {
  const tags = [];
  for (const raw of String(input || "").split(/[\s,，、#＃]+/)) {
    const tag = raw.trim().slice(0, LIMITS.tag);
    if (tag && !tags.includes(tag)) tags.push(tag);
  }
  return tags.slice(0, LIMITS.tags);
}

/** 兩個標籤陣列內容是否相同（不管順序） */
export const sameTags = (a = [], b = []) => a.length === b.length && a.every((t) => b.includes(t));

/** ["演唱會", "現場"] → "#演唱會 #現場" */
export const tagsToText = (tags) => (tags || []).map((t) => "#" + t).join(" ");

/** YouTube 觀看網址（可帶開始秒數） */
export function watchUrl(videoId, seconds) {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}` + (seconds ? `&t=${seconds}s` : "");
}
