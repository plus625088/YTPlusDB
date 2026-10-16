/**
 * 網站進入點：初始化各分頁、連接資料層、載入 YouTube 播放器。
 *
 * 檔案結構：
 *   config.js            設定（Firebase、管理者、YouTube API 金鑰）
 *   core/                共用工具：畫面小工具、格式解析、全站狀態、分頁切換
 *   data/                資料層：local-store（單機）、cloud-store（Firebase）
 *   youtube/             播放器、影片資訊查詢
 *   views/               各分頁的畫面與操作
 */
import { CLOUD, RENAMED_TAGS } from "./config.js";
import { toast } from "./core/dom.js";
import { state, onChange, isAdmin } from "./core/state.js";
import { show, refreshCurrentView, bindNavButtons } from "./core/router.js";
import { createLocalStore } from "./data/local-store.js";
import { loadYouTubeApi } from "./youtube/player.js";
import { backfillVideoMeta } from "./youtube/meta.js";
import { initHeader, renderAuth } from "./views/header.js";
import { initLibrary } from "./views/library.js";
import { initVideo } from "./views/video.js";
import { initSearch } from "./views/search.js";
import { initAdd } from "./views/add.js";
import { initBackup, updateBackupVisibility } from "./views/backup.js";
import { initImport, updateImportVisibility } from "./views/import.js";

/** 管理者開啟網站時，把改過名的舊標籤（例如「非會員」→「公開」）一次換掉 */
let migrating = false;
async function migrateRenamedTags() {
  if (migrating || !state.loaded || !isAdmin() || !state.store?.renameTag) return;
  const inUse = new Set(state.db.videos.flatMap((v) => v.tags || []));
  const pending = Object.entries(RENAMED_TAGS).filter(([oldName]) => inUse.has(oldName));
  if (!pending.length) return;
  migrating = true;
  try {
    for (const [oldName, newName] of pending) {
      const count = await state.store.renameTag(oldName, newName);
      if (count) toast(`已把 ${count} 部影片的 #${oldName} 改成 #${newName}`);
    }
  } catch (e) {
    console.warn("標籤改名失敗", e);
  } finally {
    migrating = false;
  }
}

/** 資料或登入狀態改變時要做的事 */
function onAnyChange() {
  renderAuth();
  updateImportVisibility();
  updateBackupVisibility();
  refreshCurrentView();
  if (state.loaded) backfillVideoMeta();
  migrateRenamedTags();
}

/** 建立資料層：雲端模式連不上時退回單機模式 */
async function createStore() {
  if (!CLOUD) return createLocalStore();
  try {
    const { createCloudStore } = await import("./data/cloud-store.js");
    return await createCloudStore();
  } catch (e) {
    console.error(e);
    toast("無法連線到資料庫，暫時改用單機模式");
    return createLocalStore();
  }
}

/** 把頁首高度寫到 CSS 變數 --header-h（手機版固定播放器要貼在頁首下方） */
function trackHeaderHeight() {
  const header = document.querySelector("header");
  const update = () => document.documentElement.style.setProperty("--header-h", header.offsetHeight + "px");
  new ResizeObserver(update).observe(header);
  update();
}

async function start() {
  trackHeaderHeight();
  initHeader();
  initLibrary();
  initVideo();
  initSearch();
  initAdd();
  initBackup();
  initImport();
  bindNavButtons();
  onChange(onAnyChange);

  show("library");
  loadYouTubeApi();

  state.store = await createStore();
  state.store.start();
  onAnyChange();
}

start();
