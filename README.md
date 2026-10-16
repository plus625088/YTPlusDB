# YT Timecode筆記（YTPlusDB）

記錄 YouTube 影片的時間碼與說明，大家可以一起新增、留言補充、搜尋。點時間碼，內嵌的影片就會跳到那個位置。

網站：https://plus625088.github.io/YTPlusDB/

## 功能

### 所有人

| 分頁 | 可以做什麼 |
|---|---|
| **影片**（首頁） | 影片卡片列表；依 YouTube 發布時間（新→舊、舊→新）或最近更新排序；Hashtag 篩選可多選，切換「符合全部／符合任一」 |
| **影片頁** | 內嵌播放器，點時間碼跳到該位置，正在播放的段落會標亮；「記下目前時間」快速新增時間點；每個時間點可以留補充或評論（預設收起，可單獨或全部展開）；手機上播放器固定在畫面上方 |
| **搜尋** | 同時比對說明、補充評論、影片標題、頻道、Hashtag、建立者；點結果直接跳到影片的該時間點 |
| **新增紀錄** | 貼上影片網址，自動帶入標題、頻道（鎖定不用手填）；時間碼和說明都可以不填；可一次輸入多個時間點；記住上次填的名字 |

- 新增時間點、補充都要填名字，會顯示在內容旁邊。
- 每個瀏覽器可以修改自己新增的時間點和補充（標示「你新增的」「你寫的」）。換電腦、換瀏覽器或清除瀏覽資料後就不能再改。

### 管理者（用 Google 帳號登入）

| 功能 | 位置 |
|---|---|
| 刪除影片、時間點、補充；修改任何人的內容 | 影片頁 |
| 修改標題、頻道；Hashtag 以標籤顯示，按 × 移除、輸入後按 Enter 新增 | 影片頁 |
| 批次替多部影片加入或移除 Hashtag（可先篩選再全選） | 首頁「☑ 批次編輯 Hashtag」 |
| 統一改名或合併 Hashtag | 首頁「# Hashtag 篩選」→「✎ 管理 Hashtag」 |
| 用 Excel 批次匯入影片與時間點（範本：`template.xlsx`） | 「批次匯入」頁 |
| 貼上 YouTube 播放清單網址，一次加入整個清單 | 「批次匯入」頁 |
| 設定自動加 Hashtag 的規則 | 「標籤規則」頁 |
| 備份（匯出 JSON）與還原 | 「新增紀錄」頁下方 |

### 自動標籤

在「標籤規則」頁設定，存在資料庫裡，修改後立即生效。預設規則：

| 條件 | 自動加上 |
|---|---|
| 標題包含「會員專屬」 | #會員 |
| 標題不包含「會員專屬」 | #公開 |
| 影片沒有任何時間碼和說明 | #待補（補上第一個時間點後自動移除） |

- 標題、頻道的規則只在**新增影片**或**第一次抓到標題**時套用；要讓現有影片也套用，用設定頁的「套用到現有影片」。
- 自動標籤顯示為**藍色**（待補為紅色），手動加的標籤為灰色。
- 在設定頁修改規則的標籤名稱時，現有影片上的舊標籤會一起改名。

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
    autotag.js          自動標籤規則的判斷（預設規則也在這裡）
  data/
    cloud-store.js      雲端模式：Firebase Firestore 讀寫、登入
    local-store.js      單機模式：資料存在瀏覽器
    seed.js             單機模式的範例資料
  youtube/
    player.js           內嵌播放器
    meta.js             查詢影片標題、頻道、發布日期、播放清單
  views/
    header.js           頁首（登入按鈕）
    library.js          影片列表（首頁）、Hashtag 篩選、管理與批次編輯
    video.js            影片頁（播放器、時間點、補充評論、Hashtag 編輯）
    search.js           搜尋
    add.js              新增紀錄
    backup.js           備份與還原
    import.js           批次匯入：Excel、播放清單（管理者）
    rules.js            標籤規則（管理者）
```

兩種資料層（`cloud-store.js`、`local-store.js`）提供一模一樣的函式，畫面程式不需要知道目前用哪一種。`config.js` 的 Firebase `projectId` 留空時，網站會以單機模式運作（資料只存在各自的瀏覽器）。

## 資料庫結構（Firestore）

| 集合 | 文件 ID | 欄位 |
|---|---|---|
| `videos` | YouTube 影片 ID | `title`、`channel`、`tags[]`、`publishedAt`、`createdBy`、`createdAt`、`updatedAt` |
| `marks` | 自動產生 | `videoId`、`t`（秒，沒有時間碼時為 null）、`note`、`author`、`uid`、`createdAt` |
| `comments` | 自動產生 | `videoId`、`markId`、`text`、`author`、`uid`、`createdAt` |
| `settings` | `autoTags` | `rules[]`、`pending`（自動標籤規則） |

## 常見修改

| 想做的事 | 改哪裡 |
|---|---|
| 新增或移除管理者 | `js/config.js` 的 `ADMIN_EMAILS`，**以及** `firestore.rules` 的 `isAdmin()`，再到 Firebase 發布規則 |
| 換 YouTube API 金鑰 | `js/config.js` 的 `YT_API_KEY` |
| 改自動加標籤的規則 | 網站的「標籤規則」頁（不用改程式） |
| 改預設的自動標籤規則（資料庫還沒有設定時使用） | `js/core/autotag.js` 的 `DEFAULT_SETTINGS` |
| 改欄位長度上限 | `js/config.js` 的 `LIMITS`，**以及** `firestore.rules` 裡對應的數字 |
| 改顏色、字體 | `css/style.css` 最上方的 `:root` 變數（自動標籤顏色是 `--auto-bg`、`--auto-fg`） |
| 加入新的外部服務 | `index.html` 的 Content-Security-Policy 要加上該網域 |

**修改 `firestore.rules` 後**，記得把內容貼到 Firebase 控制台 →「Firestore Database」→「規則」，按「發布」才會生效。

## Firebase 需要的設定

- **Firestore Database**：建立資料庫，規則貼上 `firestore.rules` 並發布。
- **Authentication → 登入方式**：啟用「Google」（管理者登入）和「匿名」（記住每個瀏覽器自己新增的內容）。
- **Authentication → 設定 → 已授權網域**：加入 `plus625088.github.io`。
- **Google Cloud → 憑證**：YouTube Data API 金鑰建議限制為網站 `https://plus625088.github.io/*`、只允許 YouTube Data API v3。

## 本機測試

網站使用 JavaScript 模組，不能直接雙擊 `index.html` 開啟，要用本機伺服器：

```
python3 -m http.server 8000
```

然後開啟 http://localhost:8000 。如果要測試登入，需在 Firebase Authentication 的「已授權網域」加入 `localhost`。

## 安全機制

- **資料庫權限**：由 `firestore.rules` 在伺服器端檢查，修改網頁程式也無法繞過。任何人可讀、登入（含自動匿名登入）後可新增；只能修改自己建立的內容；刪除和修改他人內容只有管理者可以。
- **XSS 防護**：所有使用者輸入在顯示前都經過 `esc()` 跳脫；Content-Security-Policy 限制可載入的程式來源。
- **金鑰**：Firebase 與 YouTube 金鑰本來就會公開在網頁中，靠 Google Cloud 的「網站限制」「API 限制」保護。
