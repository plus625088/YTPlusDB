/**
 * 「影片」分頁：內嵌播放器、時間點列表、補充評論、快速新增、管理者刪除。
 */
import { CLOUD, LIMITS } from "../config.js";
import { $, esc, toast, run, captureDrafts, restoreDrafts } from "../core/dom.js";
import { state, getVideo, sortMarks, isAdmin, isMine, canEdit, getName, setName } from "../core/state.js";
import { parseTime, formatTime, formatDate, parseTags, tagsToText, watchUrl } from "../core/format.js";
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
  for (const m of v.marks) if (m.t <= now + 0.5) active = m.id;
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

  for (const [sel, value] of [["#title-input", v.title || ""], ["#channel-input", v.channel || ""], ["#tags-input", tagsToText(v.tags)]]) {
    const el = $(sel);
    el.readOnly = !admin;
    if (force || document.activeElement !== el) el.value = value; // 不要蓋掉正在輸入的內容
  }
  $("#channel-input").placeholder = admin ? "頻道名稱" : "—";
  $("#tags-input").placeholder = admin ? "#演唱會 #必看（用空白分開）" : "—";
  $("#sample-chip").hidden = !v.sample;
  $("#pub-date").textContent = v.publishedAt ? formatDate(v.publishedAt) : "—";
  $("#yt-link").href = watchUrl(v.id);

  $("#del-video").hidden = !admin;
  if (!admin) $("#del-confirm").hidden = true;
  $("#del-confirm-text").textContent =
    `「${v.title || "未命名影片"}」和它的 ${v.marks.length} 個時間點（包含其他人新增的）都會被刪除` +
    `${CLOUD ? "，所有人都看不到" : ""}，而且無法復原。`;
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
        <input type="text" class="tcin" id="edit-t-${id}" value="${formatTime(m.t)}" aria-label="時間碼">
        <textarea id="edit-n-${id}" maxlength="${LIMITS.note}" aria-label="備註">${esc(m.note)}</textarea>
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
    <a class="tc-chip" href="${esc(watchUrl(v.id, m.t))}" target="_blank" rel="noopener noreferrer" data-seek="${m.t}">${formatTime(m.t)}</a>
    <div class="note">${esc(m.note) || '<span class="muted">（無備註）</span>'}${byline}</div>
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
    const t = parseTime(field("edit-t-" + id).value);
    if (t === null) { toast("時間格式看不懂，例：1:23"); return; }
    const note = field("edit-n-" + id).value.trim().slice(0, LIMITS.note);
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

  let timeText = $("#quick-time").value;
  if (!timeText.trim() && currentTime() != null) timeText = String(Math.floor(currentTime()));
  const t = parseTime(timeText);
  if (t === null) { toast("請輸入時間，例：1:23"); return; }

  setName(name);
  const note = $("#quick-note").value.trim().slice(0, LIMITS.note);
  if (await run(() => state.store.addMark(currentId, t, note, name), `已新增 ${formatTime(t)}`)) {
    $("#quick-time").value = "";
    $("#quick-note").value = "";
  }
}

/** 管理者修改標題、頻道、Hashtag */
function bindMetaEditing() {
  const update = (patch, message) => { if (isAdmin()) run(() => state.store.updateVideo(currentId, patch), message); };
  $("#title-input").addEventListener("change", (e) => update({ title: e.target.value.trim().slice(0, LIMITS.title) }, "已更新標題"));
  $("#channel-input").addEventListener("change", (e) => update({ channel: e.target.value.trim().slice(0, LIMITS.channel) }, "已更新頻道"));
  $("#tags-input").addEventListener("change", (e) => {
    const tags = parseTags(e.target.value);
    e.target.value = tagsToText(tags);
    update({ tags }, "已更新 Hashtag");
  });
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
