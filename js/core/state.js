/**
 * 全站共用的狀態，以及「資料有變動」的通知機制。
 *
 * state.db 的結構（畫面只讀這份資料）：
 *   videos: [{
 *     id, title, channel, tags[], publishedAt(毫秒), updatedAt(毫秒), sample?,
 *     marks: [{
 *       id, t(秒，沒有時間碼時為 null), note, author, uid,
 *       comments: [{ id, text, author, uid, createdAt }]
 *     }]
 *   }]
 */
import { ADMIN_EMAILS, CLOUD, LIMITS } from "../config.js";
import { $, storageGet, storageSet } from "./dom.js";
import { hasTime } from "./format.js";

export const state = {
  db: { videos: [] },
  loaded: false,   // 第一批資料是否已載入
  user: null,      // Firebase 登入者（匿名或 Google）
  store: null,     // 資料層：local-store 或 cloud-store
  settings: null,  // 自動標籤規則（見 core/autotag.js），還沒載入時用預設值
  site: { commentsEnabled: true }, // 網站功能開關（在「設定」頁修改）
};

/** 網站功能開關的預設值，以及整理資料庫讀到的內容 */
export const DEFAULT_SITE = { commentsEnabled: true };
export const normalizeSite = (raw) => ({ commentsEnabled: raw?.commentsEnabled !== false });

/** 是否開放時間點的補充／評論 */
export const commentsEnabled = () => state.site?.commentsEnabled !== false;

/* ---------- 變動通知 ---------- */

const listeners = new Set();
/** 註冊「資料或登入狀態有變動」時要執行的函式 */
export const onChange = (fn) => listeners.add(fn);
/** 通知所有畫面重畫 */
export const emitChange = () => listeners.forEach((fn) => fn());

/* ---------- 查詢 ---------- */

export const getVideo = (id) => state.db.videos.find((v) => v.id === id);
/** 時間點依時間排序；沒有時間碼的說明排在最前面 */
export const sortMarks = (video) => video.marks.sort((a, b) => (hasTime(a.t) ? a.t : -1) - (hasTime(b.t) ? b.t : -1));

/* ---------- 身分與權限（畫面用，真正的檢查在 firestore.rules） ---------- */

export const myUid = () => state.user?.uid || null;

export function isAdmin() {
  if (!CLOUD) return true; // 單機模式：自己就是管理者
  const u = state.user;
  if (!u || u.isAnonymous) return false;
  return ADMIN_EMAILS.map((e) => e.toLowerCase()).includes((u.email || "").toLowerCase());
}

/** 是不是「這個瀏覽器」建立的時間點或補充 */
export const isMine = (item) => CLOUD && Boolean(item.uid) && item.uid === myUid();

/** 管理者可以改全部；一般人只能改自己建立的 */
export const canEdit = (item) => isAdmin() || isMine(item);

/* ---------- 記住使用者名字 ---------- */

const NAME_KEY = "yt-timecode-notes.name";

export const getName = () => (storageGet(NAME_KEY) || "").trim();

/** 記住名字，並同步填到所有「你的名字」欄位 */
export function setName(name) {
  const n = String(name || "").trim().slice(0, LIMITS.author);
  if (n) storageSet(NAME_KEY, n);
  for (const sel of ["#add-author", "#quick-name"]) {
    const el = $(sel);
    if (el) el.value = n;
  }
}
