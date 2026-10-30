# 整套換主題：CSS.createStyleSheet → setStyleSheetText

這份是小抄，寫的是 Chrome DevTools Protocol（CDP）`CSS` domain 裡「一次換掉整份樣式表」的做法。拿來除錯或做實驗很方便，像是在 DevTools 裡試一套配色，或寫一支小工具把整套主題丟進頁面。

**這個 kit 自己沒有用這條路。** 啟動器用 `Page.addScriptToEvaluateOnNewDocument` 把 `src/page-runtime.js` 放進每個視窗，主題 CSS 寫進一個自己的 `<style>`，換主題時只改它的 `textContent`，所以本來就是整套一起換（見 `styleElement()`）。寫主題請照 [themes.md](themes.md) 的做法；這份只是用來參考。

## 流程

```text
DOM.enable                                  # CSS domain 要先開 DOM 才能用
CSS.enable
Page.getFrameTree                           # 拿主框架的 frameId
CSS.createStyleSheet { frameId }            # → { styleSheetId }
CSS.setStyleSheetText { styleSheetId, text: "<整套主題 CSS>" }
# 之後換主題：對同一個 styleSheetId 再呼叫一次 setStyleSheetText
```

- `createStyleSheet` 會在那個框架的文件裡建一份「via inspector」樣式表，origin 是 `inspector`。沒帶 `force`（實驗性參數）時，同一份文件重複呼叫會拿回同一份；帶 `force: true` 才會每次都建新的。
- `setStyleSheetText` 是**整份取代**，不是附加。要清空就傳空字串。
- 每個 target（每個 Orca 視窗）都要各做一次；`styleSheetId` 不能跨視窗共用。

## 注意事項

- **重新整理或換頁就沒了。** 這份樣式表跟著當下的文件走，視窗 reload 之後舊的 `styleSheetId` 就失效。要留住的話，得聽 `Page.frameNavigated`（或 `CSS.styleSheetRemoved`），在新文件裡再建一次、再設一次文字。這段空檔會看到原本的 Orca 外觀閃一下；kit 用 `addScriptToEvaluateOnNewDocument` 就是為了避免這個。
- **順序不一定贏。** 規則一樣具體時，後載入的樣式表會贏。Orca 之後才載入的 chunk 樣式表可能蓋過你的；kit 用 MutationObserver 讓自己的 `<style>` 一直排在 `<head>` 最後，這條路沒有這層保護。不想這樣的話，選擇器要寫得夠具體（例如 `html.dark`）。
- **語法錯誤不會被擋下來。** 有問題的規則多半會被 CSS parser 默默丟掉，不會回錯誤。先在 `~/.orca/themer/themes/` 存檔，跑 `npm run check` 過了再送。
- **效能守則一樣適用。** 整份換掉會觸發一次全頁 style recalc，跟改 `textContent` 一樣。[performance.md](performance.md) 列的陷阱（全頁 `::selection`、`:not()` 裡放組合子……）在這裡一樣慢。
- **只能從持有 CDP 連線的那一方呼叫。** kit 的私有管線只有啟動器拿得到；不要為了這個另外開 `--remote-debugging-port`，也不要停掉啟動器或 Orca 來換連線方式。

## 能不能在 Styles 面板編輯

可以。origin 是 `inspector` 的樣式表就是 DevTools「New Style Rule（+）」按鈕寫進去的那一份，Styles 面板裡規則旁會標成 `inspector-stylesheet:<行號>`，可以直接點開改值、勾掉屬性，也能在 Sources 面板看到整份文字。

不過要知道：

- 在面板裡改的東西**只存在當下的頁面**，不會寫回 `~/.orca/themer/` 的檔案；reload 就沒了。滿意的值要自己抄回主題檔。
- 下一次 `setStyleSheetText` 會把面板裡的修改整份蓋掉。
- 上面說的是建立它的那個 DevTools／CDP 連線看到的樣子。從另一條連線（例如另開的 DevTools 視窗）看會怎麼標示，這個 repo 沒有在 Orca 裡實測過，以實際畫面為準。

kit 自己的 `<style>` 是一般的頁內樣式表（origin `regular`），在 Styles 面板裡一樣可以改，限制相同：存檔才會留下來，而存檔就會熱重載。
