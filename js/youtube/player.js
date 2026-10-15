/**
 * 內嵌的 YouTube 播放器（使用 YouTube IFrame Player API）。
 * 整個網站只有一個播放器，在影片頁切換影片時重複使用。
 */

let apiStatus = "loading";              // "loading" | "ready" | "failed"
const statusListeners = new Set();
const updateListeners = new Set();

let player = null;
let playerReady = false;
let playerVideoId = null;
let pending = null;                     // API 還沒載入完成時，先記下要播的影片

function setApiStatus(status) {
  apiStatus = status;
  statusListeners.forEach((fn) => fn(status));
}

/** 載入 YouTube 的播放器程式（網站啟動時呼叫一次） */
export function loadYouTubeApi() {
  window.onYouTubeIframeAPIReady = () => {
    setApiStatus("ready");
    if (pending) {
      const { videoId, startAt } = pending;
      pending = null;
      mountPlayer(videoId, startAt);
    }
  };
  const script = document.createElement("script");
  script.src = "https://www.youtube.com/iframe_api";
  script.onerror = () => setApiStatus("failed");
  document.head.appendChild(script);
  setTimeout(() => { if (apiStatus === "loading") setApiStatus("failed"); }, 8000);
}

export const getApiStatus = () => apiStatus;
/** 播放器程式載入成功或失敗時通知 */
export const onApiStatusChange = (fn) => statusListeners.add(fn);
/** 播放器狀態改變（開始播放、暫停…）時通知 */
export const onPlayerUpdate = (fn) => updateListeners.add(fn);

export const isPlayerReady = () => playerReady;

/**
 * 在 #yt-player 位置播放指定影片。
 * startAt 有值時從該秒數開始並自動播放；沒有值時只載入不播放。
 */
export function mountPlayer(videoId, startAt) {
  playerReady = playerReady && playerVideoId === videoId;
  if (apiStatus !== "ready") { pending = { videoId, startAt }; return; }

  if (player && playerVideoId === videoId && playerReady) {
    if (startAt != null) seekTo(startAt);
    return;
  }
  if (player?.loadVideoById) {
    playerVideoId = videoId;
    playerReady = false;
    if (startAt != null) player.loadVideoById({ videoId, startSeconds: startAt });
    else player.cueVideoById(videoId);
    return;
  }

  playerVideoId = videoId;
  player = new window.YT.Player("yt-player", {
    videoId,
    playerVars: { start: startAt || 0, autoplay: startAt != null ? 1 : 0, rel: 0, playsinline: 1 },
    events: {
      onReady: () => { playerReady = true; },
      onStateChange: () => { playerReady = true; updateListeners.forEach((fn) => fn()); },
      onError: () => updateListeners.forEach((fn) => fn({ error: true })),
    },
  });
}

export function seekTo(seconds) {
  try {
    player.seekTo(seconds, true);
    player.playVideo();
  } catch { /* 播放器尚未就緒 */ }
}

export function pausePlayer() {
  try { player?.pauseVideo?.(); } catch { /* 忽略 */ }
}

/** 目前播放到第幾秒（播放器沒準備好時回傳 null） */
export function currentTime() {
  if (!playerReady || !player?.getCurrentTime) return null;
  return player.getCurrentTime();
}

/** 目前播放影片的資訊（標題、頻道），影片 ID 對不上時回傳 null */
export function currentVideoData() {
  try {
    const d = player?.getVideoData?.();
    return d && d.video_id === playerVideoId ? { videoId: d.video_id, title: d.title, channel: d.author } : null;
  } catch { return null; }
}
