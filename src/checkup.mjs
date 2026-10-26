// After an Orca update: is everything the themer leans on still there? Runs once per Orca version.
// Checks that each fix still patched, that the DOM hooks themes style still exist once the window has
// loaded, and that every touch started. Silent when all is well; one notice in Orca when something is
// off, with the details in themer.log.
import fs from 'node:fs'
import path from 'node:path'

// The hooks themes rely on that every loaded Orca window has (see the theme docs, "DOM 掛點").
// `when`: only checked if that selector is present, for parts that exist only with a terminal open.
export const DOM_HOOKS = [
  { selector: '.bg-worktree-sidebar[data-os-file-drop-owner]', label: 'worktree 側欄' },
  { selector: '[data-sidebar-resize-handle]', label: '側欄拖曳邊' },
  { selector: '[data-testid="sortable-tab"][data-tab-id]', label: '分頁', when: '.xterm, .monaco-editor' },
  { selector: '.xterm-helper-textarea', label: '終端機輸入框', when: '.xterm' }
]

/** Orca's version from its app.asar package.json, or null if it cannot be read. */
export function readOrcaVersion(asar, asarFile) {
  try {
    return JSON.parse(asar.extractFile(asarFile, 'package.json').toString('utf8')).version ?? null
  } catch {
    return null
  }
}

/** The version the last checkup ran for (null if none yet). */
export function lastCheckedVersion(stateFile) {
  try {
    return JSON.parse(fs.readFileSync(stateFile, 'utf8')).version ?? null
  } catch {
    return null
  }
}

/** A checkup is due when Orca's version is known and differs from the one last checked (first run included). */
export function checkupDue(lastVersion, currentVersion) {
  return Boolean(currentVersion) && lastVersion !== currentVersion
}

export function recordChecked(stateFile, version, ok) {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true })
  fs.writeFileSync(stateFile, JSON.stringify({ version, ok, checkedAt: new Date().toISOString() }, null, 2))
}

/**
 * Runs in the main window: waits until the sidebar is up (or 30 s), then reports each hook and the
 * touches that threw on start. Evaluated with awaitPromise.
 */
export function pageProbeExpression(hooks = DOM_HOOKS) {
  return `(async (hooks) => {
    const waitFor = async (selector, ms) => {
      const until = Date.now() + ms
      while (!document.querySelector(selector) && Date.now() < until) await new Promise((r) => setTimeout(r, 1000))
    }
    await waitFor(hooks[0].selector, 30000)
    // The restored terminal or editor mounts a few seconds after the sidebar; their hooks wait for it.
    const later = hooks.filter((h) => h.when).map((h) => h.when).join(',')
    if (later) await waitFor(later, 20000)
    await new Promise((r) => setTimeout(r, 1500))
    const results = hooks.map((h) => ({
      selector: h.selector,
      label: h.label,
      status: h.when && !document.querySelector(h.when) ? 'skipped' : document.querySelector(h.selector) ? 'ok' : 'missing'
    }))
    return { hooks: results, touchErrors: window.__orcaThemer?.touchErrors ?? [] }
  })(${JSON.stringify(hooks)})`
}

/**
 * Turns what the checkup found into log lines and, when something is off, one short notice.
 * @param {{ version: string, fixWarnings: string[], hooks: {selector,label,status}[] | null, touchErrors: {id,error}[], runtimeError: string | null }} found
 */
export function summarizeCheckup({ version, fixWarnings = [], hooks = null, touchErrors = [], runtimeError = null }) {
  const missing = (hooks ?? []).filter((h) => h.status === 'missing')
  const problems = []
  if (runtimeError) problems.push(`主題程式在新版 Orca 執行出錯：${runtimeError.split('\n')[0].slice(0, 120)}`)
  for (const w of fixWarnings) problems.push(w)
  if (hooks === null) problems.push('沒辦法檢查畫面掛點（主視窗沒有回應）')
  else if (missing.length) problems.push(`主題用到的畫面掛點有 ${missing.length} 個找不到：${missing.map((h) => h.label).join('、')}，相關樣式可能失效`)
  if (touchErrors.length) problems.push(`小巧思啟動失敗：${[...new Set(touchErrors.map((t) => t.id))].join('、')}`)
  const details = [
    `checkup for Orca ${version}: ${problems.length ? `${problems.length} problem(s)` : 'all good'}`,
    ...(hooks ?? []).map((h) => `  hook ${h.status.padEnd(7)} ${h.selector}`),
    ...fixWarnings.map((w) => `  fix: ${w}`),
    ...touchErrors.map((t) => `  touch ${t.id} failed: ${t.error}`),
    ...(runtimeError ? [`  runtime: ${runtimeError}`] : [])
  ]
  const notice = problems.length ? `Orca 更新到 ${version}，主題有地方要修：\n${problems.map((p) => `・${p}`).join('\n')}\n細節在 themer.log` : null
  return { ok: problems.length === 0, notice, details }
}
