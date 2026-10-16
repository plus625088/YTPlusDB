/**
 * 網站設定
 * ------------------------------------------------------------------
 * 這個檔案集中放所有「需要依專案修改」的值，其他檔案不用動。
 *
 * - FIREBASE_CONFIG：Firebase 專案設定。projectId 留空時，網站會以
 *   「單機模式」運作（資料只存在各自的瀏覽器裡）。
 * - ADMIN_EMAILS：管理者的 Google 帳號。這裡只決定「要不要顯示管理按鈕」，
 *   真正的權限檢查在 firestore.rules，兩邊要一起修改。
 * - YT_API_KEY：YouTube Data API 金鑰，用來抓影片的發布日期、標題、頻道。
 *   留空時影片列表改依「最近更新」排序。
 *
 * 這些金鑰本來就會出現在公開網頁中，安全性靠的是：
 *   1. Google Cloud 對金鑰設定的「網站限制」與「API 限制」
 *   2. firestore.rules 的權限規則
 */

export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDfoeOlwbrBioM4eBTujmLxL2H8uIoE3P4",
  authDomain: "ytplusdb.firebaseapp.com",
  projectId: "ytplusdb",
  storageBucket: "ytplusdb.firebasestorage.app",
  messagingSenderId: "859009825230",
  appId: "1:859009825230:web:2eeeb1663b0ba61db7539f",
};

export const ADMIN_EMAILS = ["osht9478@gmail.com", "su3cj3x04@gmail.com"];

export const YT_API_KEY = "AIzaSyAXFXmIR3fHJEPivqvx5OzWQdxJ4qSAYJQ";

/** Firebase JavaScript SDK 版本（從 gstatic 載入） */
export const FIREBASE_SDK_VERSION = "10.12.2";

/** 是否使用雲端資料庫 */
export const CLOUD = Boolean(FIREBASE_CONFIG.projectId);

/**
 * 沒有任何時間碼與說明的影片，會自動加上這個 Hashtag；
 * 有人補上第一個時間點後自動移除。（firestore.rules 裡也有用到這個字，要一起改）
 */
export const PENDING_TAG = "待補";

/**
 * 會員影片：新增影片時，標題含有 MEMBER_KEYWORD 就自動加上 MEMBER_TAG，否則加上 NON_MEMBER_TAG。
 * 已經有其中一個標籤的影片不會再更動（可以手動修改）。
 */
export const MEMBER_KEYWORD = "會員專屬";
export const MEMBER_TAG = "會員";
export const NON_MEMBER_TAG = "非會員";

/** 各欄位的長度上限（要和 firestore.rules 一致） */
export const LIMITS = {
  title: 200,
  channel: 100,
  note: 2000,
  author: 40,
  tag: 40,
  tags: 30,
};
