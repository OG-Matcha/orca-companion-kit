# 選用的執行期修正

Orca 載入自己的程式檔時，啟動器可以用 CDP `Fetch` 換成修正過的版本。磁碟上的檔案不會被修改。**預設全部關閉**，要在 `~/.orca/themer/settings.json` 自己開：

```json
{ "enabledFixes": ["claude-restart-after-switch"] }
```

存檔後要從捷徑重開 Orca 才會生效，因為修正在啟動時準備。需要先跑過 `npm install`（讀取 `app.asar` 會用到 `@electron/asar`）。

## 防護

每個修正只認得一種確切的程式碼形狀：

- 對不上（Orca 更新改了寫法）就回傳 `null`，原樣放行，並在 `themer.log` 寫 `code not found in this Orca build, skipped`
- 同一段程式碼出現兩次（代表結構變了）也會放棄
- Orca 改版後第一次啟動的健檢會把沒套上的修正（全部或其中一部分）列進同一則提醒
- 測試在 `test/core.test.mjs`

## `claude-restart-after-switch`

在 Orca 裡切換 Claude 帳號時，Orca 會重開執行中的 Claude session，讓它們換用新帳號。這個修正處理三個問題：

1. **還有背景工作的 session 永遠不會重開。** Orca 判斷「這個 pane 還在回合中」時看的是合併後的狀態，背景子 agent 還在跑就一直算「工作中」。修正後只看主 agent 的狀態，以及是否在等你（`waiting`／`blocked`）。
2. **重開後權限跑掉。** Claude pane 常常沒有記下啟動參數（`agentArgs` 是空的），重開的 `claude --resume` 就會退回 `~/.claude` 設定裡的 `defaultMode`，而不是你在 Orca 選的權限（例如 full-access）。修正後，空的參數會改用 Orca 的預設啟動參數，裡面帶著那個權限。
3. **記下的指令蓋過參數。** Claude 會把單純的 `claude` 記成 `agentCommand`，參數另外記；而 resume 只要看到 `agentCommand` 就會照原樣用，忽略參數。修正後，單純的 `claude`（沒有空格、沒有參數）會被拿掉，讓 Orca 用同一個指令重新組出含參數的版本。

第 2、3 點是可選的部分：如果那段程式碼的形狀變了，第 1 點仍會單獨套用。

## 寫新的修正

在 `src/fixes/` 新增一個模組，匯出 `{ id, hint, patch(source) }`：`hint` 是便宜的子字串預檢，`patch` 回傳修改後的原始碼，或 `null`。加進 `src/fixes/index.mjs` 的 `FIXES`，並用 Orca 打包後的真實片段寫測試。只修你確定的事，寧可不套也不要猜。
