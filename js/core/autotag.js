/**
 * 自動標籤規則。
 *
 * 規則存在資料庫（settings/autoTags），管理者可以在「設定」頁修改：
 *   rules:   [{ id, field: "title" | "channel", op: "contains" | "notContains", keywords: [..], tag }]
 *            依影片標題或頻道判斷要自動加上哪些 Hashtag。
 *            只在「新增影片」或「第一次抓到標題」時套用；也可以在設定頁手動套用到現有影片。
 *   pending: { enabled, tag }
 *            沒有任何時間點的影片自動加上這個 Hashtag，補上第一個時間點後自動移除。
 */
import { LIMITS } from "../config.js";
import { state } from "./state.js";

export const DEFAULT_SETTINGS = {
  rules: [
    { id: "member", field: "title", op: "contains", keywords: ["會員專屬"], tag: "會員" },
    { id: "public", field: "title", op: "notContains", keywords: ["會員專屬"], tag: "公開" },
  ],
  pending: { enabled: true, tag: "待補" },
};

const clean = (v, max) => String(v ?? "").replace(/^[#＃\s]+/, "").trim().slice(0, max);

/** 檢查並整理設定（資料庫讀到的、或設定頁送出的），格式不對的部分丟掉 */
export function normalizeSettings(raw) {
  const src = raw && typeof raw === "object" ? raw : DEFAULT_SETTINGS;
  const rules = (Array.isArray(src.rules) ? src.rules : [])
    .map((r, i) => ({
      id: clean(r?.id, 40) || "r" + i,
      field: r?.field === "channel" ? "channel" : "title",
      op: r?.op === "notContains" ? "notContains" : "contains",
      keywords: (Array.isArray(r?.keywords) ? r.keywords : String(r?.keywords || "").split(/[,，、]/))
        .map((k) => String(k).trim().slice(0, 60)).filter(Boolean).slice(0, 20),
      tag: clean(r?.tag, LIMITS.tag),
    }))
    .filter((r) => r.tag && r.keywords.length)
    .slice(0, 50);
  const pendingTag = clean(src.pending?.tag, LIMITS.tag);
  return {
    rules,
    pending: { enabled: src.pending?.enabled !== false && Boolean(pendingTag), tag: pendingTag || "待補" },
  };
}

/** 目前生效的設定（資料庫還沒載入時用預設值） */
export const getSettings = () => state.settings || DEFAULT_SETTINGS;

/** 「待補」標籤名稱；關閉時回傳 null */
export function pendingTag() {
  const p = getSettings().pending;
  return p.enabled && p.tag ? p.tag : null;
}

/** 所有可能自動加上的標籤名稱 */
export function autoTagNames() {
  const s = getSettings();
  const names = new Set(s.rules.map((r) => r.tag));
  if (s.pending.enabled && s.pending.tag) names.add(s.pending.tag);
  return names;
}

export const isAutoTag = (tag) => autoTagNames().has(tag);
export const isPendingTag = (tag) => tag === pendingTag();

/** 一條規則是否符合這部影片（要判斷的欄位還是空的時候一律不符合，等抓到資料再判斷） */
export function ruleMatches(rule, video) {
  const text = String((rule.field === "channel" ? video.channel : video.title) || "").toLowerCase();
  if (!text) return false;
  const hit = rule.keywords.some((k) => text.includes(k.toLowerCase()));
  return rule.op === "contains" ? hit : !hit;
}

/** 依規則，這部影片應該有哪些自動標籤 */
export function tagsFromRules(video, settings = getSettings()) {
  return [...new Set(settings.rules.filter((r) => ruleMatches(r, video)).map((r) => r.tag))];
}

/** 把規則產生的標籤加進現有標籤（不移除任何標籤） */
export function withRuleTags(tags, video) {
  return [...new Set([...(tags || []), ...tagsFromRules(video)])].slice(0, LIMITS.tags);
}

/** 依影片有沒有時間點，加上或移除「待補」標籤（關閉時不更動） */
export function withPendingTag(tags, hasMarks) {
  const p = pendingTag();
  const list = tags || [];
  if (!p) return list;
  const rest = list.filter((t) => t !== p);
  return hasMarks ? rest : [...rest, p].slice(-LIMITS.tags);
}

/** 依筆畫排序用的比較器（繁體中文筆畫順序） */
const byStroke = new Intl.Collator("zh-Hant-TW-u-co-stroke").compare;

/**
 * 標籤排序：自動標籤排在最前面（依「設定」頁的規則順序，「待補」排在規則標籤之後），
 * 其餘手動加的標籤依筆畫排序。
 */
export function sortTags(tags) {
  const settings = getSettings();
  const autoOrder = [...new Set(settings.rules.map((r) => r.tag))];
  if (settings.pending.enabled && settings.pending.tag && !autoOrder.includes(settings.pending.tag)) autoOrder.push(settings.pending.tag);
  const list = [...new Set(tags || [])];
  const auto = autoOrder.filter((t) => list.includes(t));
  const manual = list.filter((t) => !autoOrder.includes(t)).sort(byStroke);
  return [...auto, ...manual];
}

/** 標籤的 CSS class：自動標籤用不同顏色，「待補」用紅色 */
export const tagClass = (tag) => "tag" + (isPendingTag(tag) ? " pending" : isAutoTag(tag) ? " auto" : "");
