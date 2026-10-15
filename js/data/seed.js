/**
 * 單機模式第一次開啟時的範例資料。
 */
import { makeId } from "../core/dom.js";

export function sampleData() {
  const now = Date.now();
  const mark = (t, note) => ({ id: makeId(), t, note, author: "範例", comments: [] });
  return {
    videos: [
      {
        id: "dQw4w9WgXcQ",
        title: "Rick Astley - Never Gonna Give You Up",
        channel: "Rick Astley",
        tags: ["MV", "80年代", "經典"],
        sample: true,
        updatedAt: now,
        publishedAt: Date.UTC(2009, 9, 25),
        marks: [
          mark(0, "開場鼓點，經典前奏"),
          mark(43, "第一次副歌，招牌舞步"),
          mark(85, "第二段主歌，背景舞者走位"),
          mark(162, "橋段之後的副歌高潮"),
        ],
      },
      {
        id: "jNQXAC9IVRw",
        title: "Me at the zoo",
        channel: "jawed",
        tags: ["經典", "YouTube歷史"],
        sample: true,
        updatedAt: now - 1000,
        publishedAt: Date.UTC(2005, 3, 24),
        marks: [
          mark(0, "YouTube 第一支影片的開頭"),
          mark(5, "大象的長鼻子，經典台詞"),
        ],
      },
    ],
  };
}
