/**
 * 「影片」分頁：影片卡片列表、Hashtag 篩選、排序。
 */
import { $, esc, storageGet, storageSet, toast, run } from "../core/dom.js";
import { state, sortMarks, isAdmin } from "../core/state.js";
import { formatTime, formatDate, hasTime, parseTags } from "../core/format.js";
import { PENDING_TAG, MEMBER_TAG, NON_MEMBER_TAG } from "../config.js";
import { registerView } from "../core/router.js";
import { openVideo } from "./video.js";

const SORT_KEY = "yt-timecode-notes.sort";
const MATCH_KEY = "yt-timecode-notes.tag-match";

/** 自動加上的系統標籤，改名會讓自動功能失效，所以不能在這裡改 */
const SYSTEM_TAGS = [PENDING_TAG, MEMBER_TAG, NON_MEMBER_TAG];

const selected = new Set();  // 目前選取的 Hashtag（可多選）
let matchMode = "all";       // "all"：要有全部選取的標籤；"any"：有任一個即可
let tagsOpen = false;        // 篩選面板預設收起
let manageOpen = false;      // 管理者的改名區塊
let confirmMerge = null;     // 等待確認合併的標籤

const tagClass = (t) => "tag" + (t === PENDING_TAG ? " pending" : "");

/** 影片是否符合目前的 Hashtag 篩選 */
function matchesFilter(v) {
  if (!selected.size) return true;
  const tags = v.tags || [];
  const picked = [...selected];
  return matchMode === "all" ? picked.every((t) => tags.includes(t)) : picked.some((t) => tags.includes(t));
}

function toggleTag(tag) {
  if (selected.has(tag)) selected.delete(tag);
  else selected.add(tag);
  render();
}

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

/** 統計每個 Hashtag 有幾部影片 */
function countTags() {
  const counts = {};
  for (const v of state.db.videos) for (const t of v.tags || []) counts[t] = (counts[t] || 0) + 1;
  return counts;
}

function renderTagBar() {
  const counts = countTags();
  for (const t of selected) if (!counts[t]) selected.delete(t); // 已經沒有影片使用的標籤
  const names = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b));

  // 「# Hashtag 篩選」按鈕；旁邊顯示目前選取的標籤（按 ✕ 取消單一個）
  $("#tag-toggle-row").hidden = !names.length;
  const toggle = $("#tag-toggle");
  toggle.setAttribute("aria-expanded", String(tagsOpen));
  toggle.textContent = `# Hashtag 篩選（${names.length}）${tagsOpen ? "▴" : "▾"}`;
  $("#tag-active").innerHTML = tagsOpen ? "" : [...selected]
    .map((t) => `<button class="${tagClass(t)}" data-remove="${esc(t)}" aria-pressed="true" title="取消這個標籤">#${esc(t)} ✕</button>`)
    .join("") + (selected.size > 1 ? `<span class="small muted">（${matchMode === "all" ? "符合全部" : "符合任一"}）</span>` : "");

  // 篩選面板
  $("#tag-panel").hidden = !names.length || !tagsOpen;
  document.querySelectorAll("#tag-panel .seg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === matchMode)));
  $("#tag-clear").hidden = !selected.size;
  $("#tag-manage-btn").hidden = !isAdmin();
  $("#tag-manage-btn").textContent = manageOpen ? "完成管理" : "✎ 管理 Hashtag";
  $("#tagbar").innerHTML = names
    .map((t) => `<button class="${tagClass(t)}" data-filter="${esc(t)}" aria-pressed="${selected.has(t)}">#${esc(t)} <span class="muted">${counts[t]}</span></button>`)
    .join("");

  renderTagManage(names, counts);
}

/** 管理者：每個 Hashtag 一列，可以輸入新名稱統一改名 */
function renderTagManage(names, counts) {
  const box = $("#tag-manage");
  box.hidden = !manageOpen || !isAdmin();
  if (box.hidden) return;

  const drafts = {};
  box.querySelectorAll("input[data-old]").forEach((el) => { drafts[el.dataset.old] = el.value; });

  box.innerHTML = `<div class="small muted">輸入新名稱後按「改名」，所有影片上的這個 Hashtag 會一起改。新名稱如果已經存在，兩個標籤會合併成一個。</div>` +
    names.map((t, i) => {
      const system = SYSTEM_TAGS.includes(t);
      const action = system
        ? `<span class="small muted">自動標籤，無法改名</span>`
        : `<button type="button" class="btn sm${confirmMerge === t ? " danger-outline" : ""}" data-rename="${esc(t)}">${confirmMerge === t ? "確定合併？" : "改名"}</button>`;
      return `<div class="tag-manage-row">
        <span class="tm-name"><span class="${tagClass(t)}">#${esc(t)}</span> <span class="small muted">${counts[t]} 部</span></span>
        <input type="text" id="tm-${i}" data-old="${esc(t)}" maxlength="40" placeholder="新名稱" aria-label="#${esc(t)} 的新名稱" ${system ? "disabled" : ""}>
        ${action}
      </div>`;
    }).join("");

  box.querySelectorAll("input[data-old]").forEach((el) => { if (drafts[el.dataset.old]) el.value = drafts[el.dataset.old]; });
}

async function onRenameClick(btn) {
  const oldName = btn.dataset.rename;
  const input = [...$("#tag-manage").querySelectorAll("input[data-old]")].find((el) => el.dataset.old === oldName);
  const newName = parseTags(input.value)[0];
  if (!newName) { toast("請輸入新名稱"); input.focus(); return; }
  if (newName === oldName) { toast("新名稱和原本一樣"); return; }

  // 新名稱已經存在：先確認要合併
  if (countTags()[newName] && confirmMerge !== oldName) {
    confirmMerge = oldName;
    renderTagBar();
    toast(`#${newName} 已經存在，再按一次會把 #${oldName} 合併進去`);
    return;
  }
  confirmMerge = null;
  btn.disabled = true;
  let count = 0;
  const ok = await run(async () => { count = await state.store.renameTag(oldName, newName); });
  if (!ok) { btn.disabled = false; return; }
  if (selected.delete(oldName)) selected.add(newName);
  input.value = "";
  toast(`已把 ${count} 部影片的 #${oldName} 改成 #${newName}`);
  render();
}

function renderCard(v) {
  sortMarks(v);
  const id = esc(v.id);
  const preview = v.marks.slice(0, 2)
    .map((m) => `<div class="peek">${hasTime(m.t) ? `<span class="tc-chip">${formatTime(m.t)}</span>` : '<span class="tc-chip no-time">整部</span>'}<span>${esc(m.note)}</span></div>`)
    .join("");
  const byline = [v.channel && esc(v.channel), v.publishedAt && formatDate(v.publishedAt)].filter(Boolean).join(" · ");
  const tags = (v.tags || []).map((t) => `<span class="${tagClass(t)}" data-filter="${esc(t)}" aria-pressed="${selected.has(t)}" title="加入篩選">#${esc(t)}</span>`).join("");

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
    $("#tag-toggle-row").hidden = true;
    $("#tag-panel").hidden = true;
    $("#lib-stats").textContent = "";
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1">載入中…</div>`;
    return;
  }

  renderTagBar();
  const mode = $("#sort-sel").value;
  const videos = state.db.videos
    .filter(matchesFilter)
    .sort((a, b) => compareVideos(a, b, mode));

  const markCount = videos.reduce((n, v) => n + v.marks.length, 0);
  $("#lib-stats").textContent = videos.length
    ? (selected.size ? `${[...selected].map((t) => "#" + t).join(" ")}：` : "") + `${videos.length} 部影片 · ${markCount} 個時間點`
    : "";

  grid.innerHTML = videos.length
    ? videos.map(renderCard).join("")
    : selected.size
      ? `<div class="empty" style="grid-column:1/-1">沒有符合這些 Hashtag 的影片。可以改成「符合任一」或取消部分標籤。</div>`
      : `<div class="empty" style="grid-column:1/-1">還沒有任何紀錄。按「新增紀錄」貼上第一支 YouTube 影片網址。</div>`;

  // 縮圖載入失敗就移除，露出底下的影片 ID
  grid.querySelectorAll(".thumb img").forEach((img) => img.addEventListener("error", () => img.remove(), { once: true }));
}

export function initLibrary() {
  const saved = storageGet(SORT_KEY);
  if (saved) $("#sort-sel").value = saved;
  $("#sort-sel").addEventListener("change", (e) => { storageSet(SORT_KEY, e.target.value); render(); });

  const savedMatch = storageGet(MATCH_KEY);
  if (savedMatch === "any" || savedMatch === "all") matchMode = savedMatch;

  $("#tag-toggle").addEventListener("click", () => { tagsOpen = !tagsOpen; renderTagBar(); });
  $("#tag-active").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-remove]");
    if (btn) { selected.delete(btn.dataset.remove); render(); }
  });
  $("#tagbar").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-filter]");
    if (btn) toggleTag(btn.dataset.filter);
  });
  $("#tag-panel .seg").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-mode]");
    if (!btn) return;
    matchMode = btn.dataset.mode;
    storageSet(MATCH_KEY, matchMode);
    render();
  });
  $("#tag-clear").addEventListener("click", () => { selected.clear(); render(); });
  $("#tag-manage-btn").addEventListener("click", () => { manageOpen = !manageOpen; confirmMerge = null; renderTagBar(); });
  $("#tag-manage").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-rename]");
    if (btn) onRenameClick(btn);
  });
  $("#tag-manage").addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || !e.target.dataset.old) return;
    e.preventDefault();
    const btn = [...$("#tag-manage").querySelectorAll("[data-rename]")].find((b) => b.dataset.rename === e.target.dataset.old);
    if (btn) onRenameClick(btn);
  });

  $("#lib-grid").addEventListener("click", (e) => {
    const tag = e.target.closest("[data-filter]");
    if (tag) { e.stopPropagation(); toggleTag(tag.dataset.filter); return; }
    const card = e.target.closest("[data-open]");
    if (card) openVideo(card.dataset.open);
  });

  registerView("library", { onShow: render, onData: render });
}
