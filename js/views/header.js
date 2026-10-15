/**
 * 頁首：管理者登入／登出按鈕、單機模式提示。
 */
import { CLOUD } from "../config.js";
import { $, esc } from "../core/dom.js";
import { state, isAdmin } from "../core/state.js";

export function renderAuth() {
  const area = $("#auth-area");
  area.hidden = !CLOUD;
  if (!CLOUD) return;

  const user = state.user;
  area.innerHTML = user && !user.isAnonymous
    ? `${isAdmin() ? '<span class="admin-badge">管理者</span>' : ""}
       <span class="muted">${esc(user.displayName || user.email)}</span>
       <button class="btn ghost sm" id="signout-btn">登出</button>`
    : `<button class="btn ghost sm" id="signin-btn">管理者登入</button>`;
}

export function initHeader() {
  $("#auth-area").addEventListener("click", (e) => {
    if (e.target.closest("#signin-btn")) state.store?.signIn?.();
    if (e.target.closest("#signout-btn")) state.store?.signOut?.();
  });

  if (!CLOUD) {
    $("#mode-banner").hidden = false;
    $("#mode-banner-text").textContent = "目前是單機模式：紀錄只存在這台裝置的瀏覽器，其他人看不到。設定 Firebase 後就能多人共用。";
  }
  renderAuth();
}
