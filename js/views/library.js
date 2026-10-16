/**
 * 「影片」分頁：影片卡片列表、Hashtag 篩選、排序。
 */
import { $, esc, storageGet, storageSet, toast, run } from "../core/dom.js";
import { state, sortMarks, isAdmin } from "../core/state.js";
import { formatTime, formatDate, hasTime, parseTags } from "../core/format.js";
import { tagClass, isAutoTag, sortTags } from "../core/autotag.js";
import { registerView } from "../core/router.js";
import { openVideo } from "./video.js";

const SORT_KEY = "yt-timecode-notes.sort";
const MATCH_KEY = "yt-timecode-notes.tag-match";


const selected = new Set();  // 目前選取的 Hashtag（可多選）
let matchMode = "all";       // "all"：要有全部選取的標籤；"any"：有任一個即可
let tagsOpen = false;        // 篩選面板預設收起
let manageOpen = false;      // 管理者的改名區塊
let confirmMerge = null;     // 等待確認合併的標籤
let bulkMode = false;        // 管理者：批次編輯 Hashtag
const picked = new Set();    // 批次編輯時選取的影片
let shownIds = [];           // 目前列出的影片（全選用）


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
      const system = isAutoTag(t);
      const action = system
        ? `<span class="small muted">自動標籤，請到「標籤規則」修改</span>`
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
  const tags = sortTags(v.tags).map((t) => `<span class="${tagClass(t)}" data-filter="${esc(t)}" aria-pressed="${selected.has(t)}" title="加入篩選">#${esc(t)}</span>`).join("");

  const isPicked = bulkMode && picked.has(v.id);
  return `<button class="card${bulkMode ? " selectable" : ""}${isPicked ? " picked" : ""}" data-open="${id}"${bulkMode ? ` aria-pressed="${isPicked}"` : ""}>
    ${bulkMode ? `<span class="pick" aria-hidden="true">${isPicked ? "✓" : ""}</span>` : ""}
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
  if (bulkMode && !isAdmin()) bulkMode = false;
  $("#bulk-btn").hidden = !isAdmin();
  $("#bulk-btn").setAttribute("aria-pressed", String(bulkMode));
  const mode = $("#sort-sel").value;
  const videos = state.db.videos
    .filter(matchesFilter)
    .sort((a, b) => compareVideos(a, b, mode));

  shownIds = videos.map((v) => v.id);
  for (const id of picked) if (!state.db.videos.some((v) => v.id === id)) picked.delete(id); // 已刪除的影片
  renderBulkBar();
  const markCount = videos.reduce((n, v) => n + v.marks.length, 0);
  $("#lib-stats").textContent = videos.length
    ? (selected.size ? `${[...selected].map((t) => "#" + t).join(" ")}：` : "") + `${videos.length} 部影片 · ${markCount} 個時間點`
    : "";

  grid.innerHTML = videos.length
    ? videos.map(renderCard).join("")
    : selected.size
      ? `<div class="empty" style="grid-column:1/-1">沒有符合這些 Hashtag 的影片。可以改成「符合任一」或取消部分標籤。</div>`
      : `<div class="empty" style="grid-column:1/-1">還沒有任何紀錄。按「新增」貼上第一支 YouTube 影片網址。</div>`;

  // 縮圖載入失敗就移除，露出底下的影片 ID
  grid.querySelectorAll(".thumb img").forEach((img) => img.addEventListener("error", () => img.remove(), { once: true }));
}

/* ---------- 批次編輯 Hashtag（管理者） ---------- */

function setBulkMode(on) {
  bulkMode = on;
  if (!on) picked.clear();
  render();
  if (on) toast("點影片來選取，再用下方工具列加入或移除 Hashtag");
}

function renderBulkBar() {
  const bar = $("#bulk-bar");
  bar.hidden = !bulkMode;
  $("#view-library").classList.toggle("bulk-mode", bulkMode);
  if (!bulkMode) return;

  const videos = state.db.videos.filter((v) => picked.has(v.id));
  $("#bulk-count").textContent = `已選 ${picked.size} 部`;
  $("#bulk-none").hidden = !picked.size;

  // 選取的影片目前有哪些 Hashtag（數字是幾部有），按 × 從所有選取的影片移除
  const counts = {};
  for (const v of videos) for (const t of v.tags || []) counts[t] = (counts[t] || 0) + 1;
  const names = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b));
  $("#bulk-tags").innerHTML = !picked.size
    ? '<span class="small muted">先點選要編輯的影片。</span>'
    : !names.length
      ? '<span class="small muted">選取的影片都還沒有 Hashtag。</span>'
      : '<span class="small muted">從選取的影片移除：</span>' + names.map((t) => `<span class="${tagClass(t)} tag-chip">#${esc(t)} <span class="muted">${counts[t]}/${picked.size}</span><button type="button" class="tag-x" data-bulk-remove="${esc(t)}" aria-label="從選取的影片移除 #${esc(t)}" title="從選取的影片移除">×</button></span>`).join("");

  const used = new Set(state.db.videos.flatMap((v) => v.tags || []));
  $("#bulk-suggest").innerHTML = [...used].sort().map((t) => `<option value="${esc(t)}">`).join("");
  $("#bulk-add-form").querySelectorAll("input,button").forEach((el) => { el.disabled = !picked.size; });
}

async function bulkApply(change, message) {
  if (!isAdmin() || !picked.size) return;
  let count = 0;
  const ok = await run(async () => { count = await state.store.bulkUpdateTags([...picked], change); });
  if (ok) toast(count ? message(count) : "選取的影片都不需要變更");
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
    if (!card) return;
    if (bulkMode) {
      const id = card.dataset.open;
      if (picked.has(id)) picked.delete(id); else picked.add(id);
      render();
      return;
    }
    openVideo(card.dataset.open);
  });

  // 批次編輯 Hashtag
  // 記錄工具列高度，讓提示訊息顯示在工具列上方
  new ResizeObserver(([entry]) => document.documentElement.style.setProperty("--bulk-h", entry.target.offsetHeight + "px")).observe($("#bulk-bar"));
  $("#bulk-btn").addEventListener("click", () => setBulkMode(!bulkMode));
  $("#bulk-done").addEventListener("click", () => setBulkMode(false));
  $("#bulk-all").addEventListener("click", () => { shownIds.forEach((id) => picked.add(id)); render(); });
  $("#bulk-none").addEventListener("click", () => { picked.clear(); render(); });
  $("#bulk-tags").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-bulk-remove]");
    if (!btn) return;
    const tag = btn.dataset.bulkRemove;
    bulkApply({ remove: [tag] }, (n) => `已從 ${n} 部影片移除 #${tag}`);
  });
  $("#bulk-add-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = $("#bulk-add-input");
    const tags = parseTags(input.value);
    if (!tags.length) { toast("請輸入要加入的 Hashtag"); input.focus(); return; }
    input.value = "";
    await bulkApply({ add: tags }, (n) => `已替 ${n} 部影片加入 ${tags.map((t) => "#" + t).join(" ")}`);
    input.focus();
  });

  registerView("library", {
    onShow: render,
    onData: render,
    onHide() { if (bulkMode) { bulkMode = false; picked.clear(); $("#bulk-bar").hidden = true; $("#view-library").classList.remove("bulk-mode"); } },
  });
}
