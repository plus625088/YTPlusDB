/**
 * 單機模式的資料層：資料存在這個瀏覽器的 localStorage。
 * 提供的函式和 cloud-store.js 完全相同，畫面不需要知道目前用哪一種。
 */
import { makeId, storageGet, storageSet } from "../core/dom.js";
import { state, emitChange } from "../core/state.js";
import { isVideoId } from "../core/format.js";
import { withPendingTag, withRuleTags, normalizeSettings, DEFAULT_SETTINGS } from "../core/autotag.js";
import { sampleData } from "./seed.js";

const STORAGE_KEY = "yt-timecode-notes.v1";
const SETTINGS_KEY = "yt-timecode-notes.settings";

function loadSettings() {
  try { return normalizeSettings(JSON.parse(storageGet(SETTINGS_KEY) || "null") || DEFAULT_SETTINGS); }
  catch { return normalizeSettings(DEFAULT_SETTINGS); }
}

function loadFromBrowser() {
  let data = null;
  try { data = JSON.parse(storageGet(STORAGE_KEY) || "null"); } catch { data = null; }
  if (!data || !Array.isArray(data.videos)) data = sampleData();

  // 補齊舊版資料缺少的欄位、丟掉格式不對的資料
  data.videos = data.videos.filter((v) => isVideoId(v.id));
  for (const v of data.videos) {
    v.tags ||= [];
    v.channel ||= "";
    v.marks ||= [];
    for (const m of v.marks) {
      m.author ||= "";
      m.comments ||= [];
    }
  }
  return data;
}

export function createLocalStore() {
  const data = loadFromBrowser();
  const findVideo = (id) => data.videos.find((v) => v.id === id);
  const findMark = (videoId, markId) => findVideo(videoId).marks.find((m) => m.id === markId);

  /** 依有無時間點更新「待補」標籤 */
  const syncPending = (v) => { v.tags = withPendingTag(v.tags, v.marks.length > 0); };
  /** 依標題、頻道套用自動標籤規則（新影片、第一次抓到標題時） */
  const applyRules = (v) => { v.tags = withRuleTags(v.tags, v); };

  /** 存回瀏覽器並通知畫面 */
  function save() {
    storageSet(STORAGE_KEY, JSON.stringify(data));
    state.db = data;
    emitChange();
  }

  return {
    start() {
      state.settings = loadSettings();
      state.db = data;
      state.loaded = true;
      emitChange();
    },

    /* ----- 影片 ----- */

    /** 新增紀錄：影片不存在就建立，存在就把時間點加進去 */
    async saveRecord({ id, title, channel, tags, marks, author }) {
      let v = findVideo(id);
      if (!v) {
        v = { id, title, channel, tags, marks: [], updatedAt: Date.now() };
        applyRules(v);
        data.videos.push(v);
      } else {
        if (title) v.title = title;
        if (channel) v.channel = channel;
        v.tags = [...new Set([...(v.tags || []), ...tags])];
      }
      for (const m of marks) v.marks.push({ id: makeId(), t: m.t, note: m.note, author, comments: [] });
      syncPending(v);
      v.updatedAt = Date.now();
      save();
    },

    async updateVideo(id, patch) {
      Object.assign(findVideo(id), patch);
      save();
    },

    /** 只填入目前是空白的欄位（自動抓到的標題、頻道、發布日期） */
    async fillEmpty(id, patch) {
      const v = findVideo(id);
      let changed = false;
      const hadTitle = Boolean(v.title);
      for (const key in patch) {
        if (!v[key] && patch[key]) { v[key] = patch[key]; changed = true; }
      }
      if (!hadTitle && v.title) applyRules(v); // 第一次抓到標題：套用自動標籤規則
      if (changed) save();
    },

    /** 一次設定多部影片的 Hashtag：changes = { 影片ID: 新的標籤陣列 } */
    async setTagsMany(changes) {
      for (const [id, tags] of Object.entries(changes)) {
        const v = findVideo(id);
        if (v) v.tags = tags;
      }
      save();
      return Object.keys(changes).length;
    },

    /* ----- 自動標籤規則 ----- */

    async saveSettings(settings) {
      state.settings = normalizeSettings(settings);
      storageSet(SETTINGS_KEY, JSON.stringify(state.settings));
      emitChange();
    },

    /** 批次替多部影片加入／移除 Hashtag，回傳實際有變動的影片數 */
    async bulkUpdateTags(ids, { add = [], remove = [] }) {
      let count = 0;
      for (const v of data.videos) {
        if (!ids.includes(v.id)) continue;
        const next = [...new Set([...(v.tags || []).filter((t) => !remove.includes(t)), ...add])];
        if (next.length === (v.tags || []).length && next.every((t) => v.tags.includes(t))) continue;
        v.tags = next;
        count++;
      }
      save();
      return count;
    },

    /** 把所有影片的 Hashtag「oldName」改成「newName」（新名稱已存在時等於合併） */
    async renameTag(oldName, newName) {
      let count = 0;
      for (const v of data.videos) {
        if (!(v.tags || []).includes(oldName)) continue;
        v.tags = [...new Set(v.tags.map((t) => (t === oldName ? newName : t)))];
        count++;
      }
      save();
      return count;
    },

    async deleteVideo(id) {
      data.videos = data.videos.filter((v) => v.id !== id);
      save();
    },

    /* ----- 時間點 ----- */

    async addMark(videoId, t, note, author) {
      const v = findVideo(videoId);
      v.marks.push({ id: makeId(), t, note, author, comments: [] });
      syncPending(v);
      v.updatedAt = Date.now();
      save();
    },

    async updateMark(videoId, markId, patch) {
      Object.assign(findMark(videoId, markId), patch);
      save();
    },

    async deleteMark(videoId, markId) {
      const v = findVideo(videoId);
      v.marks = v.marks.filter((m) => m.id !== markId);
      syncPending(v);
      save();
    },

    /* ----- 補充評論 ----- */

    async addComment(videoId, markId, text, author) {
      findMark(videoId, markId).comments.push({ id: makeId(), text, author, createdAt: Date.now() });
      save();
    },

    async updateComment(videoId, commentId, patch) {
      for (const m of findVideo(videoId).marks) {
        const c = m.comments.find((x) => x.id === commentId);
        if (c) Object.assign(c, patch);
      }
      save();
    },

    async deleteComment(videoId, commentId) {
      for (const m of findVideo(videoId).marks) m.comments = m.comments.filter((x) => x.id !== commentId);
      save();
    },

    /* ----- 匯入（備份還原、Excel 批次匯入） ----- */

    /** 回傳新增的時間點數量；重複的時間點（同時間、同說明）會略過 */
    async importData({ videos }) {
      let added = 0;
      for (const nv of videos) {
        let v = findVideo(nv.id);
        const isNew = !v;
        if (!v) {
          v = { id: nv.id, title: "", channel: "", tags: [], marks: [], updatedAt: Date.now(), publishedAt: nv.publishedAt || 0 };
          data.videos.push(v);
        }
        v.tags = [...new Set([...(v.tags || []), ...(nv.tags || [])])];
        if (!v.title && nv.title) v.title = nv.title;
        if (!v.channel && nv.channel) v.channel = nv.channel;
        v.updatedAt = Date.now();

        for (const m of nv.marks || []) {
          if (v.marks.some((x) => x.t === m.t && x.note === m.note)) continue;
          v.marks.push({
            id: makeId(),
            t: m.t,
            note: String(m.note || ""),
            author: String(m.author || ""),
            comments: (m.comments || []).map((c) => ({
              id: makeId(), text: String(c.text || ""), author: String(c.author || ""), createdAt: Date.now(),
            })),
          });
          added++;
        }
        if (isNew) applyRules(v);
        syncPending(v);
      }
      save();
      return added;
    },
  };
}
