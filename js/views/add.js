/**
 * 「新增紀錄」分頁：貼上影片網址、自動帶入標題與頻道、一次輸入多個時間點。
 */
import { LIMITS } from "../config.js";
import { $, run } from "../core/dom.js";
import { state, getVideo, getName, setName } from "../core/state.js";
import { parseVideoId, parseUrlTime, parseTime, formatTime, parseTags, tagsToText } from "../core/format.js";
import { tagsFromRules, pendingTag } from "../core/autotag.js";
import { registerView, nav } from "../core/router.js";
import { fetchVideoMeta } from "../youtube/meta.js";
import { openVideo } from "./video.js";

const URL_HINT = "支援一般網址、youtu.be 短網址、Shorts；網址裡帶的 t= 時間會自動帶入。";
const DEFAULT_TAGS_PLACEHOLDER = "#演唱會 #現場";

let rowCounter = 0;
let lookupToken = 0;      // 避免舊的查詢結果蓋掉新的
let pendingLookup = null; // 送出前要等查詢完成

/* ---------- 時間點輸入列 ---------- */

function addEntryRow() {
  const i = ++rowCounter;
  const row = document.createElement("div");
  row.className = "entry";
  row.innerHTML = `
    <input type="text" class="tcin" id="e-t-${i}" placeholder="1:23" aria-label="時間碼">
    <textarea id="e-n-${i}" rows="1" placeholder="說明…" aria-label="說明" maxlength="${LIMITS.note}"></textarea>
    <button type="button" class="btn ghost" aria-label="移除這一筆" data-rm>✕</button>`;
  $("#entries").appendChild(row);
  return row;
}

function onEntriesClick(e) {
  if (!e.target.closest("[data-rm]")) return;
  const row = e.target.closest(".entry");
  if ($("#entries").children.length > 1) {
    row.remove();
  } else {
    row.querySelector("input").value = "";
    row.querySelector("textarea").value = "";
  }
}

/* ---------- 網址提示與自動帶入 ---------- */

function setUrlHint(text, kind = "") {
  const hint = $("#url-hint");
  hint.className = "hint" + (kind ? " " + kind : "");
  hint.textContent = text;
}

/** 設定標題、頻道欄位；locked 為 true 時欄位鎖定不能手動修改 */
function setMetaFields(title, channel, locked, placeholder) {
  for (const [sel, value, lockSel] of [["#add-title", title, "#title-lock"], ["#add-channel", channel, "#channel-lock"]]) {
    const el = $(sel);
    el.value = value || "";
    el.readOnly = locked;
    el.placeholder = placeholder;
    $(lockSel).textContent = locked ? "🔒 自動帶入" : "（抓不到，請手動輸入）";
  }
  updateMemberHint();
}

/** 顯示這部影片會被自動加上哪些標籤 */
function updateMemberHint() {
  const hint = $("#member-hint");
  const existing = getVideo(parseVideoId($("#add-url").value));
  const tags = tagsFromRules({ title: $("#add-title").value.trim(), channel: $("#add-channel").value.trim() });
  if (existing) {
    hint.textContent = "這部影片已經在網站上，不會再自動加標籤。";
  } else if (!$("#add-title").value.trim()) {
    hint.textContent = "會依「標籤規則」自動加上 Hashtag。";
  } else {
    hint.textContent = tags.length ? `會自動加上 ${tags.map((t) => "#" + t).join(" ")}。` : "沒有符合的自動標籤規則。";
  }
}

function resetMetaFields() {
  setMetaFields("", "", true, "貼上網址後自動帶入");
  pendingLookup = null;
}

function onUrlChange() {
  const text = $("#add-url").value;
  const id = parseVideoId(text);
  const token = ++lookupToken;

  if (!text.trim()) { setUrlHint(URL_HINT); resetMetaFields(); return; }
  if (!id) { setUrlHint("看不出這是哪支 YouTube 影片，請確認網址。", "err"); resetMetaFields(); return; }

  const existing = getVideo(id);
  setUrlHint(existing ? `已有這部影片（${existing.marks.length} 筆），新的時間點會加進去。` : `影片 ID：${id}`, "ok");
  $("#add-tags").placeholder = existing?.tags?.length ? tagsToText(existing.tags) + "（可再加）" : DEFAULT_TAGS_PLACEHOLDER;

  // 網址帶有 t= 時，自動填入第一列的時間
  const t = parseUrlTime(text);
  const firstTime = $("#entries .entry .tcin");
  if (t != null && firstTime && !firstTime.value) firstTime.value = formatTime(t);

  if (existing?.title && existing?.channel) {
    setMetaFields(existing.title, existing.channel, true, "");
    pendingLookup = null;
    return;
  }

  setMetaFields(existing?.title, existing?.channel, true, "抓取中…");
  pendingLookup = fetchVideoMeta(id).then((meta) => {
    if (token !== lookupToken) return; // 使用者已經換了網址
    if (meta) setMetaFields(existing?.title || meta.title, existing?.channel || meta.channel, true, "");
    else setMetaFields(existing?.title, existing?.channel, false, "抓不到影片資訊，請手動輸入");
  });
}

/* ---------- 送出 ---------- */

function showError(message, focusEl) {
  $("#form-err").textContent = message;
  focusEl?.focus();
}

async function onSubmit(e) {
  e.preventDefault();
  $("#form-err").textContent = "";

  const author = $("#add-author").value.trim().slice(0, LIMITS.author);
  if (!author) return showError("請填上你的名字。", $("#add-author"));

  const id = parseVideoId($("#add-url").value);
  if (!id) return showError("請貼上有效的 YouTube 網址。", $("#add-url"));

  const marks = [];
  for (const row of $("#entries").querySelectorAll(".entry")) {
    const timeText = row.querySelector("input").value;
    const note = row.querySelector("textarea").value.trim().slice(0, LIMITS.note);
    if (!timeText.trim() && !note) continue; // 空白列略過
    const t = timeText.trim() ? parseTime(timeText) : null; // 時間碼可不填
    if (timeText.trim() && t === null) return showError(`「${timeText}」不是有效的時間，例：1:23`, row.querySelector("input"));
    marks.push({ t, note });
  }

  const button = $("#add-submit");
  button.disabled = true;
  button.textContent = "儲存中…";
  if (pendingLookup) { try { await pendingLookup; } catch { /* 忽略 */ } }

  const ok = await run(() => state.store.saveRecord({
    id, author, marks,
    title: $("#add-title").value.trim().slice(0, LIMITS.title),
    channel: $("#add-channel").value.trim().slice(0, LIMITS.channel),
    tags: parseTags($("#add-tags").value),
  }), marks.length ? `已儲存 ${marks.length} 筆` : pendingTag() ? `已儲存影片（標記為 #${pendingTag()}）` : "已儲存影片");

  button.disabled = false;
  button.textContent = "儲存紀錄";
  if (!ok) return;

  // 清空表單，開啟剛新增的影片（雲端模式要等資料同步回來）
  setName(author);
  $("#add-url").value = "";
  $("#add-tags").value = "";
  resetMetaFields();
  $("#entries").innerHTML = "";
  setUrlHint(URL_HINT);
  nav.previous = "add";
  const openWhenReady = () => (getVideo(id) ? openVideo(id) : setTimeout(openWhenReady, 150));
  openWhenReady();
}

/* ---------- 初始化 ---------- */

export function initAdd() {
  let urlTimer;
  $("#add-url").addEventListener("input", () => { clearTimeout(urlTimer); urlTimer = setTimeout(onUrlChange, 250); });
  $("#add-title").addEventListener("input", updateMemberHint);
  $("#add-entry").addEventListener("click", () => addEntryRow().querySelector("input").focus());
  $("#entries").addEventListener("click", onEntriesClick);
  $("#add-form").addEventListener("submit", onSubmit);

  // 名字輸入後就記住，下次自動帶入
  for (const sel of ["#add-author", "#quick-name"]) {
    $(sel).addEventListener("change", (e) => { if (e.target.value.trim()) setName(e.target.value); });
  }
  setName(getName());

  registerView("add", {
    onShow() {
      if (!$("#entries").children.length) addEntryRow();
      if (!$("#add-url").value.trim()) setUrlHint(URL_HINT);
    },
  });
}
