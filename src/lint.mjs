// Static checks for themes and touches. Each rule comes from a real slowdown measured in Orca; see
// docs/performance.md. Used by `npm run check` (your user folder) and `npm test` (this repo's files).
import vm from 'node:vm'

const stripCss = (css) =>
  css
    .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' ')) // keep line numbers
    .replace(/url\((?:"[^"]*"|'[^']*'|[^)]*)\)/g, 'url()')
const lineOf = (text, index) => text.slice(0, index).split('\n').length

/** Returns [{ level: 'error' | 'warn', line, rule, message }] for one CSS file. */
export function lintCss(css) {
  const issues = []
  const src = stripCss(css)
  // 1. A page-wide ::selection made every terminal keystroke take ~800 ms: the caret in xterm's hidden
  //    textarea is a selection change, and Chromium re-evaluated the rule for the whole page.
  for (const m of src.matchAll(/(^|[\s,>{}(])(\*?)::selection/gm))
    issues.push({ level: 'error', line: lineOf(src, m.index), rule: 'page-wide-selection', message: 'page-wide ::selection (scope it, e.g. .my-panel ::selection, and never over the terminal)' })
  // 2. A combinator inside :not() on a universal selector made every style recalc take ~70 ms; IME
  //    composition recalcs on each key, so Chinese/Japanese typing lagged.
  for (const m of src.matchAll(/:not\(((?:[^()]|\([^()]*\))*)\)/g))
    for (const arg of m[1].split(','))
      if (/[\s>+~]/.test(arg.trim()))
        issues.push({ level: 'error', line: lineOf(src, m.index), rule: 'not-combinator', message: `combinator inside :not(${arg.trim()}) (keep :not() arguments simple)` })
  // 3. Transitions or animations on every element re-run style work on each change anywhere.
  for (const m of src.matchAll(/(^|[},]\s*)(\*|html \*|body \*)\s*\{[^}]*\b(transition|animation)\s*:/gm))
    issues.push({ level: 'warn', line: lineOf(src, m.index), rule: 'universal-motion', message: `${m[3]} on a universal selector (put it on the few elements that need it)` })
  // 4. Filters and backdrop blurs on the whole window are re-composited every frame the terminal draws.
  for (const m of src.matchAll(/(^|[},]\s*)(html|body|:root|#root)\s*\{[^}]*\b(backdrop-filter|filter)\s*:/gm))
    issues.push({ level: 'warn', line: lineOf(src, m.index), rule: 'window-filter', message: `${m[3]} on ${m[2]} (the whole window re-composites on every terminal redraw)` })
  return issues
}

/** Returns the same kind of list for one touch (JS) file. Nothing is executed. */
export function lintTouch(source, filename = 'touch.js') {
  const issues = []
  try {
    new vm.Script(source, { filename })
  } catch (error) {
    issues.push({ level: 'error', line: Number(/:(\d+)/.exec(error.stack ?? '')?.[1]) || 1, rule: 'syntax', message: error.message })
    return issues
  }
  const code = source.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
  const find = (re, level, rule, message) => {
    const m = re.exec(code)
    if (m) issues.push({ level, line: lineOf(code, m.index), rule, message })
  }
  if (!/registerTouch|registerCompanion|registerAttrTouch|registerPickerItem/.test(code))
    issues.push({ level: 'warn', line: 1, rule: 'no-register', message: 'registers nothing (call window.__orcaThemer.registerTouch or registerCompanion)' })
  // Esc interrupts Claude Code and other agents in the terminal; a touch must never take it.
  find(/['"`]Escape['"`]|['"`]Esc['"`]|keyCode\s*===?\s*27|which\s*===?\s*27/, 'error', 'esc-binding', 'binds Esc (it interrupts Claude Code in the terminal; use right-click or a click instead)')
  // Reading canvas pixels forces a GPU readback; per keystroke it stalls typing.
  find(/getImageData\s*\(/, 'warn', 'canvas-readback', 'getImageData: never call it per keystroke or per frame')
  find(/::selection/, 'error', 'page-wide-selection', '::selection in injected CSS (see docs/performance.md)')
  // A canvas the size of the window is re-composited whole every frame something moves on it.
  if (/createElement\(\s*['"`]canvas['"`]\s*\)/.test(code) && /(width|w)\s*=\s*innerWidth|inset\s*:\s*0|100vw/.test(code))
    issues.push({ level: 'warn', line: 1, rule: 'full-window-canvas', message: 'looks like a full-window canvas; use a small canvas that moves to where the effect is (see power-mode.js)' })
  // Typing is heard on the window or the document; a keydown on an element of your own (a panel's arrow
  // keys) is not typing.
  if (/(?:^|[^.\w$]|(?:window|document|globalThis)\.)addEventListener\(\s*['"`]keydown/m.test(code) && !/compositionupdate|compositionend/.test(code))
    issues.push({ level: 'warn', line: 1, rule: 'ime', message: 'listens to keydown only: Windows IMEs send keydown for the first composing key only; also listen to compositionupdate/compositionend' })
  if (/setInterval\(/.test(code) && !/clearInterval\(/.test(code))
    issues.push({ level: 'warn', line: 1, rule: 'cleanup', message: 'setInterval without clearInterval: clear every timer in the stop function' })
  if (/addEventListener\(/.test(code) && !/removeEventListener\(/.test(code) && !/registerCompanion\(/.test(code))
    issues.push({ level: 'warn', line: 1, rule: 'cleanup', message: 'addEventListener without removeEventListener: remove every listener in the stop function' })
  return issues
}

const TERMINAL_KEYS = ['background', 'foreground', 'cursor', 'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white']
/** A terminal palette (terminal/<theme id>.json, Orca TerminalColorOverrides). */
export function lintTerminal(text) {
  let palette
  try {
    palette = JSON.parse(text)
  } catch (error) {
    return [{ level: 'error', line: 1, rule: 'json', message: error.message }]
  }
  const issues = []
  for (const key of TERMINAL_KEYS) if (!palette[key]) issues.push({ level: 'warn', line: 1, rule: 'terminal-key', message: `missing "${key}"` })
  for (const [key, value] of Object.entries(palette))
    if (typeof value !== 'string' || !/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value))
      issues.push({ level: 'error', line: 1, rule: 'terminal-color', message: `"${key}" should be a #hex color` })
  return issues
}
