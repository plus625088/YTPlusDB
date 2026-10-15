/**
 * 「影片庫」分頁：影片卡片列表、Hashtag 篩選、排序。
 */
import { $, esc, storageGet, storageSet } from "../core/dom.js";
import { state, sortMarks } from "../core/state.js";
import { formatTime, formatDate } from "../core/format.js";
import { registerView } from "../core/router.js";
import { openVideo } from "./video.js";

const SORT_KEY = "yt-timecode-notes.sort";
let tagFilter = null;

/** 依目前的排序方式比較兩部影片 */
function compareVideos(a, b, mode) {
  if (mode !== "updated") {
    const pa = a.publishedAt || 0;
    const pb = b.publishedAt || 0;
    if (pa && pb && pa !== pb) return mode === "published-asc" ? pa - pb : pb - pa;
    if (pa && !pb) return -1; // 沒有發布日期的排在最後
    if (pb && !pa) return 1;
  }
  return (b.updatedAt || 0) - (a.updatedAt || 0);
}

function renderTagBar() {
  const counts = {};
  for (const v of state.db.videos) for (const t of v.tags || []) counts[t] = (counts[t] || 0) + 1;
  if (tagFilter && !counts[tagFilter]) tagFilter = null;

  const names = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b));
  const bar = $("#tagbar");
  bar.hidden = !names.length;
  bar.innerHTML = !names.length ? "" :
    `<span class="label">篩選</span>
     <button class="tag" data-filter="" aria-pressed="${!tagFilter}">全部</button>` +
    names.map((t) => `<button class="tag" data-filter="${esc(t)}" aria-pressed="${tagFilter === t}">#${esc(t)} <span class="muted">${counts[t]}</span></button>`).join("");
}

function renderCard(v) {
  sortMarks(v);
  const id = esc(v.id);
  const preview = v.marks.slice(0, 2)
    .map((m) => `<div class="peek"><span class="tc-chip">${formatTime(m.t)}</span><span>${esc(m.note)}</span></div>`)
    .join("");
  const byline = [v.channel && esc(v.channel), v.publishedAt && formatDate(v.publishedAt)].filter(Boolean).join(" · ");
  const tags = (v.tags || []).map((t) => `<span class="tag" data-filter="${esc(t)}">#${esc(t)}</span>`).join("");

  return `<button class="card" data-open="${id}">
    <div class="thumb">
      <span class="ph">${id}</span>
      <img src="https://i.ytimg.com/vi/${id}/mqdefault.jpg" alt="" loading="lazy">
      <span class="count">${v.marks.length} 個時間點</span>
    </div>
    <div class="card-body">
      <div class="row" style="gap:8px"><span class="card-title">${esc(v.title || "未命名影片")}</span>${v.sample ? '<span class="chip">範例</span>' : ""}</div>
      ${byline ? `<div class="channel">${byline}</div>` : ""}
      ${tags ? `<div class="tags">${tags}</div>` : ""}
      ${preview}
    </div>
  </button>`;
}

function render() {
  const grid = $("#lib-grid");
  if (!state.loaded) {
    $("#tagbar").hidden = true;
    $("#lib-stats").textContent = "";
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1">載入中…</div>`;
    return;
  }

  renderTagBar();
  const mode = $("#sort-sel").value;
  const videos = state.db.videos
    .filter((v) => !tagFilter || (v.tags || []).includes(tagFilter))
    .sort((a, b) => compareVideos(a, b, mode));

  const markCount = videos.reduce((n, v) => n + v.marks.length, 0);
  $("#lib-stats").textContent = videos.length
    ? (tagFilter ? `#${tagFilter}：` : "") + `${videos.length} 部影片 · ${markCount} 個時間點`
    : "";

  grid.innerHTML = videos.length
    ? videos.map(renderCard).join("")
    : `<div class="empty" style="grid-column:1/-1">還沒有任何紀錄。按「新增紀錄」貼上第一支 YouTube 影片網址。</div>`;

  // 縮圖載入失敗就移除，露出底下的影片 ID
  grid.querySelectorAll(".thumb img").forEach((img) => img.addEventListener("error", () => img.remove(), { once: true }));
}

export function initLibrary() {
  const saved = storageGet(SORT_KEY);
  if (saved) $("#sort-sel").value = saved;
  $("#sort-sel").addEventListener("change", (e) => { storageSet(SORT_KEY, e.target.value); render(); });

  $("#tagbar").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-filter]");
    if (btn) { tagFilter = btn.dataset.filter || null; render(); }
  });

  $("#lib-grid").addEventListener("click", (e) => {
    const tag = e.target.closest("[data-filter]");
    if (tag) { e.stopPropagation(); tagFilter = tag.dataset.filter; render(); return; }
    const card = e.target.closest("[data-open]");
    if (card) openVideo(card.dataset.open);
  });

  registerView("library", { onShow: render, onData: render });
}
