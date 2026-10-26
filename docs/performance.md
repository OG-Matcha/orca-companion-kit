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

14. **尊重 `prefers-reduced-motion`。**
    系統設定「減少動態」時，執行環境本來就不會啟動任何 touch；CSS 動畫請自己加上 media query。

## 怎麼確認

- `npm run check`：靜態檢查。
- Orca 裡內建打字延遲量測：大部分按鍵超過 200 ms 時，畫面會出現提示。按 Ctrl+Alt+T →「效能」，它會輪流關掉主題 CSS 和 touch，比較延遲的中位數，告訴你是哪一部分讓打字變慢。
