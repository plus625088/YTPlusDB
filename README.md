# YT Timecode筆記（YTPlusDB）

記錄 YouTube 影片的時間碼與說明，大家可以一起新增、留言補充、搜尋。

網站：https://plus625088.github.io/YTPlusDB/

## 檔案結構

```
index.html              頁面結構（只有 HTML，沒有程式）
css/style.css           所有樣式
template.xlsx           批次匯入用的 Excel 範本
firestore.rules         Firebase 資料庫的安全規則（要貼到 Firebase 控制台）
js/
  config.js             ★ 設定：Firebase、管理者帳號、YouTube API 金鑰
  main.js               進入點：啟動網站、串接各模組
  core/
    dom.js              畫面小工具：選取元素、HTML 跳脫、提示訊息
    format.js           解析與格式化：YouTube 網址、時間碼、日期、Hashtag
    state.js            全站共用狀態、權限判斷、記住使用者名字
    router.js           分頁切換
  data/
    cloud-store.js      雲端模式：Firebase Firestore 讀寫、登入
    local-store.js      單機模式：資料存在瀏覽器
    seed.js             單機模式的範例資料
  youtube/
    player.js           內嵌播放器
    meta.js             查詢影片標題、頻道、發布日期
  views/
    header.js           頁首（登入按鈕）
    library.js          影片列表（首頁）
    video.js            影片頁（播放器、時間點、補充評論）
    search.js           搜尋
    add.js              新增紀錄
    backup.js           備份與還原
    import.js           批次匯入（管理者）
```

兩種資料層（`cloud-store.js`、`local-store.js`）提供一模一樣的函式，畫面程式不需要知道目前用哪一種。

## 常見修改

| 想做的事 | 改哪裡 |
|---|---|
| 新增或移除管理者 | `js/config.js` 的 `ADMIN_EMAILS`，**以及** `firestore.rules` 的 `isAdmin()`，再到 Firebase 發布規則 |
| 換 YouTube API 金鑰 | `js/config.js` 的 `YT_API_KEY` |
| 改顏色、字體 | `css/style.css` 最上方的 `:root` 變數 |
| 加入新的外部服務 | `index.html` 的 Content-Security-Policy 要加上該網域 |

## 本機測試

網站使用 JavaScript 模組，不能直接雙擊 `index.html` 開啟，要用本機伺服器：

```
python3 -m http.server 8000
```

然後開啟 http://localhost:8000 。如果要測試登入，需在 Firebase Authentication 的「已授權網域」加入 `localhost`。

## 安全機制

- **資料庫權限**：由 `firestore.rules` 在伺服器端檢查，修改網頁程式也無法繞過。
- **XSS 防護**：所有使用者輸入在顯示前都經過 `esc()` 跳脫；Content-Security-Policy 限制可載入的程式來源。
- **金鑰**：Firebase 與 YouTube 金鑰本來就會公開在網頁中，靠 Google Cloud 的「網站限制」「API 限制」保護。
