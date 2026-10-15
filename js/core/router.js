/**
 * 分頁切換。
 * 每個分頁（views/*.js）用 registerView 註冊自己的動作：
 *   onShow()  切換到這個分頁時
 *   onHide()  離開這個分頁時
 *   onData()  資料有變動、而且目前正在這個分頁時
 *   adminOnly 只有管理者能進入
 */
import { $ } from "./dom.js";
import { isAdmin } from "./state.js";

const views = {};
export const nav = { current: "library", previous: "library" };

export function registerView(name, hooks) {
  views[name] = hooks;
}

export function show(name) {
  if (views[name]?.adminOnly && !isAdmin()) name = "library";

  if (nav.current !== name) {
    views[nav.current]?.onHide?.();
    if (name === "video") nav.previous = nav.current;
  }
  nav.current = name;

  for (const key of Object.keys(views)) $("#view-" + key).hidden = key !== name;
  document.querySelectorAll("nav button").forEach((btn) => {
    const active = btn.dataset.nav === name || (name === "video" && btn.dataset.nav === "library");
    btn.setAttribute("aria-current", active ? "page" : "false");
  });

  views[name]?.onShow?.();
  window.scrollTo(0, 0);
}

/** 資料有變動：只重畫目前的分頁 */
export function refreshCurrentView() {
  const view = views[nav.current];
  if (view?.adminOnly && !isAdmin()) return show("library");
  view?.onData?.();
}

/** 點任何帶有 data-nav 屬性的按鈕就切換分頁 */
export function bindNavButtons() {
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-nav]");
    if (btn) show(btn.dataset.nav);
  });
}
