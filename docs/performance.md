# 效能守則 Performance rules

主題和 touch 跟 Orca 跑在同一個 renderer 裡，你加的每條規則、每個監聽器，打字時都會一起跑。下面每一條都是在 Orca 裡實際量到的延遲。`npm run check` 會自動抓得到的那幾條，標了 **[check]**。

Themes and touches run inside Orca's renderer, on the same thread as your typing. Every rule below comes from a slowdown measured in Orca. **[check]** = `npm run check` flags it.

## CSS

1. **不要寫整頁的 `::selection`。[check]**
   打字時游標在 xterm 隱藏的 `<textarea>` 裡移動，每移一次都算一次選取變更，Chromium 會對整頁重新套用 `::selection` 規則。實測每個按鍵從約 96 ms 變成約 840 ms。要改選取色，就只寫在單一元素上（`.my-panel::selection`），而且不要涵蓋終端機。
   *No page-wide `::selection`: the caret moving in xterm's hidden textarea is a selection change; measured ~840 ms per keystroke vs ~96 ms.*

2. **`:not()` 裡面不要放組合子。[check]**
   `*:not(.a .b)`、`*:not(.a > .b)` 這種寫法掛在萬用選擇器上，每次樣式重算都要約 70 ms。輸入法組字時每按一鍵就重算一次，中文、日文打字會明顯卡頓。`:not()` 的參數只放簡單選擇器：`*:not([role='separator'], .resize)`。
   *No combinators inside `:not()` on universal selectors: ~70 ms per style recalc, and IME composition recalcs on every key.*

3. **`transition`／`animation` 不要掛在 `*` 上。[check]**
   只放在真的需要動的那幾個元素。

4. **整個視窗不要套 `filter`、`backdrop-filter`。[check]**
   終端機每重畫一次，整個視窗就要重新合成一次。

5. **只會無限循環的動畫，範圍要小。**
   會一直動的東西（呼吸光暈、閃爍）只能放在小元素上，並且在 `@media (prefers-reduced-motion: reduce)` 裡關掉。

6. **sonner 通知（`[data-sonner-toast]`）的 `::before`、`::after` 不能動。**
   sonner 自己用 `::before` 做滑動關閉的感應區，用 `::after` 補滑鼠移過的間隙。要裝飾通知，請用 `background` 疊圖層（`background: url(...) right / 40px no-repeat, var(--popover)`），不要用偽元素。

## Touch（JS）

7. **不要用整個視窗大小的 canvas。[check]**
   畫面上只要有東西在動，全視窗 canvas 每一格都要整張重新合成。輸入法一次送出很長的字串時，會跟終端機重畫撞在一起，掉格。用小 canvas（power-mode 用 320px）跟著游標移動，只清掉上一格畫過的區域。

8. **每個按鍵要做的事要節流。**
   每個按鍵最多做一次很便宜的事；動畫至少隔 150 ms。跟版面有關的讀取（`getBoundingClientRect`）要快取，或留到下一個 `requestAnimationFrame` 再做。千萬不要在終端機剛寫完 DOM 的時候讀版面。

9. **不要在每個按鍵或每一格讀 canvas 像素（`getImageData`）。[check]**
   這會強迫 GPU 回讀，打字直接卡住。

10. **輸入法要聽 `compositionupdate`／`compositionend`。[check]**
    Windows 的輸入法（注音、倉頡、日文……）組字時，只有第一個鍵會送 `keydown`（key 是 `Process`）。之後每一鍵只有 `compositionupdate`，送出時才有 `compositionend`。

11. **不要綁 Esc。[check]**
    在終端機裡，Esc 會中斷 Claude Code 和其他 agent。要停止某件事，用右鍵、點一下或雙擊。

12. **`stop()` 要把東西全部收乾淨。[check 會抓 setInterval／addEventListener 沒成對的情況]**
    每個監聽器、計時器、observer、`requestAnimationFrame`、加進頁面的元素都要清掉。使用者切換主題、存檔熱重載時都會呼叫 `stop()`。

13. **動畫只動 `transform` 和 `opacity`（WAAPI 或 CSS）。**
    不要動 `left`／`top`／`width`，也不要每一格改 `box-shadow`／`filter`。真的需要每一格計算的動作（甩出去、跟著游標）才用 `requestAnimationFrame`，停下來就結束迴圈。

14. **一直循環的動畫不要放在 SVG 裡的 `<g>` 上。**
    Chromium 沒辦法把 SVG 子元素的 `transform` 動畫交給合成器，每一格都要把整張 SVG（連同 `drop-shadow`）重新排版、重畫。範例寵物 Puff 的絨毛和耳朵原本這樣動，閒置時每分鐘吃掉約 10 秒主執行緒，打字也跟著變慢。要一直動的部位，拆成自己的 HTML 方塊（一個 `div` 包一張同 `viewBox` 的 SVG），疊回原位。
    *No always-on loop on an SVG group: it re-lays-out and repaints the whole SVG every frame (~10 s of main-thread time a minute, measured). Give the part its own HTML box.*

15. **循環動畫的元素上，別讓其他動畫跟它重疊。**
    無限循環如果在同一個元素還有別的動畫時開始，或之後被疊上別的動畫（`composite: 'add'` 的小動作、`fill: 'forwards'` 的亮燈），Chromium 會把它標成不相容，從此一直在主執行緒跑，其他動畫結束了也不會回到合成器；`pause()` 再 `play()` 也沒用。做法：等元素上只剩這個循環時，用同樣的 keyframes、timing、`currentTime` 重建一份新的（看不出跳動），再取消舊的。另外，被一個已結束、`fill: 'forwards'` 的同屬性動畫蓋住的循環雖然看不到，每一格仍然要算，直接拿掉。
    *A loop that overlaps another animation on the same element stays on the main thread for good (~7 s a minute, measured); recreate it once it is alone. A loop hidden under a finished `fill: 'forwards'` animation still costs a frame every frame.*

16. **尊重 `prefers-reduced-motion`。**
    系統設定「減少動態」時，執行環境本來就不會啟動任何 touch；CSS 動畫請自己加上 media query。

## 怎麼確認

- `npm run check`：靜態檢查。
- `npm test` 裡的 `test/perf-rules.test.mjs`：讀 `companion.js` 的原始碼，確認會動的部位有抽成 HTML 圖層、每個循環都有 keepComposited、additive 動作有進巢狀盒子、視線有節流。
- `npm run perf`：見下節。
- Orca 裡內建打字延遲量測：大部分按鍵超過 200 ms 時，畫面會出現提示。按 Ctrl+Alt+T →「效能」，它會輪流關掉主題 CSS 和 touch，比較延遲的中位數，告訴你是哪一部分讓打字變慢。

## 量測 `npm run perf`

`npm run perf` 會開兩個隔離的 Orca（各自的 `--user-data-dir`，放在系統暫存資料夾的 `orca-perf-<pid>`，跑完刪掉；Orca 替每個新的 user-data-dir 複製的 `%LOCALAPPDATA%\Orca\daemon-host-profiles\<hash>`（約 270 MB）也一併刪），不碰你正在用的 Orca。兩個都套 Cotton Sky 主題和它列的全部 touch，一個開 Puff（a）、一個關 Puff（b），跑同一段腳本：閒置、打字（每秒 8 字、每行 Enter）、游標繞著 Puff 移動、終端機大量輸出（`tools/perf-burst.mjs` 模擬 agent）。量的是主執行緒忙碌時間（CDP `Performance.getMetrics` 的 TaskDuration）、長任務、按鍵到下一格畫面的延遲、樣式重算與排版次數、計時器、GC 後的 heap。

Puff 多花的（a − b）超過預算就失敗（exit code 1）。預算在 `tools/perf.mjs` 的 `BUDGET`，設在實測值稍上方；單跑一次會上下差幾 s/分鐘。

- `--pet <id> --theme <id>`：量別隻寵物（主題的 `@touches` 要列它）。
- `--before <另一份 checkout>`：多跑一組 a0，用那份程式碼做前後對照（那份也要有 dev channel 的 `cdp` 指令）。
- `--study`：a／b／c（c ＝ 主題但不開 touch）各 3 次交錯執行，閒置 5 分鐘，結果寫成 JSON。
- `--trace`：打字與游標時錄 Chromium trace，印出渲染主執行緒各事件的時間；trace 檔留在 work 資料夾，可再查 Animation 事件的 `compositeFailed`。

量測時別同時跑其他隔離 Orca 或重的工作，會互相搶 CPU。

### 2026-10-28：圖層化前後（Puff，a − b，兩次中位數）

| 項目 | 改前（main 8997ef5） | 改後 | 關掉 Puff |
|---|---|---|---|
| 閒置主執行緒（ms/分鐘） | 23,771 | 1,561 | 583 |
| 閒置樣式重算（次/分鐘） | 7,410 | 779 | 59 |
| 閒置排版（次/分鐘） | 7,404 | 44 | 4 |
| 打字主執行緒（ms/分鐘） | 40,332 | 25,147 | 19,472 |
| 打字 按鍵→畫面 p95（ms） | 60.1 | 44.4 | 34.9 |
| 打字長任務（個，20 秒內） | 4 | 4 | 0 |
| 游標主執行緒（ms/分鐘） | 33,244 | 18,021 | 9,616 |
| 游標樣式重算（次/分鐘） | 7,460 | 7,415 | 1,432 |
| 終端機大量輸出主執行緒（ms/分鐘） | 38,008 | 25,207 | 16,571 |

改前 Puff 的三種循環（身體上下、絨毛、兩隻耳朵）都在 SVG 的 `<g>` 上，閒置時每一格都重排、重畫整張 SVG：主執行緒每分鐘忙 24 秒。抽成 HTML 圖層、循環重建回合成器、小動作改進巢狀盒子、視線節流之後，閒置只比關掉 Puff 多約 1 秒/分鐘（trace 裡四個循環的 `compositeFailed` 都是 0，剩下的是每格一次 Layerize），打字的按鍵→畫面 p95 從 60 ms 降到 44 ms。游標移動時剩下的樣式重算來自 Orca 自己的 hover 樣式加上視線轉場（每 60 ms 一次），長任務來自終端機本身。

預算（`BUDGET`）：閒置 +3,000 ms/分鐘、閒置長任務 2、打字 p95 +20 ms、打字 +13,000 ms/分鐘、游標 +13,000 ms/分鐘、heap +15 MB/小時；2026-10-28 實測 a − b 為 +978、0、+9.5、+5,675、+8,405、+10.6，全部通過。
