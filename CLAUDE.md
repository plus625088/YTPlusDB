# 專案說明（給 Claude 的工作準則）

這是「YT Timecode筆記」網站（GitHub Pages + Firebase），說明見 README.md。

## 修改專案時的規則

- **每次修改功能或檔案結構，都要一併更新 README.md**，讓「功能」「檔案結構」「資料庫結構」「常見修改」等段落和程式保持一致。
- 介面文字一律使用繁體中文。
- 修改 `firestore.rules` 時，要提醒使用者把規則貼到 Firebase 控制台並按「發布」。
- 所有放進 innerHTML 的使用者資料都要經過 `esc()`。
- 修改完成後 commit 並推送到 main。
