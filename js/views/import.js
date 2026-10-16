/**
 * 「批次匯入」分頁（只有管理者）：上傳 Excel → 預覽與檢查 → 匯入。
 *
 * Excel 格式見 template.xlsx：工作表「時間點」，一列一個時間點，欄位
 *   影片網址* | 時間碼 | 說明 | 建立者 | Hashtag | 影片標題 | 頻道名稱
 * 欄位順序不限，會依標題列的文字找欄位。
 */
import { LIMITS } from "../config.js";
import { $, esc, toast, run } from "../core/dom.js";
import { state, getVideo, isAdmin, getName } from "../core/state.js";
import { parseVideoId, parseTime, formatTime, parseTags, tagsToText, hasTime } from "../core/format.js";
import { registerView } from "../core/router.js";
import { fetchVideoMeta } from "../youtube/meta.js";

const SHEETJS_URL = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";

/** 每個欄位在標題列可能出現的文字 */
const COLUMN_NAMES = {
  url: ["網址", "url", "連結", "link"],
  time: ["時間", "timecode", "time"],
  note: ["說明", "備註", "可看點", "note"],
  author: ["建立者", "作者", "author"],
  tags: ["hashtag", "標籤", "tag"],
  title: ["標題", "title"],
  channel: ["頻道", "channel"],
};

let plan = [];       // 每一列的檢查結果
let lastRows = null; // 最近一次讀到的原始資料（修改預設建立者時重新檢查）

/* ---------- 讀取 Excel ---------- */

let sheetJsLoading = null;
/** 需要時才載入 Excel 讀取元件（SheetJS） */
function loadSheetJS() {
  if (window.XLSX) return Promise.resolve();
  sheetJsLoading ||= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SHEETJS_URL;
    script.crossOrigin = "anonymous";
    script.onload = resolve;
    script.onerror = () => { sheetJsLoading = null; reject(new Error("無法載入 Excel 讀取元件")); };
    document.head.appendChild(script);
  });
  return sheetJsLoading;
}

/** 找出標題列與各欄位的位置（找不到時用範本的預設順序） */
function findColumns(rows) {
  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const map = {};
    rows[r].forEach((header, index) => {
      const text = String(header || "").toLowerCase();
      for (const field in COLUMN_NAMES) {
        if (map[field] == null && COLUMN_NAMES[field].some((w) => text.includes(w))) { map[field] = index; break; }
      }
    });
    if (map.url != null && map.time != null) return { headerRow: r, map };
  }
  return { headerRow: -1, map: { url: 0, time: 1, note: 2, author: 3, tags: 4, title: 5, channel: 6 } };
}

async function readFile(file) {
  if (!file) return;
  $("#imp-filename").textContent = file.name;
  $("#imp-result").hidden = false;
  setProgress("讀取中…");

  try { await loadSheetJS(); }
  catch (e) { return setProgress(e.message + "，請確認網路連線後再試一次。"); }

  let rows;
  try {
    const workbook = window.XLSX.read(await file.arrayBuffer(), { type: "array" });
    const sheet = workbook.Sheets["時間點"] || workbook.Sheets[workbook.SheetNames[0]];
    // raw:false 取得儲存格「顯示的文字」，避免 1:23 被當成時間數值
    rows = window.XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "", blankrows: false });
  } catch {
    return setProgress("讀不懂這個檔案，請確認是 Excel 或 CSV 格式。");
  }
  buildPlan(rows);
}

/* ---------- 檢查每一列 ---------- */

function buildPlan(rows) {
  lastRows = rows;
  const { headerRow, map } = findColumns(rows);
  const defaultAuthor = $("#imp-author").value.trim().slice(0, LIMITS.author);
  const cell = (row, field) => (map[field] == null ? "" : String(row[map[field]] ?? "").trim());
  const seen = new Set();
  plan = [];

  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i];
    const item = {
      line: i + 1,
      url: cell(row, "url"),
      timeText: cell(row, "time"),
      note: cell(row, "note").slice(0, LIMITS.note),
      author: (cell(row, "author") || defaultAuthor).slice(0, LIMITS.author),
      tags: parseTags(cell(row, "tags")),
      title: cell(row, "title").slice(0, LIMITS.title),
      channel: cell(row, "channel").slice(0, LIMITS.channel),
    };
    if (!item.url && !item.timeText && !item.note) continue; // 空白列

    if (item.author === "範例") {
      Object.assign(item, { status: "skip", message: "範例列，略過" });
    } else {
      item.id = parseVideoId(item.url);
      item.t = item.timeText ? parseTime(item.timeText) : null; // 時間碼可不填
      if (!item.id) Object.assign(item, { status: "error", message: item.url ? "網址看不懂" : "缺少影片網址" });
      else if (item.timeText && item.t === null) Object.assign(item, { status: "error", message: `時間碼「${item.timeText}」看不懂` });
      else if (item.t === null && !item.note) {
        // 只有網址：只建立影片，沒有時間點時會自動加上「待補」
        item.videoOnly = true;
        const key = `${item.id}|video`;
        if (seen.has(key) || getVideo(item.id)) Object.assign(item, { status: "skip", message: "影片已存在，略過" });
        else { seen.add(key); Object.assign(item, { status: "ok", message: "新影片（待補）" }); }
      }
      else if (!item.author) Object.assign(item, { status: "error", message: "缺少建立者（可填上方的預設建立者）" });
      else {
        const key = `${item.id}|${item.t}|${item.note}`;
        const existing = getVideo(item.id);
        const duplicate = seen.has(key) || existing?.marks.some((m) => m.t === item.t && m.note === item.note);
        if (duplicate) Object.assign(item, { status: "skip", message: "已存在，略過" });
        else {
          seen.add(key);
          Object.assign(item, { status: "ok", message: existing ? "新增到現有影片" : "新影片" });
        }
      }
    }
    plan.push(item);
  }
  renderPlan();
}

/* ---------- 顯示預覽 ---------- */

function setProgress(text) {
  $("#imp-progress").textContent = text;
}

function videoLabel(item) {
  const existing = item.id && getVideo(item.id);
  if (existing?.title) return esc(existing.title);
  const main = item.id ? `<span class="muted">${esc(item.id)}</span>` : esc(item.url) || '<span class="muted">（空白）</span>';
  return main + (item.title ? `<div class="small muted">${esc(item.title)}</div>` : "");
}

function renderPlan() {
  const ok = plan.filter((i) => i.status === "ok");
  const okMarks = ok.filter((i) => !i.videoOnly);
  const errors = plan.filter((i) => i.status === "error");
  const skipped = plan.filter((i) => i.status === "skip");
  const videoIds = new Set(ok.map((i) => i.id));
  const newVideos = [...videoIds].filter((id) => !getVideo(id));

  $("#imp-sum").innerHTML = `
    <div class="stat"><b>${okMarks.length}</b><span>個時間點會匯入</span></div>
    <div class="stat"><b>${videoIds.size}</b><span>部影片（新 ${newVideos.length}）</span></div>
    <div class="stat"><b>${skipped.length}</b><span>列略過</span></div>
    <div class="stat${errors.length ? " bad" : ""}"><b>${errors.length}</b><span>列有錯誤</span></div>`;

  const statusClass = { ok: "st-ok", error: "st-err", skip: "st-skip" };
  const statusIcon = { ok: "✓ ", error: "✕ ", skip: "" };
  $("#imp-rows").innerHTML = plan.length
    ? plan.map((i) => `<tr class="${i.status === "error" ? "err" : ""}">
        <td class="num">${i.line}</td>
        <td>${videoLabel(i)}</td>
        <td>${hasTime(i.t) ? `<span class="tc-chip">${formatTime(i.t)}</span>` : i.timeText ? esc(i.timeText) : i.videoOnly ? '<span class="tag pending">#待補</span>' : '<span class="tc-chip no-time">整部</span>'}</td>
        <td>${esc(i.note)}</td>
        <td>${esc(i.author)}</td>
        <td>${esc(tagsToText(i.tags))}</td>
        <td class="${statusClass[i.status]}">${statusIcon[i.status]}${esc(i.message)}</td>
      </tr>`).join("")
    : `<tr><td colspan="7" class="muted" style="text-align:center;padding:24px">檔案裡沒有找到資料列。</td></tr>`;

  const go = $("#imp-go");
  go.disabled = !ok.length;
  go.textContent = !ok.length ? "沒有可匯入的資料"
    : okMarks.length ? `匯入 ${okMarks.length} 個時間點、${videoIds.size} 部影片` : `匯入 ${videoIds.size} 部影片`;
  setProgress(errors.length ? "有錯誤的列不會匯入。可以修改 Excel 後重新上傳，或直接匯入其餘的列。" : "");
}

/* ---------- 匯入 ---------- */

/** 把要匯入的列依影片分組 */
function groupByVideo(items) {
  const videos = new Map();
  for (const i of items) {
    if (!videos.has(i.id)) videos.set(i.id, { id: i.id, title: "", channel: "", tags: [], marks: [] });
    const v = videos.get(i.id);
    v.title ||= i.title;
    v.channel ||= i.channel;
    v.tags = [...new Set([...v.tags, ...i.tags])].slice(0, LIMITS.tags);
    if (!i.videoOnly) v.marks.push({ t: i.t, note: i.note, author: i.author });
  }
  return videos;
}

/** 缺少標題或頻道的影片，同時查 4 部 */
async function fillMissingMeta(videos) {
  const queue = [...videos.values()].filter((v) => {
    const existing = getVideo(v.id);
    return !(v.title || existing?.title) || !(v.channel || existing?.channel);
  });
  const total = queue.length;
  let done = 0;
  const worker = async () => {
    while (queue.length) {
      const v = queue.shift();
      const meta = await fetchVideoMeta(v.id).catch(() => null);
      if (meta) {
        v.title ||= meta.title.slice(0, LIMITS.title);
        v.channel ||= (meta.channel || "").slice(0, LIMITS.channel);
      }
      setProgress(`抓取影片標題與頻道… ${++done}/${total}`);
    }
  };
  if (total) await Promise.all([worker(), worker(), worker(), worker()]);
}

async function runImport() {
  if (!isAdmin()) return toast("只有管理者能匯入");
  const items = plan.filter((i) => i.status === "ok");
  if (!items.length) return;

  const go = $("#imp-go");
  go.disabled = true;
  const videos = groupByVideo(items);
  await fillMissingMeta(videos);

  setProgress("寫入中…");
  let added = 0;
  const ok = await run(async () => { added = await state.store.importData({ videos: [...videos.values()] }); });
  if (!ok) {
    setProgress("匯入失敗，請確認已用管理者帳號登入，然後再試一次。");
    go.disabled = false;
    return;
  }
  toast(`已匯入 ${videos.size} 部影片、${added} 個時間點`);
  items.forEach((i) => Object.assign(i, { status: "skip", message: "已匯入" }));
  renderPlan();
  setProgress(`完成：匯入 ${added} 個時間點、${videos.size} 部影片。`);
}

/* ---------- 初始化 ---------- */

export function initImport() {
  $("#imp-file").addEventListener("change", (e) => { readFile(e.target.files[0]); e.target.value = ""; });

  const drop = $("#imp-drop");
  for (const type of ["dragenter", "dragover"]) drop.addEventListener(type, (e) => { e.preventDefault(); drop.classList.add("over"); });
  for (const type of ["dragleave", "drop"]) drop.addEventListener(type, (e) => { e.preventDefault(); drop.classList.remove("over"); });
  drop.addEventListener("drop", (e) => readFile(e.dataTransfer.files[0]));

  $("#imp-author").addEventListener("change", () => { if (lastRows) buildPlan(lastRows); });
  $("#imp-go").addEventListener("click", runImport);

  registerView("import", {
    adminOnly: true,
    onShow() {
      if (!$("#imp-author").value) $("#imp-author").value = getName();
      loadSheetJS().catch(() => {});
    },
  });
}

/** 只有管理者看得到「批次匯入」選單 */
export function updateImportVisibility() {
  $("#nav-import").hidden = !isAdmin();
}
