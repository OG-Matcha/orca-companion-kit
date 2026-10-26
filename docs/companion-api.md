# 寵物 API：`registerCompanion`

`src/touches/companion.js` 是共用的寵物引擎。一隻寵物只需要一個檔案：一張 SVG、幾個部位的選擇器、幾句台詞和自己的動作。完整範例：[`examples/touches/puff.js`](../examples/touches/puff.js)。

```js
;(() => {
  const T = window.__orcaThemer
  if (!T?.registerCompanion) return
  T.registerCompanion({
    id: 'my-pet',            // touch id: list it in your theme's @touches
    label: '我的寵物',
    svg: `<svg viewBox="0 0 120 120">…<g class="my-eyes">…</g></svg>`,
    parts: { eyes: '.my-eyes' },
    lines: { idle: ['今天也一起加油。'] }
  })
})()
```

## 它會自己做的事

不必寫任何程式，每隻寵物都會：

| 行為 | 細節 |
| --- | --- |
| 拖曳、甩出去 | 放手時速度夠快就甩出去，有慣性、撞到視窗邊緣會反彈，暈一下之後飄回家。慢慢放下，那裡就是牠的新家 |
| 滾輪縮放 | 0.5–2.5 倍，會記住 |
| 雙擊跟著你 | 跟在游標後面，留下一道軌跡。**右鍵任何地方**可以停下，Esc 不會（Esc 會中斷 Claude Code） |
| 看你的游標 | 游標靠近時，眼睛和身體會轉過去 |
| 跟著打字搖晃 | 聽 `keydown` 和 `compositionupdate`（輸入法），每 150 ms 最多晃一次 |
| 心情 | happy、curious、bored、sleepy、worried，每 30 秒衰減一次；最強的心情會影響閒置動作，偶爾在頭上冒出符號 |
| 閒置動作 | 每 12–30 秒依心情加權挑一個，不會連續重複同一個 |
| 被嚇到 | 游標快速掠過身邊時（每 20 秒最多一次） |
| 歡迎回來 | 離開超過 10 分鐘再回到 Orca 時 |
| 睡覺 | 一陣子沒有操作就睡著，眼睛換成睡眼，冒出 z；有任何操作就醒來 |
| agent 分頁 | agent 工作中，光暈會呼吸；有分頁在等你授權時，牠會飛去那個分頁旁邊敲門，點牠就切過去；做完會轉圈，失敗會垂頭 |
| 聽你送出的那一行 | 只看終端機裡按 Enter 送出的那一行，判斷好消息、道謝、累了、bug、問題。像「沒有 bug」這種否定句會算好消息。這一行只存在記憶體裡，按下 Enter 就丟掉，不會儲存或送到任何地方 |
| 一直刪字 | 2.5 秒內按 8 次 Backspace，牠會歪頭看你 |
| 摸摸牠 | 游標在牠身上來回移動 |
| 說話 | 對話框一個字一個字打出來。閒置台詞至少間隔 6 分鐘，任何台詞至少間隔 45 秒，一天最多 12 句 |
| 記得你們的日子 | 一起過了幾天、第 7／30／100／200／365… 天會慶祝、依時段打招呼、比你平常晚很多還在用時會擔心你。全部只存在 localStorage |
| 點一下 | 戳戳牠；在敲門時點牠，會切到那個分頁 |

在系統設定「減少動態」時，牠不會出現，因為執行環境不會啟動任何 touch。

## 設定

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `id` | string | **必填**。touch id，同時用在 localStorage key |
| `svg` | string | **必填**。SVG 字串；`<defs>` 裡的 id 請加上寵物名稱當前綴，避免撞名 |
| `label` / `description` | string | 選單上顯示的名稱與說明 |
| `title` | string | 滑鼠停在牠身上時的提示文字 |
| `size` | number | 畫出來的像素大小，預設 64 |
| `parts` | object | 部位名稱對應選擇器，見下表 |
| `colors` | object | `sparkle`、`heart`、`note`、`alert`、`calm`、`dim`、`trail`：特效和符號的顏色 |
| `glow` | string \| false | 身後光暈的顏色（CSS 顏色），`false` 表示不要光暈 |
| `sounds` | object \| false | 合成鈴聲的頻率（Hz），可設 `pet`、`welcome`、`follow`、`star`，另有 `gain`（音量倍率）；`false` 表示完全靜音 |
| `home` | `({width,height,box}) => {x,y}` | 預設位置（使用者還沒拖動過之前） |
| `signature` | string | 招牌動作的名稱（放下、跟隨結束、甩完回家時做），預設 `wiggle` |
| `acts` | object | 自己的動作；可以新增、覆蓋，或設成 `null` 拿掉內建動作 |
| `reactions` | object | 覆蓋內建反應（見下方） |
| `words` | `[{ re, react }]` | 送出的那一行符合 `re` 時觸發 `react`（動作或反應的名稱，或 `(api) => …`）。會在內建關鍵字之前檢查 |
| `defaultWords` | boolean | `false` 表示不要內建的中英文關鍵字 |
| `names` | string[] | 牠的名字；出現在送出的那一行時，牠會開心地回應（`lines.name`） |
| `lines` | object | 台詞，見下方。沒有台詞的寵物不會說話 |
| `milestones` | number[] | 要慶祝的天數，預設 `[7, 30, 100, 200, 365, 500, 1000]` |
| `emotes` | object | 新增或覆蓋頭上冒出的符號：`{ happy: ['♡', '#f6b3c8'] }` |
| `idleEvery` | `[min, max]` ms | 閒置動作的間隔，預設 `[12000, 30000]` |
| `sleepAfter` | ms | 多久沒操作就睡著，預設白天 90 秒、晚上 120 秒 |
| `welcomeAfter` | ms | 離開多久回來才算「歡迎回來」，預設 10 分鐘 |
| `blink` | boolean | `false` 表示不眨眼 |
| `eyeTravel` | `[x, y]` | 眼睛看向游標時最多移動多少，預設 `[2.2, 1.6]` |
| `visitTabs` | boolean | `false` 表示不去敲等待授權的分頁 |
| `trail` | boolean | `false` 表示跟隨時不留軌跡 |
| `bubbleStyle` | string | 附加在對話框上的 CSS |
| `onStart(api)` / `onStop(api)` | function | 啟動和停止時各呼叫一次。自己加的監聽器請在 `onStop` 移除 |

### 部位 `parts`

值可以是選擇器字串，或 `{ sel, origin }`。每個元素都會設定 `transform-box: fill-box`，旋轉基準點優先順序是：元素上的 `data-origin`，然後 `origin`，然後預設值。

| 名稱 | 引擎怎麼用 |
| --- | --- |
| `eyes` | 眨眼（scaleY）、看向游標（translate） |
| `happyEyes` | 開心時取代 `eyes`（平常隱藏） |
| `sleepEyes` | 睡覺、打瞌睡時取代 `eyes` |
| `ears` | 待機時輕擺，被嚇到、甩耳朵、環顧四周時會動。左右耳各自用 `data-origin` 設定支點 |
| `flutter` | 待機時一直輕輕伸縮（翅膀、毛、尾巴） |
| 其他任何名稱 | 自己的動作可以用 `api.parts('tail')`、`api.animateParts('tail', keyframes, options)` 取用 |

### 台詞 `lines`

```js
lines: {
  idle: [...], night: [...],       // 閒置時偶爾說（night：22 點到 5 點）
  done: [...], failed: [...],      // agent 做完、失敗
  welcome: [...], name: [...],     // 歡迎回來、被叫名字
  late: [...],                     // 比你平常晚很多還在用時
  greeting: { morning, noon, afternoon, evening, night },  // 每天第一次見面
  milestone: ['這是我們一起的第 {n} 天！']
}
```

台詞要短，一行就好（對話框不換行），寫得像這個角色會說的話。

### 動作 `acts`

```js
acts: {
  boing: {
    weight: (c) => 3 + c.mood.happy * 2,   // or a number; 0 = never picked when idle
    run: (api) => api.act(api.at([api.t(0, 0), api.t(0, -14, 0, 0.92, 1.1), api.t(0, 0)], [0, 0.5, 1]), 900)
  },
  shy: (api) => api.act([api.t(0, 0), api.t(-6, 0, -8), api.t(0, 0)], 800),  // shorthand: weight 2
  chaseStar: null                          // remove a built-in act
}
```

`weight(c)` 拿到的 `c`：`{ mood, hour, night, near (游標在附近), working (有 agent 在工作) }`。

內建動作：`wiggle`、`lookAround`、`stretch`、`earFlick`、`loop`、`doze`、`hum`、`chaseStar`、`peek`、`cheer`、`sigh`、`wander`。

### 反應 `reactions`

內建反應：`happy`（被摸）、`twirl`、`signature`、`goodNews`、`thanks`、`sleepy`、`worried`、`curious`、`name`、`poke`（點一下），以及 `welcome`、`greet`、`milestone(n)`。用同樣的名稱就能覆蓋，例如 Puff 擔心時會下小雨：

```js
reactions: { worried: (api) => { api.emote('worried'); api.acts.drizzle() } }
```

## `api`（傳給動作、反應、`onStart`）

| 成員 | 說明 |
| --- | --- |
| `act(keyframes, ms, easing?)` | 在身體上播一段動作（WAAPI，`composite: 'add'`）；播放中不會再挑閒置動作 |
| `t(x, y, deg?, sx?, sy?)` | 產生一格 `transform` |
| `at(frames, offsets)` | 替每一格加上 `offset` |
| `animateParts(name, keyframes, options)` | 讓某個部位播動畫 |
| `parts(name)` | 某個部位的元素陣列 |
| `setFace('happy' \| 'sleep' \| null, ms?)` | 換表情，`ms` 毫秒後換回來 |
| `emote(name)` | 頭上冒出心情符號 |
| `feel(mood, amount)` | 調整心情（0–1） |
| `say(text, { idle?, force? })` | 說一句話（受頻率限制；`force` 可以略過間隔） |
| `sparkle(n, radius?)`、`floatUp(glyph, color, opts?)` | 小特效 |
| `chime(freqs, gain?, gap?)` | 合成鈴聲 |
| `play(name)` | 觸發一個反應或動作 |
| `acts`、`reactions`、`mood`、`lines`、`bond`、`colors` | 目前的狀態 |
| `spot`、`center()`、`size`、`mode`、`busy` | 位置與狀態（`mode`：`home`、`asleep`、`flying`、`following`、`visiting`） |
| `root`、`svg`、`host` | 寵物的容器、SVG、所在的圖層（自己加的元素放進 `host`，並設 `pointer-events:none`） |

除錯：在 DevTools Console 輸入 `__orcaThemer.companions.get('puff').acts.boing()`。

## 畫 SVG 的建議

- `viewBox="0 0 120 120"`，角色畫在中間，腳底大約在 y=100。
- 把會動的部位分成有 class 的 `<g>`：眼睛、開心眼、睡眼、左右耳、會飄動的部分。
- 漸層 id 要加前綴（`my-pet-wool`），同一頁可能有好幾隻寵物。
- 輪廓用淺色描邊，加一層淡淡的 `drop-shadow`，在亮色或暗色主題上都看得見。
- 小尺寸（64px）下仍要認得出來：頭大、五官簡單、對比清楚。
- 用你有權使用的素材。這個 kit 的範例角色都是原創的；請不要直接複製遊戲或動畫裡的角色圖。
