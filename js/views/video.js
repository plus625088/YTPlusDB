/**
 * 「影片」分頁：內嵌播放器、時間點列表、補充評論、快速新增、管理者刪除。
 */
import { CLOUD, LIMITS, PENDING_TAG } from "../config.js";
import { $, esc, toast, run, captureDrafts, restoreDrafts } from "../core/dom.js";
import { state, getVideo, sortMarks, isAdmin, isMine, canEdit, getName, setName } from "../core/state.js";
import { parseTime, formatTime, formatDate, parseTags, watchUrl, hasTime } from "../core/format.js";
import { registerView, show, nav } from "../core/router.js";
import {
  mountPlayer, seekTo, pausePlayer, currentTime, isPlayerReady, currentVideoData,
  getApiStatus, onApiStatusChange, onPlayerUpdate,
} from "../youtube/player.js";

/* ---------- 這個分頁的狀態 ---------- */

let currentId = null;            // 目前開啟的影片 ID
const expanded = new Set();      // 展開補充的時間點 ID
let editingMarkId = null;        // 正在編輯的時間點
let confirmMarkId = null;        // 正在確認刪除的時間點
let editingCommentId = null;     // 正在編輯的補充
let confirmCommentId = null;     // 正在確認刪除的補充
let activeMarkId;                // 目前播放位置所在的時間點

const currentVideo = () => getVideo(currentId);

/* ================= 開啟影片 ================= */

/**
 * 開啟影片頁。
 * @param id         影片 ID
 * @param startAt    從第幾秒開始播放（可省略）
 * @param expandMark 要自動展開補充的時間點 ID（可省略）
 */
export function openVideo(id, startAt, expandMark) {
  if (!getVideo(id)) return show("library");
  if (expandMark) expanded.add(expandMark);
  currentId = id;
  editingMarkId = confirmMarkId = editingCommentId = confirmCommentId = null;

  show("video");
  $("#del-confirm").hidden = true;
  $("#quick-time").value = "";
  $("#quick-note").value = "";
  $("#quick-name").value = getName();
  renderMeta(true);
  renderMarks();
  renderPlayerFallback();
  mountPlayer(id, startAt);
}

/* ================= 播放器 ================= */

function renderPlayerFallback() {
  const box = $("#player-fallback");
  const status = getApiStatus();
  box.hidden = status === "ready" || !currentId;
  if (box.hidden) return;
  box.innerHTML = status === "failed"
    ? `<strong>無法載入 YouTube 播放器</strong>
       <span>請確認網路連線，或直接在 YouTube 觀看。點時間碼會在 YouTube 新分頁開啟對應時間。</span>
       <a href="${esc(watchUrl(currentId))}" target="_blank" rel="noopener noreferrer">在 YouTube 開啟這部影片 ↗</a>`
    : `<span>播放器載入中…</span>`;
}

/** 跳到指定秒數，播放器不在畫面內時捲動過去 */
function jumpTo(seconds) {
  seekTo(seconds);
  const box = $("#player-box");
  const top = box.getBoundingClientRect().top;
  if (top < 0 || top > window.innerHeight * 0.6) {
    const smooth = !matchMedia("(prefers-reduced-motion: reduce)").matches;
    box.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
  }
  setTimeout(() => highlightActiveMark(true), 300);
}

/** 標亮目前播放位置所在的時間點 */
function highlightActiveMark(force) {
  if (nav.current !== "video") return;
  const now = currentTime();
  const v = currentVideo();
  if (now == null || !v) return;

  let active = null;
  for (const m of v.marks) if (hasTime(m.t) && m.t <= now + 0.5) active = m.id;
  if (active === activeMarkId && !force) return;
  activeMarkId = active;
  document.querySelectorAll("#mark-list .mark").forEach((li) => li.classList.toggle("active", li.dataset.id === active));
}

/** 播放時如果影片還沒有標題或頻道，順便補上 */
function fillMetaFromPlayer() {
  const data = currentVideoData();
  const v = data && getVideo(data.videoId);
  if (!v) return;
  const patch = {};
  if (!v.title && data.title) patch.title = data.title.slice(0, LIMITS.title);
  if (!v.channel && data.channel) patch.channel = data.channel.slice(0, LIMITS.channel);
  if (Object.keys(patch).length) state.store.fillEmpty(v.id, patch).catch(() => {});
}

/* ================= 影片資訊（標題、頻道、Hashtag） ================= */

function renderMeta(force) {
  const v = currentVideo();
  if (!v) return;
  const admin = isAdmin();

  for (const [sel, value] of [["#title-input", v.title || ""], ["#channel-input", v.channel || ""]]) {
    const el = $(sel);
    el.readOnly = !admin;
    if (force || document.activeElement !== el) el.value = value; // 不要蓋掉正在輸入的內容
  }
  fitTitle();
  $("#channel-input").placeholder = admin ? "頻道名稱" : "—";
  renderTagEditor(v, admin);
  $("#sample-chip").hidden = !v.sample;
  $("#pub-date").textContent = v.publishedAt ? formatDate(v.publishedAt) : "—";
  $("#yt-link").href = watchUrl(v.id);

  $("#del-video").hidden = !admin;
  if (!admin) $("#del-confirm").hidden = true;
  $("#del-confirm-text").textContent =
    `「${v.title || "未命名影片"}」和它的 ${v.marks.length} 個時間點（包含其他人新增的）都會被刪除` +
    `${CLOUD ? "，所有人都看不到" : ""}，而且無法復原。`;
}

/** 標題欄依內容自動長高，長標題可以完整顯示 */
function fitTitle() {
  const el = $("#title-input");
  el.style.height = "auto";
  el.style.height = el.scrollHeight + (el.offsetHeight - el.clientHeight) + "px"; // 加上框線高度
}

/* ================= Hashtag 標籤 ================= */

/** 目前的 Hashtag 顯示成獨立標籤；管理者每個標籤有 ✕，下方有新增欄位 */
function renderTagEditor(v, admin) {
  const tags = v.tags || [];
  $("#tag-chips").innerHTML = tags.length
    ? tags.map((t) => `<span class="tag tag-chip${t === PENDING_TAG ? " pending" : ""}">#${esc(t)}${admin
        ? `<button type="button" class="tag-x" data-remove-tag="${esc(t)}" aria-label="移除 #${esc(t)}" title="移除">×</button>` : ""}</span>`).join("")
    : '<span class="tag-empty">還沒有 Hashtag</span>';

  $("#tag-add-input").hidden = !admin;
  if (!admin) return;
  // 新增時的建議：網站上其他影片用過、這部影片還沒有的標籤
  const used = new Set(state.db.videos.flatMap((x) => x.tags || []));
  $("#tag-suggest").innerHTML = [...used].filter((t) => !tags.includes(t)).sort().map((t) => `<option value="${esc(t)}">`).join("");
}

async function saveTags(tags, message) {
  if (!isAdmin()) return false;
  return run(() => state.store.updateVideo(currentId, { tags }), message);
}

/** 輸入框按 Enter：加入一個或多個 Hashtag（可以一次輸入「#a #b」） */
async function onTagInputKey(e) {
  if (e.key !== "Enter" || e.isComposing) return; // 中文輸入法選字時的 Enter 不算
  e.preventDefault();
  const input = e.target;
  const v = currentVideo();
  if (!v) return;
  const current = v.tags || [];
  const added = parseTags(input.value).filter((t) => !current.includes(t));
  if (!added.length) {
    if (input.value.trim()) toast("這個 Hashtag 已經有了");
    input.value = "";
    return;
  }
  if (current.length + added.length > LIMITS.tags) { toast(`每部影片最多 ${LIMITS.tags} 個 Hashtag`); return; }
  input.value = "";
  const ok = await saveTags([...current, ...added], `已加入 ${added.map((t) => "#" + t).join(" ")}`);
  if (!ok) input.value = added.join(" ");
  input.focus();
}

/** 按標籤上的 ✕：移除這個 Hashtag */
async function onTagChipClick(e) {
  const btn = e.target.closest("[data-remove-tag]");
  const v = currentVideo();
  if (!btn || !v) return;
  const tag = btn.dataset.removeTag;
  btn.disabled = true;
  await saveTags((v.tags || []).filter((t) => t !== tag), `已移除 #${tag}`);
}

/* ================= 時間點列表 ================= */

function renderComment(c) {
  const id = esc(c.id);
  if (c.id === editingCommentId && canEdit(c)) {
    return `<form class="comment" data-cedit="${id}">
      <textarea id="ce-${id}" maxlength="${LIMITS.note}" aria-label="修改補充">${esc(c.text)}</textarea>
      <div class="row" style="gap:6px">
        <button class="btn sm primary" type="submit">儲存</button>
        <button class="btn sm" type="button" data-ccancel>取消</button>
      </div>
    </form>`;
  }
  const edit = canEdit(c) ? `<button class="linkbtn" data-cedit-btn="${id}">編輯</button>` : "";
  const del = !isAdmin() ? "" : confirmCommentId === c.id
    ? `<button class="linkbtn danger" data-cdel="${id}">確定刪除？</button>`
    : `<button class="linkbtn" data-caskdel="${id}">刪除</button>`;
  return `<div class="comment">
    <div class="ctext">${esc(c.text)}</div>
    <div class="cmeta"><span>— ${esc(c.author)}</span>${isMine(c) ? '<span class="mine" style="margin-left:0">你寫的</span>' : ""}${edit}${del}</div>
  </div>`;
}

function renderThread(m) {
  const id = esc(m.id);
  const comments = m.comments || [];
  const open = expanded.has(m.id);
  const label = comments.length ? `${comments.length} 則補充` : "補充或評論";
  return `<div class="thread">
    <button class="thread-toggle" data-toggle="${id}" aria-expanded="${open}">💬 ${label} ${open ? "▴" : "▾"}</button>
    ${!open ? "" : `<div class="thread-body">
      ${comments.map(renderComment).join("")}
      <form class="cform" data-cform="${id}">
        <textarea id="cf-text-${id}" rows="1" placeholder="補充說明或評論…" maxlength="${LIMITS.note}" aria-label="補充內容"></textarea>
        <div class="row">
          <input type="text" id="cf-name-${id}" placeholder="你的名字" maxlength="${LIMITS.author}" value="${esc(getName())}" aria-label="你的名字">
          <button class="btn sm primary" type="submit">送出</button>
        </div>
      </form>
    </div>`}
  </div>`;
}

function renderMark(v, m) {
  const id = esc(m.id);
  if (m.id === editingMarkId && canEdit(m)) {
    return `<li class="mark editing" data-id="${id}">
      <form class="stack" style="gap:8px" data-edit="${id}">
        <input type="text" class="tcin" id="edit-t-${id}" value="${hasTime(m.t) ? formatTime(m.t) : ""}" placeholder="可不填" aria-label="時間碼">
        <textarea id="edit-n-${id}" maxlength="${LIMITS.note}" aria-label="說明">${esc(m.note)}</textarea>
        <div class="row">
          <button class="btn primary" type="submit">儲存</button>
          <button class="btn" type="button" data-cancel>取消</button>
        </div>
      </form>
    </li>`;
  }

  const editBtn = canEdit(m) ? `<button class="btn ghost small" data-edit-btn="${id}">編輯</button>` : "";
  const delBtn = !isAdmin() ? "" : confirmMarkId === m.id
    ? `<button class="btn ghost danger small" data-del="${id}">確定刪除？</button>`
    : `<button class="btn ghost small" data-askdel="${id}">刪除</button>`;
  const actions = editBtn || delBtn ? `<div class="acts">${editBtn}${delBtn}</div>` : "<span></span>";
  const byline = m.author || isMine(m)
    ? `<span class="by">${m.author ? "— " + esc(m.author) : ""}${isMine(m) ? '<span class="mine">你新增的</span>' : ""}</span>`
    : "";

  return `<li class="mark" data-id="${id}">
    ${hasTime(m.t)
      ? `<a class="tc-chip" href="${esc(watchUrl(v.id, m.t))}" target="_blank" rel="noopener noreferrer" data-seek="${m.t}">${formatTime(m.t)}</a>`
      : '<span class="tc-chip no-time" title="沒有時間碼，是整部影片的說明">整部</span>'}
    <div class="note">${esc(m.note) || '<span class="muted">（無說明）</span>'}${byline}</div>
    ${actions}
    ${renderThread(m)}
  </li>`;
}

function renderMarks() {
  const v = currentVideo();
  if (!v) return;
  sortMarks(v);

  $("#mark-count").textContent = `${v.marks.length} 筆`;
  const toggleAll = $("#toggle-all");
  const allOpen = v.marks.length > 0 && v.marks.every((m) => expanded.has(m.id));
  toggleAll.hidden = !v.marks.length;
  toggleAll.textContent = allOpen ? "全部收起" : "全部展開";
  toggleAll.dataset.mode = allOpen ? "close" : "open";

  const list = $("#mark-list");
  if (!v.marks.length) {
    list.innerHTML = `<li class="empty">還沒有時間點。播放影片，按「記下目前時間」開始記錄。</li>`;
    return;
  }
  const drafts = captureDrafts(list); // 資料即時更新時，保留正在輸入的內容
  list.innerHTML = v.marks.map((m) => renderMark(v, m)).join("");
  restoreDrafts(list, drafts);
  activeMarkId = undefined;
  highlightActiveMark(true);
}

/* ================= 事件處理 ================= */

/** 時間點列表裡的各種按鈕 */
async function onListClick(e) {
  const target = e.target;
  const pick = (attr) => target.closest(`[${attr}]`);
  const v = currentVideo();

  const seek = pick("data-seek");
  if (seek && isPlayerReady()) { e.preventDefault(); jumpTo(Number(seek.dataset.seek)); return; }

  const toggle = pick("data-toggle");
  if (toggle) {
    const id = toggle.dataset.toggle;
    if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
    renderMarks();
    const mark = v.marks.find((m) => m.id === id);
    if (expanded.has(id) && !mark?.comments.length) document.getElementById("cf-text-" + id)?.focus();
    return;
  }

  // 時間點：編輯、取消、刪除（兩段式確認）
  const editBtn = pick("data-edit-btn");
  if (editBtn) {
    editingMarkId = editBtn.dataset.editBtn; confirmMarkId = null; renderMarks();
    document.getElementById("edit-n-" + editingMarkId)?.focus();
    return;
  }
  if (pick("data-cancel")) { editingMarkId = null; renderMarks(); return; }
  const askDel = pick("data-askdel");
  if (askDel) { confirmMarkId = askDel.dataset.askdel; renderMarks(); return; }
  const del = pick("data-del");
  if (del) {
    confirmMarkId = null;
    expanded.delete(del.dataset.del);
    await run(() => state.store.deleteMark(currentId, del.dataset.del), "已刪除");
    return;
  }

  // 補充：編輯、取消、刪除
  const cEdit = pick("data-cedit-btn");
  if (cEdit) {
    editingCommentId = cEdit.dataset.ceditBtn; confirmCommentId = null; renderMarks();
    document.getElementById("ce-" + editingCommentId)?.focus();
    return;
  }
  if (pick("data-ccancel")) { editingCommentId = null; renderMarks(); return; }
  const cAsk = pick("data-caskdel");
  if (cAsk) { confirmCommentId = cAsk.dataset.caskdel; renderMarks(); return; }
  const cDel = pick("data-cdel");
  if (cDel) {
    confirmCommentId = null;
    await run(() => state.store.deleteComment(currentId, cDel.dataset.cdel), "已刪除補充");
  }
}

/** 時間點列表裡的表單送出：修改時間點、新增補充、修改補充 */
async function onListSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const field = (id) => document.getElementById(id);

  if (form.dataset.edit) {
    const id = form.dataset.edit;
    const timeText = field("edit-t-" + id).value.trim();
    const t = timeText ? parseTime(timeText) : null; // 時間碼可以清空
    if (timeText && t === null) { toast("時間格式看不懂，例：1:23"); return; }
    const note = field("edit-n-" + id).value.trim().slice(0, LIMITS.note);
    if (t === null && !note) { toast("時間碼和說明至少要填一個"); return; }
    editingMarkId = null;
    if (await run(() => state.store.updateMark(currentId, id, { t, note }), "已更新")) renderMarks();
    return;
  }

  if (form.dataset.cform) {
    const markId = form.dataset.cform;
    const text = field("cf-text-" + markId).value.trim().slice(0, LIMITS.note);
    const name = field("cf-name-" + markId).value.trim().slice(0, LIMITS.author);
    if (!text) { toast("請輸入補充內容"); return; }
    if (!name) { toast("請填上你的名字"); field("cf-name-" + markId).focus(); return; }
    setName(name);
    if (await run(() => state.store.addComment(currentId, markId, text, name), "已送出")) {
      const box = field("cf-text-" + markId);
      if (box) box.value = "";
    }
    return;
  }

  if (form.dataset.cedit) {
    const id = form.dataset.cedit;
    const text = field("ce-" + id).value.trim().slice(0, LIMITS.note);
    if (!text) { toast("內容不能是空的"); return; }
    editingCommentId = null;
    if (await run(() => state.store.updateComment(currentId, id, { text }), "已更新")) renderMarks();
  }
}

/** 下方的快速新增欄 */
async function onQuickAdd(e) {
  e.preventDefault();
  const name = $("#quick-name").value.trim();
  if (!name) { toast("請填上你的名字"); $("#quick-name").focus(); return; }

  // 時間碼可不填：播放中會自動用目前播放位置，否則存成整部影片的說明
  let timeText = $("#quick-time").value.trim();
  if (!timeText && currentTime() != null) timeText = String(Math.floor(currentTime()));
  const t = timeText ? parseTime(timeText) : null;
  if (timeText && t === null) { toast("時間格式看不懂，例：1:23"); return; }
  const note = $("#quick-note").value.trim().slice(0, LIMITS.note);
  if (t === null && !note) { toast("請輸入時間碼或說明"); return; }

  setName(name);
  if (await run(() => state.store.addMark(currentId, t, note, name), t === null ? "已新增說明" : `已新增 ${formatTime(t)}`)) {
    $("#quick-time").value = "";
    $("#quick-note").value = "";
  }
}

/** 管理者修改標題、頻道、Hashtag（Hashtag 的處理在上方「Hashtag 標籤」） */
function bindMetaEditing() {
  const update = (patch, message) => { if (isAdmin()) run(() => state.store.updateVideo(currentId, patch), message); };
  const title = $("#title-input");
  title.addEventListener("change", (e) => update({ title: e.target.value.replace(/\s*\n\s*/g, " ").trim().slice(0, LIMITS.title) }, "已更新標題"));
  title.addEventListener("input", fitTitle);
  // 標題只有一行：按 Enter 等於完成編輯
  title.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); title.blur(); } });
  new ResizeObserver(fitTitle).observe(title);
  $("#channel-input").addEventListener("change", (e) => update({ channel: e.target.value.trim().slice(0, LIMITS.channel) }, "已更新頻道"));
  $("#tag-add-input").addEventListener("keydown", onTagInputKey);
  $("#tag-chips").addEventListener("click", onTagChipClick);
}

/** 管理者刪除整部影片（需在確認框再按一次） */
function bindDeleteVideo() {
  $("#del-video").addEventListener("click", () => { $("#del-confirm").hidden = false; $("#del-video-no").focus(); });
  $("#del-video-no").addEventListener("click", () => { $("#del-confirm").hidden = true; });
  $("#del-video-yes").addEventListener("click", async () => {
    const btn = $("#del-video-yes");
    btn.disabled = true;
    btn.textContent = "刪除中…";
    const ok = await run(() => state.store.deleteVideo(currentId), "已刪除影片");
    btn.disabled = false;
    btn.textContent = "刪除影片與所有時間點";
    if (ok) { currentId = null; show("library"); }
  });
}

/* ================= 初始化 ================= */

export function initVideo() {
  $("#mark-list").addEventListener("click", onListClick);
  $("#mark-list").addEventListener("submit", onListSubmit);
  $("#quick-form").addEventListener("submit", onQuickAdd);
  $("#back-btn").addEventListener("click", () => show(nav.previous === "video" ? "library" : nav.previous));
  $("#grab-time").addEventListener("click", () => {
    const now = currentTime();
    if (now == null) { toast("播放器還沒準備好"); return; }
    $("#quick-time").value = formatTime(now);
    $("#quick-note").focus();
  });
  $("#toggle-all").addEventListener("click", () => {
    const v = currentVideo();
    if (!v) return;
    const open = $("#toggle-all").dataset.mode === "open";
    v.marks.forEach((m) => (open ? expanded.add(m.id) : expanded.delete(m.id)));
    renderMarks();
  });
  bindMetaEditing();
  bindDeleteVideo();

  onApiStatusChange(renderPlayerFallback);
  onPlayerUpdate((info) => {
    if (info?.error) toast("這支影片無法內嵌播放，請改用 YouTube 開啟");
    else fillMetaFromPlayer();
  });
  setInterval(() => highlightActiveMark(false), 500);

  registerView("video", {
    onHide: pausePlayer,
    onData() {
      if (!currentVideo()) {
        if (state.loaded) { toast("這部影片已被刪除"); show("library"); }
        return;
      }
      renderMeta();
      renderMarks();
    },
  });
}
