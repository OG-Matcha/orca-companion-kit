# 安裝、開機啟動、撐過 Orca 更新

## 需求

- Windows 10／11
- Node.js 20 以上（`node -v`）
- Orca 裝在預設位置 `%LOCALAPPDATA%\Programs\orca\Orca.exe`（其他位置：設定環境變數 `ORCA_DIR`）

## 安裝

```powershell
npm install
.\install.ps1
```

`install.ps1` 會：

1. 把 `node.exe` 複製成 `bin\orca-companion.exe`。啟動器結束時 Orca 也會跟著關（這是私有管線的特性），所以它用不同的名字，避免被 `taskkill /IM node.exe` 這類清理指令順手關掉。
2. 產生 `Orca Companion.vbs`，不開主控台視窗就啟動啟動器。
3. 把桌面、開始選單、工作列上的 `Orca.lnk` 改成指向這個 `.vbs`，並把原本的捷徑備份到 `backup\`。

之後照常從捷徑開 Orca 就好。

## 開機自動啟動

如果你希望登入 Windows 時自動開 Orca，在「啟動」資料夾放一個捷徑指向 `Orca Companion.vbs`：

```powershell
$s = (New-Object -ComObject WScript.Shell).CreateShortcut("$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\Orca.lnk")
$s.TargetPath = "$env:WINDIR\System32\wscript.exe"
$s.Arguments = '"' + (Resolve-Path '.\Orca Companion.vbs') + '"'
$s.Save()
```

## 為什麼 Orca 更新後不會壞

- **Orca 的檔案一個 byte 都沒改。** 主題和 touch 是在 Orca 載入時，從外面經由 CDP 注入的。更新換掉的是 Orca 自己的檔案，跟這個 kit 無關。
- **主題只改 CSS 變數。** 變數名稱很少變。萬一某個 DOM 掛點改了，也只是那條規則失效，畫面不會壞。
- **捷徑會自己修好。** Orca 的更新程式會把捷徑改回 `Orca.exe`。啟動器每次啟動 5 秒後、以及 Orca 關閉後的 3 分鐘內（更新通常就在這時候安裝），都會檢查一次，再把捷徑指回來。
- **修正是選用的，也有防護。** 預設不開啟任何執行期修正。開啟後，只有在 Orca 的程式碼形狀完全對得上時才會套用，對不上就原樣放行，見 [fixes.md](fixes.md)。

唯一的例外：Orca 更新完自己重新開啟的那一次不會經過啟動器，所以沒有主題。從捷徑再開一次就好。

## 檔案在哪裡

| 路徑 | 內容 |
| --- | --- |
| `~/.orca/themer/themes/` | 主題（第一次啟動時會放入三個經典主題） |
| `~/.orca/themer/snippets/` | 片段 |
| `~/.orca/themer/touches/` | 你的 touch 和寵物 |
| `~/.orca/themer/terminal/` | 終端機配色 |
| `~/.orca/themer/sounds/` | 通知音效 |
| `~/.orca/themer/assets/<主題 id>/` | 主題用的圖片 |
| `~/.orca/themer/settings.json` | 選了哪個主題、開了哪些 touch、`enabledFixes` |
| `~/.orca/themer/themer.log` | 啟動器紀錄（每次啟動會重寫） |

想放在別處：設定環境變數 `ORCA_THEMER_ROOT`。

repo 內附的主題會同步到使用者資料夾：你沒改過的檔案會跟著更新，改過的不會被覆蓋，刪掉的也不會再放回去。

## 試跑（不影響正在用的 Orca）

```powershell
node src/themer.mjs --user-data-dir=$env:TEMP\orca-trial
```

用獨立的設定資料夾開第二個 Orca。這種試跑不會關掉原本的 Orca，也不會動到捷徑。也可以設定 `ORCA_COMPANION_NO_SHORTCUTS=1`，只關掉捷徑管理。

開發用：`$env:ORCA_THEMER_DEV='1'` 時，可以用 `node tools/dev.mjs <root> '{"cmd":"eval","expr":"1+1"}'` 在主視窗執行指令或截圖（`{"cmd":"screenshot","out":"C:\\path\\shot.png"}`）。

## 疑難排解

| 症狀 | 處理 |
| --- | --- |
| 沒有主題 | 確認是從捷徑開的；看 `themer.log`；重跑 `install.ps1` |
| 主題選單打不開 | Ctrl+Alt+T 被其他程式攔走了；Console 裡輸入 `__orcaThemer.openPicker()` |
| touch 沒出現 | 主題的 `@touches` 有沒有列它？選單裡有沒有勾？系統是否設定「減少動態」？`themer.log` 有沒有寫 `touch skipped`？ |
| 打字變慢 | Ctrl+Alt+T →「效能」量一次；跑 `npm run check`；對照 [performance.md](performance.md) |
| Orca 被關掉了 | 啟動器結束時 Orca 也會跟著關。不要結束 `orca-companion.exe` |

## 解除安裝

```powershell
.\uninstall.ps1                       # restore the original shortcuts
Remove-Item -Recurse ~/.orca/themer   # optional: your themes and pets too
```
