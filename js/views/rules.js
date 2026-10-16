/**
 * 「設定」分頁（只有管理者）：網站功能開關、自動加上 Hashtag 的規則。
 *
 * 編輯中的內容放在 draft，按「儲存規則」才寫入資料庫。
 * 如果改了某條規則的標籤名稱（或「待補」的名稱），儲存時會把現有影片上的舊名稱一起改掉。
 */
import { $, esc, toast, run } from "../core/dom.js";
import { state, isAdmin, commentsEnabled } from "../core/state.js";
import { registerView } from "../core/router.js";
import {
  getSettings, normalizeSettings, tagsFromRules, tagClass, sortTags,
} from "../core/autotag.js";

let draft = null;       // 編輯中的設定
let applyPlan = null;   // 「套用到現有影片」的預覽結果

const clone = (x) => JSON.parse(JSON.stringify(x));
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** 編輯中的內容是否和已儲存的不同 */
const isDirty = () => draft && !sameJson(normalizeSettings(draft), normalizeSettings(getSettings()));

/** 把畫面上的輸入值讀回 draft */
function readForm() {
  draft.rules = [...$("#rule-list").querySelectorAll(".rule-row")].map((row) => ({
    id: row.dataset.id,
    field: row.querySelector("[data-k=field]").value,
    op: row.querySelector("[data-k=op]").value,
    keywords: row.querySelector("[data-k=keywords]").value.split(/[,，、]/).map((k) => k.trim()).filter(Boolean),
    tag: row.querySelector("[data-k=tag]").value,
  }));
  draft.pending = { enabled: $("#pending-enabled").checked, tag: $("#pending-tag").value };
}

/** 儲存時要把哪些現有標籤改名：[[舊名稱, 新名稱]] */
function plannedRenames() {
  const saved = getSettings();
  const next = normalizeSettings(draft);
  const renames = [];
  const nextTags = new Set(next.rules.map((r) => r.tag));
  for (const r of next.rules) {
    const old = saved.rules.find((x) => x.id === r.id);
    if (old && old.tag !== r.tag && !nextTags.has(old.tag)) renames.push([old.tag, r.tag]);
  }
  if (saved.pending.tag !== next.pending.tag && next.pending.enabled) renames.push([saved.pending.tag, next.pending.tag]);
  const inUse = new Set(state.db.videos.flatMap((v) => v.tags || []));
  return renames.filter(([oldName]) => inUse.has(oldName));
}

/* ---------- 畫面 ---------- */

function renderRuleRow(r) {
  const opt = (value, label, current) => `<option value="${value}"${value === current ? " selected" : ""}>${label}</option>`;
  return `<div class="rule-row" data-id="${esc(r.id)}">
    <button type="button" class="drag-handle" aria-label="拖曳調整順序（也可以用上下鍵）" title="拖曳調整順序">⠿</button>
    <select data-k="field" aria-label="判斷欄位">${opt("title", "標題", r.field)}${opt("channel", "頻道", r.field)}</select>
    <select data-k="op" aria-label="條件">${opt("contains", "包含", r.op)}${opt("notContains", "不包含", r.op)}</select>
    <input class="kw" type="text" data-k="keywords" value="${esc((r.keywords || []).join(", "))}" placeholder="關鍵字，例：會員專屬, 限定" aria-label="關鍵字">
    <span class="arrow">→ 加上</span>
    <span class="tag-input-wrap">#<input type="text" data-k="tag" value="${esc(r.tag)}" maxlength="40" placeholder="標籤" aria-label="要加上的標籤"></span>
    <button type="button" class="btn ghost sm" data-del-rule="${esc(r.id)}" aria-label="刪除這條規則" title="刪除">✕</button>
  </div>`;
}

function renderForm() {
  $("#rule-list").innerHTML = draft.rules.length
    ? draft.rules.map(renderRuleRow).join("")
    : '<div class="hint">還沒有規則。</div>';
  $("#pending-enabled").checked = draft.pending.enabled;
  $("#pending-tag").value = draft.pending.tag;
  renderStatus();
}

/** 更新儲存按鈕、改名提醒、試試看的結果 */
function renderStatus() {
  const dirty = isDirty();
  $("#rules-save").disabled = !dirty;
  $("#rules-reset").hidden = !dirty;
  $("#rules-status").textContent = dirty ? "有尚未儲存的修改" : "";

  const renames = dirty ? plannedRenames() : [];
  $("#rules-rename-note").innerHTML = renames.length
    ? "儲存後，現有影片上的標籤也會一起改名：" + renames.map(([a, b]) => `#${esc(a)} → #${esc(b)}`).join("、")
    : "";

  // 試試看：用編輯中的規則判斷
  const title = $("#rules-test-title").value.trim();
  const channel = $("#rules-test-channel").value.trim();
  const tags = title || channel ? tagsFromRules({ title, channel }, normalizeSettings(draft)) : [];
  $("#rules-test-result").innerHTML = !title && !channel
    ? '<span class="small muted">輸入標題，看看會自動加上哪些標籤。</span>'
    : tags.length
      ? '<span class="small muted">會加上：</span>' + sortTags(tags).map((t) => `<span class="tag auto">#${esc(t)}</span>`).join("")
      : '<span class="small muted">沒有符合的規則。</span>';

  $("#rules-check").disabled = dirty;
  $("#rules-check").title = dirty ? "請先儲存規則" : "";
}

/* ---------- 拖曳調整規則順序 ---------- */

/**
 * 按住左邊的 ⠿ 拖曳，滑鼠和手機觸控都可以；
 * 也可以點一下 ⠿ 再按鍵盤上下鍵移動。
 */
function bindDragSort() {
  const list = $("#rule-list");
  let dragging = null;

  const finish = () => {
    if (!dragging) return;
    dragging.classList.remove("dragging");
    list.classList.remove("sorting");
    dragging = null;
    readForm();     // 依畫面上的新順序讀回 draft
    renderStatus();
  };

  list.addEventListener("pointerdown", (e) => {
    const handle = e.target.closest(".drag-handle");
    if (!handle || e.button > 0) return;
    e.preventDefault();
    dragging = handle.closest(".rule-row");
    dragging.classList.add("dragging");
    list.classList.add("sorting");
    handle.setPointerCapture(e.pointerId);
  });

  list.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    // 找出指標所在位置的那一列，移到它的上方或下方
    const rows = [...list.querySelectorAll(".rule-row")].filter((r) => r !== dragging);
    const target = rows.find((r) => {
      const box = r.getBoundingClientRect();
      return e.clientY < box.top + box.height / 2;
    });
    if (target) { if (dragging.nextElementSibling !== target) list.insertBefore(dragging, target); }
    else if (list.lastElementChild !== dragging) list.appendChild(dragging);
  });

  list.addEventListener("pointerup", finish);
  list.addEventListener("pointercancel", finish);

  // 鍵盤：焦點在 ⠿ 上時按上下鍵移動
  list.addEventListener("keydown", (e) => {
    const handle = e.target.closest(".drag-handle");
    if (!handle || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault();
    const row = handle.closest(".rule-row");
    const sibling = e.key === "ArrowUp" ? row.previousElementSibling : row.nextElementSibling;
    if (!sibling) return;
    if (e.key === "ArrowUp") list.insertBefore(row, sibling); else list.insertBefore(sibling, row);
    handle.focus();
    readForm();
    renderStatus();
  });
}

/* ---------- 儲存 ---------- */

async function save() {
  readForm();
  const next = normalizeSettings(draft);
  const dropped = draft.rules.length - next.rules.length;
  const renames = plannedRenames();

  const button = $("#rules-save");
  button.disabled = true;
  $("#rules-status").textContent = "儲存中…";
  const ok = await run(async () => {
    await state.store.saveSettings(next);
    for (const [oldName, newName] of renames) await state.store.renameTag(oldName, newName);
  });
  if (!ok) { renderStatus(); return; }

  state.settings = next; // 雲端模式會再由資料庫同步一次
  draft = clone(next);
  applyPlan = null;
  $("#rules-apply-preview").hidden = true;
  renderForm();
  toast("已儲存規則" + (renames.length ? `，並改名 ${renames.length} 個標籤` : "") + (dropped ? `（${dropped} 條沒填完整的規則已略過）` : ""));
}

/* ---------- 套用到現有影片 ---------- */

function checkExisting() {
  const settings = getSettings();
  const pending = settings.pending.enabled ? settings.pending.tag : null;
  const changes = {};
  const lines = [];
  for (const v of state.db.videos) {
    const old = v.tags || [];
    let next = [...new Set([...old, ...tagsFromRules(v, settings)])];
    if (pending) next = v.marks.length ? next.filter((t) => t !== pending) : [...new Set([...next, pending])];
    const added = next.filter((t) => !old.includes(t));
    const removed = old.filter((t) => !next.includes(t));
    if (!added.length && !removed.length) continue;
    changes[v.id] = next;
    lines.push(`<div><b>${esc(v.title || v.id)}</b>　${added.map((t) => `<span class="tag auto">+#${esc(t)}</span>`).join(" ")} ${removed.map((t) => `<span class="tag">−#${esc(t)}</span>`).join(" ")}</div>`);
  }
  applyPlan = changes;

  const box = $("#rules-apply-preview");
  box.hidden = false;
  box.innerHTML = lines.length
    ? `<div class="hint">${lines.length} 部影片會更新：</div>
       <div class="apply-list">${lines.join("")}</div>
       <div><button type="button" class="btn primary sm" id="rules-apply">套用到這 ${lines.length} 部影片</button></div>`
    : '<div class="hint ok">所有影片都已經符合目前的規則。</div>';
}

async function applyExisting(button) {
  if (!applyPlan || !Object.keys(applyPlan).length) return;
  button.disabled = true;
  button.textContent = "套用中…";
  let count = 0;
  const ok = await run(async () => { count = await state.store.setTagsMany(applyPlan); });
  if (ok) {
    toast(`已更新 ${count} 部影片的標籤`);
    applyPlan = null;
    $("#rules-apply-preview").innerHTML = `<div class="hint ok">已更新 ${count} 部影片。</div>`;
  } else {
    button.disabled = false;
    button.textContent = "再試一次";
  }
}

/* ---------- 功能開關（切換後立即儲存） ---------- */

function renderSite() {
  const box = $("#site-comments");
  if (!box.disabled) box.checked = commentsEnabled(); // 儲存中不要蓋掉
}

async function onCommentsToggle(e) {
  const box = e.target;
  const on = box.checked;
  box.disabled = true;
  $("#site-status").textContent = "儲存中…";
  const ok = await run(() => state.store.saveSite({ commentsEnabled: on }), on ? "已開放補充／評論" : "已關閉補充／評論");
  box.disabled = false;
  $("#site-status").textContent = "";
  if (!ok) box.checked = !on;
}

/* ---------- 初始化 ---------- */

function loadDraft() {
  draft = clone(getSettings());
  renderForm();
}

export function initRules() {
  $("#rule-add").addEventListener("click", () => {
    readForm();
    draft.rules.push({ id: "r" + Date.now().toString(36), field: "title", op: "contains", keywords: [], tag: "" });
    renderForm();
    $("#rule-list .rule-row:last-child [data-k=keywords]").focus();
  });
  $("#rule-list").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-del-rule]");
    if (!btn) return;
    readForm();
    draft.rules = draft.rules.filter((r) => r.id !== btn.dataset.delRule);
    renderForm();
  });
  // 任何欄位修改都即時更新狀態
  for (const sel of ["#rule-list", "#pending-enabled", "#pending-tag"]) {
    $(sel).addEventListener("input", () => { readForm(); renderStatus(); });
    $(sel).addEventListener("change", () => { readForm(); renderStatus(); });
  }
  $("#rules-test-title").addEventListener("input", renderStatus);
  $("#rules-test-channel").addEventListener("input", renderStatus);
  bindDragSort();
  $("#site-comments").addEventListener("change", onCommentsToggle);
  $("#rules-save").addEventListener("click", save);
  $("#rules-reset").addEventListener("click", loadDraft);
  $("#rules-check").addEventListener("click", checkExisting);
  $("#rules-apply-preview").addEventListener("click", (e) => {
    const btn = e.target.closest("#rules-apply");
    if (btn) applyExisting(btn);
  });

  registerView("rules", {
    adminOnly: true,
    onShow() { renderSite(); if (!draft || !isDirty()) loadDraft(); else renderStatus(); },
    // 資料更新時：正在編輯就保留草稿，否則載入最新的規則
    onData() { renderSite(); if (!draft || !isDirty()) loadDraft(); else renderStatus(); },
  });
}

/** 只有管理者看得到「設定」選單 */
export function updateRulesVisibility() {
  $("#nav-rules").hidden = !isAdmin();
}
