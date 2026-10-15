/**
 * 取得 YouTube 影片資訊：標題、頻道名稱、發布日期。
 *
 * 取得順序：
 *   1. YouTube Data API（需要 config.js 的 YT_API_KEY；唯一能取得發布日期的方式）
 *   2. noembed.com / YouTube oEmbed（只有標題與頻道）
 *   3. 用隱藏的播放器讀取（最後手段）
 */
import { YT_API_KEY, LIMITS } from "../config.js";
import { state, getVideo } from "../core/state.js";
import { getApiStatus } from "./player.js";

/**
 * 用 YouTube Data API 查詢多部影片，一次最多 50 部。
 * 回傳 Map：影片 ID → { publishedAt, title, channel }
 */
export async function fetchFromDataApi(videoIds) {
  const result = new Map();
  if (!YT_API_KEY || !videoIds.length) return result;

  for (let i = 0; i < videoIds.length; i += 50) {
    const ids = videoIds.slice(i, i + 50).map(encodeURIComponent).join(",");
    try {
      const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${ids}&key=${encodeURIComponent(YT_API_KEY)}`);
      if (!res.ok) { console.warn("YouTube API 錯誤", res.status); continue; }
      const data = await res.json();
      for (const item of data.items || []) {
        result.set(item.id, {
          publishedAt: Date.parse(item.snippet.publishedAt) || 0,
          title: item.snippet.title || "",
          channel: item.snippet.channelTitle || "",
        });
      }
    } catch (e) {
      console.warn(e);
    }
  }
  return result;
}

/** 從 oEmbed 服務取得標題與頻道 */
async function fetchFromOEmbed(videoId) {
  const url = "https://www.youtube.com/watch?v=" + videoId;
  for (const endpoint of ["https://noembed.com/embed?url=", "https://www.youtube.com/oembed?format=json&url="]) {
    try {
      const res = await fetch(endpoint + encodeURIComponent(url));
      if (!res.ok) continue;
      const d = await res.json();
      if (d?.title && !d.error) return { title: d.title, channel: d.author_name || "" };
    } catch { /* 換下一個 */ }
  }
  return null;
}

/** 用一個看不見的播放器載入影片，讀取標題與頻道（最多等 10 秒） */
function fetchFromHiddenPlayer(videoId) {
  return new Promise((resolve) => {
    if (getApiStatus() !== "ready") return resolve(null);

    const wrap = document.createElement("div");
    wrap.style.cssText = "position:absolute;left:-9999px;top:0;width:200px;height:120px;overflow:hidden";
    const host = document.createElement("div");
    wrap.appendChild(host);
    document.body.appendChild(wrap);

    let done = false;
    let hidden;
    const finish = (value) => {
      if (done) return;
      done = true;
      try { hidden?.destroy(); } catch { /* 忽略 */ }
      wrap.remove();
      resolve(value);
    };
    const read = (p) => {
      try {
        const d = p.getVideoData();
        if (d?.title) finish({ title: d.title, channel: d.author || "" });
      } catch { /* 還沒有資料 */ }
    };

    hidden = new window.YT.Player(host, {
      videoId,
      playerVars: { mute: 1, autoplay: 1, playsinline: 1 },
      events: {
        onReady: (e) => { e.target.mute(); read(e.target); if (!done) e.target.playVideo(); },
        onStateChange: (e) => read(e.target),
        onError: () => finish(null),
      },
    });
    setTimeout(() => finish(null), 10000);
  });
}

const cache = new Map();

/** 取得一部影片的資訊（結果會快取） */
export async function fetchVideoMeta(videoId) {
  if (cache.has(videoId)) return cache.get(videoId);
  let meta = (await fetchFromDataApi([videoId])).get(videoId) || null;
  if (!meta?.title) meta = await fetchFromOEmbed(videoId);
  if (!meta) meta = await fetchFromHiddenPlayer(videoId);
  if (meta) cache.set(videoId, meta);
  return meta;
}

/* ---------- 自動補齊缺少的發布日期、標題、頻道 ---------- */

const alreadyTried = new Set();
let busy = false;

/**
 * 檢查所有影片，缺少發布日期、標題或頻道的，就向 YouTube 查詢並補上。
 * 每部影片每次開網站只查一次。
 */
export async function backfillVideoMeta() {
  if (!YT_API_KEY || busy || !state.store) return;
  const missing = state.db.videos
    .filter((v) => !alreadyTried.has(v.id) && (!v.publishedAt || !v.title || !v.channel))
    .map((v) => v.id);
  if (!missing.length) return;

  missing.forEach((id) => alreadyTried.add(id));
  busy = true;
  try {
    const found = await fetchFromDataApi(missing);
    for (const [id, meta] of found) {
      const v = getVideo(id);
      if (!v) continue;
      const patch = {};
      if (!v.publishedAt && meta.publishedAt) patch.publishedAt = meta.publishedAt;
      if (!v.title && meta.title) patch.title = meta.title.slice(0, LIMITS.title);
      if (!v.channel && meta.channel) patch.channel = meta.channel.slice(0, LIMITS.channel);
      if (Object.keys(patch).length) await state.store.fillEmpty(id, patch).catch((e) => console.warn(e));
    }
  } finally {
    busy = false;
  }
  // 查詢期間如果又有新影片加入，再跑一次
  if (state.db.videos.some((v) => !alreadyTried.has(v.id))) backfillVideoMeta();
}
