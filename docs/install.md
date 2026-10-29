# 安裝、開機啟動、撐過 Orca 更新

## 需求

- Windows 10／11，或 macOS
- Node.js 20 以上（`node -v`）
- Windows：Orca 裝在預設位置 `%LOCALAPPDATA%\Programs\orca\Orca.exe`（其他位置：設定環境變數 `ORCA_DIR`）
- macOS：Orca 在 `/Applications/Orca.app` 或 `~/Applications/Orca.app`（其他位置：設定環境變數 `ORCA_APP`）

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

## 安裝（macOS）

```sh
npm install
./install.sh
```

`install.sh` 會建立 `~/Applications/Orca Companion.app`。它裡面只有一個 shell 腳本，用完整路徑呼叫 `node` 跑這個 repo 的 `src/themer.mjs`（從 Finder 或 Dock 開的 app 拿不到 Homebrew、nvm 的 PATH），所以 `git pull` 之後不用重裝；搬動 repo 或換了 Node 的位置才要重跑。

- **從它開 Orca。** 把它拖到 Dock，取代原本的 Orca 圖示。它本身不佔 Dock 位置（`LSUIElement`），開起來看到的是 Orca 自己的圖示。
- **沒有捷徑要管。** Orca 更新只會換掉 `Orca.app`，碰不到這個 app，所以 macOS 不需要 Windows 那套捷徑修復。
- **再點一次不會重開。** Orca 已經經由管線開著時（不論是這個 kit 還是其他用 `--remote-debugging-pipe` 的工具開的），啟動器只會把 Orca 叫到前面就結束。
- **關掉沒經過啟動器的 Orca 時**送的是 SIGTERM，跟 ⌘Q 一樣讓 Orca 自己結束；15 秒還沒結束才強制關閉。終端機的背景服務（`orca-terminal-host`）是獨立的程序，不受影響。

快捷鍵是 **⌃⌥T**（Control+Option+T）。`npm run perf` 和 `npm run live-check` 目前只支援 Windows。

解除安裝：`./uninstall.sh` 刪掉 `Orca Companion.app`，再把 Dock 上的圖示換回 Orca。

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
| `~/.orca/themer/settings.json` | 選了哪個主題、開了哪些 touch、`enabledFixes`、每隻寵物的設定（`companions`，只記跟預設不同的部分） |
| `~/.orca/themer/themer.log` | 啟動器紀錄（每次啟動會重寫） |

想放在別處：設定環境變數 `ORCA_THEMER_ROOT`。

repo 內附的主題會同步到使用者資料夾：你沒改過的檔案會跟著更新，改過的不會被覆蓋，刪掉的也不會再放回去。

## 試跑（不影響正在用的 Orca）

```powershell
node src/themer.mjs --user-data-dir=$env:TEMP\orca-trial
```

用獨立的設定資料夾開第二個 Orca。這種試跑不會關掉原本的 Orca，也不會動到捷徑。也可以設定 `ORCA_COMPANION_NO_SHORTCUTS=1`，只關掉捷徑管理。

開發用：`$env:ORCA_THEMER_DEV='1'` 時，可以用 `node tools/dev.mjs <root> '{"cmd":"eval","expr":"1+1"}'` 在主視窗執行指令或截圖（`{"cmd":"screenshot","out":"C:\\path\\shot.png"}`），或錄一段畫面做文件用的動圖（`{"cmd":"screencast","dir":"C:\\frames","ms":6000}`，JPEG 影格加 `frames.json` 時間戳），也能送真的滑鼠事件（`{"cmd":"mouse","events":[{"type":"mouseMoved","x":200,"y":300,"wait":50}]}`，欄位同 CDP `Input.dispatchMouseEvent`）。

## 推上 GitHub 之前：隱私檢查

這個 repo 是公開的，所以每次推到 `main` 或開 PR，GitHub Actions 都會跑一輪 CI：`npm test`、`npm run check -- --repo`，再加一道隱私檢查。本機也能先跑：

```powershell
npm run guard
```

它會看 repo 裡所有檔案（包括還沒 commit、沒被 `.gitignore` 排除的），以及還沒推上去的 commit，找出這幾種東西：

- 個人用字：名字、帳號、私人專案的詞。清單以 SHA-256 雜湊存在 `tools/guard.mjs`，不寫明文，免得清單本身就洩漏了。要加詞，跑 `node tools/guard.mjs --hash <詞>`，照檔頭說明貼進去。
- 真實的使用者資料夾，例如 `C:\Users\` 後面接真名。`<you>`、`%USERNAME%` 這類佔位字不算。
- email：只放行 `@users.noreply.github.com`、範例網域和 `noreply@` 這類機器人地址。
- 長得像金鑰或 token 的字串。
- 圖片也會查：PNG 的文字區塊（壓縮過的也解開來看）、GIF 註解、JPEG 的 EXIF／XMP。
- commit 作者的 email 必須是 GitHub noreply 地址，commit 訊息也照上面的規則查。

誤判的話（個人用字除外），在那一行加上 `privacy-guard: allow` 註解就會跳過。

## 疑難排解

| 症狀 | 處理 |
| --- | --- |
| 沒有主題 | 確認是從捷徑（macOS：`Orca Companion.app`）開的；看 `themer.log`；重跑 `install.ps1`／`install.sh` |
| 主題選單打不開 | Ctrl+Alt+T（macOS：⌃⌥T）被其他程式攔走了；Console 裡輸入 `__orcaThemer.openPicker()` |
| touch 沒出現 | 主題的 `@touches` 有沒有列它？選單裡有沒有勾？系統是否設定「減少動態」？`themer.log` 有沒有寫 `touch skipped`？ |
| 打字變慢 | Ctrl+Alt+T →「效能」量一次；跑 `npm run check`；對照 [performance.md](performance.md) |
| Orca 被關掉了 | 啟動器結束時 Orca 也會跟著關。不要結束 `orca-companion.exe`（macOS：跑 `src/themer.mjs` 的 node） |

## 解除安裝

```powershell
.\uninstall.ps1                       # restore the original shortcuts
Remove-Item -Recurse ~/.orca/themer   # optional: your themes and pets too
```
