# Touches：小巧思 API

touch 是一段在每個 Orca 視窗裡執行的小 JS 效果。檔案放在 `~/.orca/themer/touches/<名字>.js`，主題的 `@touches` 列了它的 id 才會執行。

## 最小範例

```js
// ~/.orca/themer/touches/focus-glow.js
;(() => {
  const T = window.__orcaThemer
  if (!T) return
  T.registerTouch('focus-glow', {
    label: '聚焦光暈',                       // shown in the Ctrl+Alt+T picker
    description: '輸入框聚焦時有一圈柔光',
    start() {
      document.documentElement.setAttribute('data-focus-glow', '')
      return () => document.documentElement.removeAttribute('data-focus-glow') // stop(): undo everything
    }
  })
})()
```

只有加屬性、其餘交給 CSS 的 touch，可以簡寫成：

```js
window.__orcaThemer?.registerAttrTouch('focus-glow', { label: '聚焦光暈', description: '…' })
```

## 生命週期

- 載入順序固定：先載 `src/touches/*.js`（依檔名排序），再載 `~/.orca/themer/touches/*.js`（依檔名排序）。所以使用者的檔案一定可以用 `registerCompanion`。
- 有語法錯誤的檔案會被跳過，原因寫在 `~/.orca/themer/themer.log`。其他檔案不受影響。每個檔案也各自包在 `try` 裡。
- `start()` 在主題宣告了它、使用者開著它、而且系統沒有設定「減少動態」時才會被呼叫。它要回傳一個 `stop` 函式。
- 切換主題、在選單關掉它、或存檔熱重載時都會呼叫 `stop()`。同一個 id 再註冊一次，會先停掉舊版本，再啟動新版本。
- 存檔 `touches/*.js` 會重新組出注入腳本，並在每個視窗重跑一次。刪掉的 touch 要等 Orca 重開後才會完全消失。

## `window.__orcaThemer`

| 成員 | 說明 |
| --- | --- |
| `registerTouch(id, { label, description, start })` | 註冊 touch |
| `registerAttrTouch(id, { label, description })` | 開著時在 `<html>` 加 `data-orca-touch-<id>` |
| `registerCompanion(config)` | 註冊寵物，見 [companion-api.md](companion-api.md) |
| `companions` | `Map(id → api)`：正在跑的寵物，方便除錯（`__orcaThemer.companions.get('puff').acts.boing()`） |
| `state` | 目前的主題、片段、touch 狀態（唯讀） |
| `reducedMotion()` | 系統是否設定「減少動態」 |
| `log(message)` | 寫一行到 `~/.orca/themer/themer.log` |
| `openPicker()` | 打開 Ctrl+Alt+T 選單 |
| `registerPickerItem({ id, label, sub, when?, run })` | 在選單的「設定」區加一列，點了就關掉選單、呼叫 `run()`；`when()` 回傳 `false` 時不顯示 |
| `setOverlay({ isOpen, close } \| null)` | 從選單打開的面板登記在這裡，再按一次 Ctrl+Alt+T 就呼叫 `close()`，而不是開選單 |
| `updateState(patch)`、`send(message)` | 先在這個視窗套用狀態（送出 `orca-themer:state`），再請啟動器存檔；寵物設定用的是 `{ type: 'companion-config', id, config }` |
| `openCompanionSettings(id)` | 打開（或關掉）某隻寵物的設定面板 |
| `companionConfig` | 寵物設定的目錄與純函式（`catalog`、`defaults`、`normalize`、`diff`、`quietAt`……），見 companion-api.md「設定面板」 |

## 事件

| 事件（`window`） | `detail` | 誰送的 |
| --- | --- | --- |
| `orca-themer:combo` | 目前的連擊數 | power-mode，每一次連擊 +1 |
| `orca-themer:state` | 無 | 執行環境：`state` 變了（換主題、開關 touch、改寵物設定），也包括別的視窗改的 |

## 寫 touch 的規則

請先讀 [performance.md](performance.md)。重點：

- 動畫只動 `transform`、`opacity`（WAAPI：`el.animate(...)`）
- 每個按鍵要做的事要節流；不要在按鍵處理裡讀版面
- 輸入法要聽 `compositionupdate`／`compositionend`
- 不要綁 Esc
- 加進頁面的元素一律 `pointer-events:none`，只有真的要互動的才例外
- `stop()` 要清乾淨：監聽器、計時器、observer、`requestAnimationFrame`、元素

寫完跑 `npm run check`。touch 啟動失敗時，錯誤會寫進 `~/.orca/themer/themer.log`（`touch <id> failed to start`）；開得了開發者工具的話，Console 也看得到。
