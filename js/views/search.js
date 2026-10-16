/**
 * 「搜尋」分頁：同時比對說明、補充評論、標題、頻道、Hashtag、建立者。
 */
import { $, esc } from "../core/dom.js";
import { state, sortMarks, commentsEnabled } from "../core/state.js";
import { formatTime, hasTime } from "../core/format.js";
import { registerView } from "../core/router.js";
import { tagClass, sortTags } from "../core/autotag.js";
import { openVideo } from "./video.js";

/** 先跳脫 HTML，再把關鍵字用 <mark> 標起來 */
function highlight(text, terms) {
  const safe = esc(text);
  if (!terms.length) return safe;
  const pattern = terms.map((t) => esc(t).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return safe.replace(new RegExp(`(${pattern})`, "gi"), "<mark>$1</mark>");
}

/**
 * 找出符合的影片與時間點。
 * 每個關鍵字都要出現（在時間點、它的補充或影片資訊裡），且至少一個出現在時間點或補充中；
 * 只有影片資訊符合時，列出該影片全部時間點。
 */
function search(terms) {
  const groups = [];
  for (const v of state.db.videos) {
    sortMarks(v);
    const videoText = [v.title, v.channel, ...(v.tags || []).map((t) => "#" + t)].join(" ").toLowerCase();
    const videoMatches = terms.every((t) => videoText.includes(t));

    const hits = [];
    for (const m of v.marks) {
      const comments = commentsEnabled() ? m.comments || [] : []; // 關閉補充／評論時不搜尋補充
      const markText = `${m.note || ""} ${m.author || ""}`.toLowerCase();
      const commentTexts = comments.map((c) => `${c.text || ""} ${c.author || ""}`.toLowerCase());
      const allText = markText + " " + commentTexts.join(" ");
      if (terms.some((t) => allText.includes(t)) && terms.every((t) => (allText + " " + videoText).includes(t))) {
        hits.push({ mark: m, matchedComments: comments.filter((_, i) => terms.some((t) => commentTexts[i].includes(t))) });
      }
    }

    const list = hits.length ? hits : videoMatches ? v.marks.map((m) => ({ mark: m, matchedComments: [] })) : [];
    if (list.length || videoMatches) groups.push({ video: v, list });
  }
  return groups;
}

function renderHit(v, { mark: m, matchedComments }, terms) {
  const expandAttr = matchedComments.length ? ` data-mark="${esc(m.id)}"` : "";
  const commentLines = matchedComments
    .map((c) => `<span class="hit-c">💬 ${highlight(c.text, terms)} <span class="small">— ${highlight(c.author, terms)}</span></span>`)
    .join("");
  const commentCount = commentsEnabled() && (m.comments || []).length && !matchedComments.length
    ? `<span class="hit-c">💬 ${m.comments.length} 則補充</span>` : "";
  const timeAttr = hasTime(m.t) ? ` data-t="${m.t}"` : "";
  const chip = hasTime(m.t) ? `<span class="tc-chip">${formatTime(m.t)}</span>` : '<span class="tc-chip no-time">整部</span>';
  return `<button class="hit" data-open="${esc(v.id)}"${timeAttr}${expandAttr}>
    ${chip}
    <span class="note">${highlight(m.note, terms)}${m.author ? ` <span class="muted small">— ${highlight(m.author, terms)}</span>` : ""}${commentLines}${commentCount}</span>
  </button>`;
}

function render() {
  const query = $("#search-input").value.trim().toLowerCase();
  const terms = query.split(/\s+/).filter(Boolean);
  const out = $("#search-results");
  const summary = $("#search-summary");

  if (!terms.length) {
    summary.textContent = `輸入關鍵字會同時比對說明、${commentsEnabled() ? "補充評論、" : ""}影片標題、頻道、Hashtag 和建立者；多個關鍵字用空白分開。`;
    out.innerHTML = "";
    return;
  }

  const groups = search(terms);
  const total = groups.reduce((n, g) => n + g.list.length, 0);
  summary.textContent = groups.length ? `找到 ${groups.length} 部影片、${total} 個時間點` : `找不到含「${query}」的紀錄。`;

  out.innerHTML = groups.map(({ video: v, list }) => {
    const meta = v.channel || (v.tags || []).length
      ? `<div class="row small" style="gap:8px">
          ${v.channel ? `<span class="channel">${highlight(v.channel, terms)}</span>` : ""}
          ${sortTags(v.tags).map((t) => `<span class="${tagClass(t)}">${highlight("#" + t, terms)}</span>`).join("")}
        </div>` : "";
    return `<div class="result">
      <div class="result-head">
        <button data-open="${esc(v.id)}">${highlight(v.title || "未命名影片", terms)}</button>
        <span class="muted small">共 ${v.marks.length} 個時間點</span>
      </div>
      ${meta}
      ${list.map((hit) => renderHit(v, hit, terms)).join("")}
    </div>`;
  }).join("");
}

export function initSearch() {
  let timer;
  $("#search-input").addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(render, 120); });
  $("#search-results").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-open]");
    if (btn) openVideo(btn.dataset.open, btn.dataset.t != null ? Number(btn.dataset.t) : undefined, btn.dataset.mark);
  });
  registerView("search", {
    onShow() { render(); setTimeout(() => $("#search-input").focus(), 0); },
    onData: render,
  });
}
