/**
 * 雲端模式的資料層：Firebase Firestore（資料庫）＋ Firebase Authentication（登入）。
 *
 * Firestore 的三個集合（collection）：
 *   videos/{影片ID}   title, channel, tags[], publishedAt, createdBy, createdAt, updatedAt
 *   marks/{自動ID}    videoId, t, note, author, uid, createdAt
 *   comments/{自動ID} videoId, markId, text, author, uid, createdAt
 *
 * 登入：
 *   - 每個瀏覽器開啟時自動「匿名登入」，取得一組專屬 uid，
 *     用來判斷哪些時間點、補充是自己建立的（可以修改）。
 *   - 管理者按「管理者登入」改用 Google 帳號登入。
 *
 * 權限由 firestore.rules 在伺服器端檢查；這裡的判斷只影響畫面顯示。
 */
import { FIREBASE_CONFIG, FIREBASE_SDK_VERSION, LIMITS } from "../config.js";
import { toast } from "../core/dom.js";
import { state, emitChange, isAdmin } from "../core/state.js";
import { isVideoId } from "../core/format.js";

/** Firestore 自動產生的文件 ID 一律是 20 碼英數 */
const DOC_ID = /^[A-Za-z0-9]{20}$/;
const BATCH_LIMIT = 400; // Firestore 一次批次寫入上限是 500，保留餘裕

const toMillis = (ts) => (ts && ts.toMillis ? ts.toMillis() : Date.now());
const str = (v, max) => String(v ?? "").slice(0, max);

export async function createCloudStore() {
  const base = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/`;
  const [{ initializeApp }, fs, au] = await Promise.all([
    import(base + "firebase-app.js"),
    import(base + "firebase-firestore.js"),
    import(base + "firebase-auth.js"),
  ]);
  const { getFirestore, collection, doc, onSnapshot, writeBatch, updateDoc, serverTimestamp, arrayUnion } = fs;

  const app = initializeApp(FIREBASE_CONFIG);
  const db = getFirestore(app);
  const auth = au.getAuth(app);

  const videoRef = (id) => doc(db, "videos", id);
  const markRef = (id) => doc(db, "marks", id);
  const commentRef = (id) => doc(db, "comments", id);
  const newMarkRef = () => doc(collection(db, "marks"));
  const newCommentRef = () => doc(collection(db, "comments"));

  /** 寫入的資料加上建立者的 uid（匿名或 Google 登入） */
  const withUid = (data) => (auth.currentUser ? { ...data, uid: auth.currentUser.uid } : data);

  /* ================= 讀取：即時同步三個集合 ================= */

  const raw = { videos: new Map(), marks: new Map(), comments: new Map() };
  const received = { videos: false, marks: false, comments: false };

  /**
   * 把三個集合組合成畫面用的 state.db。
   * 同時過濾掉格式不正確的資料（例如被人用 API 直接寫入的怪資料），避免畫面出錯。
   */
  function rebuild() {
    if (!received.videos || !received.marks || !received.comments) return;

    const videos = [];
    for (const [id, d] of raw.videos) {
      if (!isVideoId(id)) continue;
      videos.push({
        id,
        title: str(d.title, LIMITS.title),
        channel: str(d.channel, LIMITS.channel),
        tags: Array.isArray(d.tags) ? d.tags.map((t) => str(t, LIMITS.tag)).slice(0, LIMITS.tags) : [],
        updatedAt: toMillis(d.updatedAt),
        publishedAt: Number.isFinite(d.publishedAt) ? d.publishedAt : 0,
        marks: [],
      });
    }
    const videoById = new Map(videos.map((v) => [v.id, v]));

    const markById = new Map();
    for (const [id, m] of raw.marks) {
      const v = videoById.get(m.videoId);
      if (!v || !DOC_ID.test(id) || !Number.isFinite(m.t)) continue;
      const mark = { id, t: m.t, note: str(m.note, LIMITS.note), author: str(m.author, LIMITS.author), uid: m.uid || "", comments: [] };
      v.marks.push(mark);
      markById.set(id, mark);
    }

    for (const [id, c] of raw.comments) {
      const mark = markById.get(c.markId);
      if (!mark || !DOC_ID.test(id)) continue;
      mark.comments.push({ id, text: str(c.text, LIMITS.note), author: str(c.author, LIMITS.author), uid: c.uid || "", createdAt: toMillis(c.createdAt) });
    }
    for (const mark of markById.values()) mark.comments.sort((a, b) => a.createdAt - b.createdAt);

    state.db = { videos };
    state.loaded = true;
    emitChange();
  }

  function listen(name) {
    onSnapshot(collection(db, name), (snap) => {
      for (const change of snap.docChanges()) {
        if (change.type === "removed") raw[name].delete(change.doc.id);
        else raw[name].set(change.doc.id, change.doc.data({ serverTimestamps: "estimate" }));
      }
      received[name] = true;
      rebuild();
    }, (e) => {
      console.error(e);
      toast("讀取資料失敗：" + (e.code || e.message));
    });
  }

  /* ================= 登入 ================= */

  au.onAuthStateChanged(auth, (user) => {
    state.user = user;
    emitChange();
    // 沒有登入時自動匿名登入（需在 Firebase 啟用「匿名」登入方式）
    if (!user) {
      au.signInAnonymously(auth).catch((e) => console.warn("匿名登入未啟用，無法記住自己新增的內容", e.code));
    }
  });

  async function signIn() {
    const provider = new au.GoogleAuthProvider();
    try {
      const current = auth.currentUser;
      if (current && current.isAnonymous) {
        // 先嘗試把匿名身分「升級」成 Google 帳號，保留這個瀏覽器建立過的內容
        try {
          await au.linkWithPopup(current, provider);
          await current.reload();
          state.user = auth.currentUser;
          emitChange();
        } catch (e) {
          if (e.code !== "auth/credential-already-in-use" && e.code !== "auth/email-already-in-use") throw e;
          const credential = au.GoogleAuthProvider.credentialFromError(e);
          if (credential) await au.signInWithCredential(auth, credential);
          else await au.signInWithPopup(auth, provider);
        }
      } else {
        await au.signInWithPopup(auth, provider);
      }
      if (!isAdmin()) toast("這個帳號不是管理者，只能新增和修改自己的紀錄");
    } catch (e) {
      if (e.code !== "auth/popup-closed-by-user" && e.code !== "auth/cancelled-popup-request") {
        toast("登入失敗：" + (e.code || e.message));
      }
    }
  }

  /* ================= 寫入 ================= */

  /** 依序送出大量寫入，每批最多 BATCH_LIMIT 筆 */
  async function commitInChunks(operations) {
    for (let i = 0; i < operations.length; i += BATCH_LIMIT) {
      const batch = writeBatch(db);
      operations.slice(i, i + BATCH_LIMIT).forEach((op) => op(batch));
      await batch.commit();
    }
  }

  return {
    start() {
      listen("videos");
      listen("marks");
      listen("comments");
    },
    signIn,
    signOut: () => au.signOut(auth),

    /* ----- 影片 ----- */

    async saveRecord({ id, title, channel, tags, marks, author }) {
      const batch = writeBatch(db);
      const old = raw.videos.get(id);
      if (!old) {
        batch.set(videoRef(id), {
          title, channel, tags, createdBy: author,
          createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        });
      } else {
        const patch = { updatedAt: serverTimestamp() };
        if (tags.length) patch.tags = arrayUnion(...tags);
        // 一般人只能補上原本空白的標題、頻道；管理者可以覆蓋
        if (title && (isAdmin() || !old.title)) patch.title = title;
        if (channel && (isAdmin() || !old.channel)) patch.channel = channel;
        batch.update(videoRef(id), patch);
      }
      for (const m of marks) {
        batch.set(newMarkRef(), withUid({ videoId: id, t: m.t, note: m.note, author, createdAt: serverTimestamp() }));
      }
      await batch.commit();
    },

    async updateVideo(id, patch) {
      await updateDoc(videoRef(id), patch);
    },

    async fillEmpty(id, patch) {
      const old = raw.videos.get(id);
      if (!old) return;
      const changes = {};
      for (const key in patch) if (!old[key] && patch[key]) changes[key] = patch[key];
      if (Object.keys(changes).length) await updateDoc(videoRef(id), changes);
    },

    /** 刪除影片，連同它的所有時間點和補充 */
    async deleteVideo(id) {
      const refs = [
        ...[...raw.comments].filter(([, c]) => c.videoId === id).map(([k]) => commentRef(k)),
        ...[...raw.marks].filter(([, m]) => m.videoId === id).map(([k]) => markRef(k)),
      ];
      await commitInChunks(refs.map((ref) => (b) => b.delete(ref)));
      await commitInChunks([(b) => b.delete(videoRef(id))]);
    },

    /* ----- 時間點 ----- */

    async addMark(videoId, t, note, author) {
      const batch = writeBatch(db);
      batch.set(newMarkRef(), withUid({ videoId, t, note, author, createdAt: serverTimestamp() }));
      batch.update(videoRef(videoId), { updatedAt: serverTimestamp() });
      await batch.commit();
    },

    async updateMark(videoId, markId, patch) {
      await updateDoc(markRef(markId), patch);
    },

    async deleteMark(videoId, markId) {
      const batch = writeBatch(db);
      for (const [k, c] of raw.comments) if (c.markId === markId) batch.delete(commentRef(k));
      batch.delete(markRef(markId));
      await batch.commit();
    },

    /* ----- 補充評論 ----- */

    async addComment(videoId, markId, text, author) {
      const batch = writeBatch(db);
      batch.set(newCommentRef(), withUid({ videoId, markId, text, author, createdAt: serverTimestamp() }));
      await batch.commit();
    },

    async updateComment(videoId, commentId, patch) {
      await updateDoc(commentRef(commentId), patch);
    },

    async deleteComment(videoId, commentId) {
      const batch = writeBatch(db);
      batch.delete(commentRef(commentId));
      await batch.commit();
    },

    /* ----- 匯入 ----- */

    async importData({ videos }) {
      let added = 0;
      let batch = writeBatch(db);
      let count = 0;
      const flush = async () => {
        if (!count) return;
        await batch.commit();
        batch = writeBatch(db);
        count = 0;
      };

      for (const nv of videos) {
        const old = raw.videos.get(nv.id);
        if (!old) {
          batch.set(videoRef(nv.id), {
            title: nv.title || "", channel: nv.channel || "", tags: nv.tags || [], createdBy: "匯入",
            createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
          });
          count++;
        } else {
          const patch = {};
          if ((nv.tags || []).length) patch.tags = arrayUnion(...nv.tags);
          if (!old.title && nv.title) patch.title = nv.title;
          if (!old.channel && nv.channel) patch.channel = nv.channel;
          if (Object.keys(patch).length) {
            patch.updatedAt = serverTimestamp();
            batch.update(videoRef(nv.id), patch);
            count++;
          }
        }

        const existing = [...raw.marks.values()].filter((m) => m.videoId === nv.id);
        for (const m of nv.marks || []) {
          if (existing.some((x) => x.t === m.t && x.note === m.note)) continue;
          const ref = newMarkRef();
          batch.set(ref, withUid({
            videoId: nv.id, t: m.t, note: str(m.note, LIMITS.note),
            author: str(m.author || "匯入", LIMITS.author) || "匯入", createdAt: serverTimestamp(),
          }));
          count++;
          added++;
          for (const c of (m.comments || []).slice(0, 200)) {
            if (!String(c?.text || "").trim()) continue;
            batch.set(newCommentRef(), withUid({
              videoId: nv.id, markId: ref.id, text: str(c.text, LIMITS.note),
              author: str(c.author || "匯入", LIMITS.author) || "匯入", createdAt: serverTimestamp(),
            }));
            count++;
          }
          // 時間點和它的補充放在同一批，確保補充寫入時時間點已存在
          if (count >= BATCH_LIMIT) await flush();
        }
      }
      await flush();
      return added;
    },
  };
}
