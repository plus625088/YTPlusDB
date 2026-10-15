/**
 * 「新增紀錄」分頁下方的「備份與還原」：匯出 JSON、管理者匯入 JSON。
 */
import { CLOUD } from "../config.js";
import { $, toast, run } from "../core/dom.js";
import { state, isAdmin } from "../core/state.js";
import { isVideoId } from "../core/format.js";

/** 把目前資料整理成可備份的 JSON（不含內部 ID） */
function exportData() {
  return {
    videos: state.db.videos.map((v) => ({
      id: v.id, title: v.title, channel: v.channel, tags: v.tags,
      marks: v.marks.map((m) => ({
        t: m.t, note: m.note, author: m.author,
        comments: (m.comments || []).map((c) => ({ text: c.text, author: c.author })),
      })),
    })),
  };
}

/** 檢查並清理匯入的資料，只保留格式正確的部分 */
export function sanitizeImport(data) {
  if (!data || !Array.isArray(data.videos)) return null;
  return {
    videos: data.videos
      .filter((v) => v && isVideoId(v.id))
      .map((v) => ({
        id: v.id,
        title: String(v.title || ""),
        channel: String(v.channel || ""),
        tags: Array.isArray(v.tags) ? v.tags.map(String).slice(0, 30) : [],
        marks: (v.marks || []).filter((m) => m && Number.isInteger(m.t) && m.t >= 0),
      })),
  };
}

function setImportHint(text, kind = "") {
  const hint = $("#import-hint");
  hint.className = "hint" + (kind ? " " + kind : "");
  hint.textContent = text;
}

async function importJson(text) {
  if (!isAdmin()) return setImportHint("只有管理者能匯入。", "err");
  let parsed;
  try { parsed = JSON.parse(text); } catch { return setImportHint("資料格式不對，請貼上完整的備份內容。", "err"); }
  const data = sanitizeImport(parsed);
  if (!data) return setImportHint("找不到影片資料。", "err");

  setImportHint("匯入中…");
  let added = 0;
  const ok = await run(async () => { added = await state.store.importData(data); });
  if (ok) setImportHint(`已匯入 ${added} 筆新時間點。`, "ok");
}

export function initBackup() {
  $("#backup-hint").textContent = CLOUD
    ? "「產生備份資料」會匯出目前所有人的紀錄。還原（匯入）只有管理者能使用。"
    : "紀錄存在這個瀏覽器裡。換電腦或清除瀏覽資料前，先把資料複製起來保存。";

  $("#export-btn").addEventListener("click", () => {
    const box = $("#export-box");
    box.value = JSON.stringify(exportData(), null, 1);
    box.hidden = false;
    $("#copy-btn").hidden = false;
    box.select();
  });

  $("#copy-btn").addEventListener("click", () => {
    const box = $("#export-box");
    const fallback = () => { box.select(); toast("請按 Ctrl/⌘+C 複製"); };
    if (navigator.clipboard) navigator.clipboard.writeText(box.value).then(() => toast("已複製"), fallback);
    else fallback();
  });

  $("#import-btn").addEventListener("click", () => importJson($("#import-box").value));
  $("#import-file").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => importJson(reader.result);
    reader.readAsText(file);
  });
}

/** 只有管理者看得到還原區塊 */
export function updateBackupVisibility() {
  $("#import-area").hidden = !isAdmin();
}
