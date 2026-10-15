/**
 * 畫面相關的小工具：選取元素、HTML 跳脫、提示訊息、瀏覽器儲存。
 */

/** 依 CSS 選擇器取得第一個元素 */
export const $ = (selector) => document.querySelector(selector);

/**
 * 把文字轉成可以安全放進 HTML 的字串。
 * 所有來自使用者或資料庫的內容，放進 innerHTML 之前「一定」要經過這個函式，
 * 包括放在屬性裡的 ID，避免被插入惡意的 HTML / JavaScript（XSS）。
 */
export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

/** 讀取 localStorage（無痕模式等情況可能無法使用，失敗時回傳 null） */
export function storageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

/** 寫入 localStorage（失敗時忽略） */
export function storageSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* 忽略 */ }
}

/** 產生單機模式用的簡短唯一 ID */
export function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/* ---------- 畫面下方的提示訊息 ---------- */

let toastTimer;
export function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

/**
 * 執行一個會寫入資料的動作，統一處理錯誤訊息。
 * 成功回傳 true；失敗時顯示提示並回傳 false。
 */
export async function run(action, successMessage) {
  try {
    await action();
    if (successMessage) toast(successMessage);
    return true;
  } catch (e) {
    console.error(e);
    toast(e?.code === "permission-denied"
      ? "沒有權限執行這個動作"
      : "儲存失敗：" + (e?.code || e?.message));
    return false;
  }
}

/**
 * 重畫一塊區域時，保留裡面使用者正在輸入的文字與游標位置。
 * 用法：const drafts = captureDrafts(el); el.innerHTML = …; restoreDrafts(el, drafts);
 */
export function captureDrafts(root) {
  const values = {};
  root.querySelectorAll("input[id],textarea[id]").forEach((el) => { values[el.id] = el.value; });
  const active = document.activeElement;
  const focus = active && active.id && root.contains(active)
    ? { id: active.id, start: active.selectionStart, end: active.selectionEnd }
    : null;
  return { values, focus };
}

export function restoreDrafts(root, { values, focus }) {
  for (const id in values) {
    const el = document.getElementById(id);
    if (el && root.contains(el)) el.value = values[id];
  }
  if (focus) {
    const el = document.getElementById(focus.id);
    if (el) {
      el.focus({ preventScroll: true });
      try { el.setSelectionRange(focus.start, focus.end); } catch { /* 部分欄位不支援 */ }
    }
  }
}
