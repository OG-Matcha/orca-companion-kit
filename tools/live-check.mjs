// `npm run live-check`: drives the pet settings panel in an isolated Orca (never yours) with real input
// and prints one line per check. Use it after touching companion_settings.js, companion.js or the picker.
//
//   npm run live-check                          Puff (examples/touches/puff.js) in the Cotton Sky theme
//   node tools/live-check.mjs --shots DIR       also save screenshots of each step into DIR
//   node tools/live-check.mjs --keep-work       keep the temp folder (settings.json, user data)
//   node tools/live-check.mjs --projects-only   only the two-project check below
//
// Checks: with two projects, a tab of the one not in front that waits for permission gets a knock on that
// project's sidebar row, and a click on the pet switches project and opens the tab. Then: the picker opens 「寵物設定」; right-click on the pet opens it; ✕, a click outside and Ctrl+Alt+T
// close it; Esc closes neither it nor the picker; every tab renders; every 「試試看」 plays with no page
// error; a switch that is off stops the behaviour; settings land in settings.json and survive a reload;
// the pet's own row (Puff's 蓬起毛) is there. Exit code 1 when a check fails.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { launch, sleep, themeTouches } from './perf-lib.mjs'

const args = process.argv.slice(2)
const opt = (name) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const THEME = opt('theme') ?? 'cotton-sky'
const PET = opt('pet') ?? 'puff'
const OWN_ROW = opt('own-row') ?? 'puffUp'
const PROJECTS_ONLY = args.includes('--projects-only')
const SHOTS = opt('shots') ? path.resolve(opt('shots')) : null
const WORK = path.join(process.env.ORCA_PERF_TEMP || os.tmpdir(), `orca-live-check-${process.pid}`)
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}

const inst = await launch({ work: WORK, themeId: THEME, touches: themeTouches(THEME) })
const ev = (expr) => inst.eval(expr, 20000)
const shot = async (name) => {
  if (!SHOTS) return
  await sleep(350)
  await inst.dev({ cmd: 'screenshot', out: path.join(SHOTS, `${name}.png`) })
}
const key = (event) => inst.dev({ cmd: 'key', event })
const ctrlAltT = () => key({ key: 't', code: 'KeyT', windowsVirtualKeyCode: 84, modifiers: 3 })
const esc = () => key({ key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
const mouse = (events) => inst.dev({ cmd: 'mouse', events })
const settingsOpen = () => ev(`!!document.getElementById('oc-settings') && !document.getElementById('oc-settings').dataset.closing`)
const pickerOpen = () => ev(`!!document.getElementById('orca-themer-picker')`)
const petCenter = () =>
  ev(`(() => { const p = [...__orcaThemer.companions.values()].find(p => p.id === ${JSON.stringify(PET)}) ?? [...__orcaThemer.companions.values()][0]; const r = p.root.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
const settle = () => sleep(450)
const SKIP_REST = Symbol('projects only')

// ---- a tab of another project: Orca keeps every visited worktree's tabs mounted but lays out only the
// one in front, so the pet has to knock on that project's sidebar row and switch project on click.
const otherProject = async () => {
  for (const name of ['proj-a', 'proj-b']) {
    const dir = path.join(WORK, name)
    fs.mkdirSync(dir, { recursive: true })
    const git = (...a) => execFileSync('git', ['-c', 'user.name=live-check', '-c', 'user.email=live-check@example.invalid', ...a], { cwd: dir, stdio: 'ignore' })
    git('init', '-q')
    fs.writeFileSync(path.join(dir, 'README.md'), `# ${name}\n`)
    git('add', 'README.md')
    git('commit', '-q', '-m', 'init')
  }
  const two = JSON.parse(
    await inst.eval(
      `(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms))
        const u = [...document.querySelectorAll('script[src],link[href]')].map((e) => e.src || e.href).find((s) => s.includes('/store-'))
        const mod = await import(u)
        const st = Object.values(mod).find((v) => typeof v?.getState === 'function' && typeof v.getState().setActiveWorktree === 'function')
        window.__lcStore = st
        const find = (n) => st.getState().allWorktrees().find((w) => w.path.replace(/\\\\/g, '/').endsWith('/' + n))
        for (const p of ${JSON.stringify([path.join(WORK, 'proj-a'), path.join(WORK, 'proj-b')])}) await st.getState().addRepoPath(p)
        for (let i = 0; i < 40 && !(find('proj-a') && find('proj-b')); i++) await wait(500)
        const a = find('proj-a')?.id, b = find('proj-b')?.id
        if (!a || !b) return JSON.stringify({ error: 'no worktrees' })
        const tabIn = async (wt) => {
          st.getState().setActiveWorktree(wt)
          await wait(2500)
          if (!(st.getState().tabsByWorktree[wt] ?? []).length) (st.getState().openNewTerminalTabInActiveWorkspace(), await wait(3000))
          return (st.getState().tabsByWorktree[wt] ?? [])[0]?.id ?? null
        }
        const tb = await tabIn(b)
        const ta = await tabIn(a)
        return JSON.stringify({ a, b, ta, tb })
      })()`,
      90000
    )
  )
  const sel = (id) => `document.querySelector('[data-testid="sortable-tab"][data-tab-id="${id}"]')`
  const laidOut = (id) => ev(`(${sel(id)}?.getBoundingClientRect().width ?? 0) > 0`)
  check("two projects, the other one's tab mounted but not laid out", two.ta && two.tb && (await ev(`!!${sel(two.tb)}`)) && !(await laidOut(two.tb)) && (await laidOut(two.ta)), JSON.stringify(two))
  check('the tab in front is the one laid out', await ev(`__orcaThemer.companionRules.frontTab()?.getAttribute('data-tab-id') === ${JSON.stringify(two.ta)}`))
  // The other project's agent asks for permission (the attribute Orca sets on its tab).
  await ev(`(${sel(two.tb)}.setAttribute('data-agent-activity-status', 'permission'), true)`)
  const ok = (n) => n && n.dx !== undefined && Math.abs(n.dx) < 48 && n.dy > -12 && n.dy < 64 && !n.front
  let near = null
  for (let i = 0; i < 20 && !ok(near); i++) {
    await sleep(500)
    near = await ev(`(() => {
      const st = window.__lcStore.getState(), wt = ${JSON.stringify(two.b)}
      const rows = [...document.querySelectorAll('[id^="worktree-list-option-"]')].filter((e) => e.getBoundingClientRect().width > 0)
      const dec = (e) => { try { return decodeURIComponent(e.id) } catch { return e.id } }
      const row = rows.find((e) => dec(e).includes(wt)) ?? rows.find((e) => e.getAttribute('data-repo-header-id') === wt.split('::')[0])
      const p = [...__orcaThemer.companions.values()][0].root.getBoundingClientRect()
      const r = row?.getBoundingClientRect()
      return r ? { dx: Math.round(p.left + p.width / 2 - (r.left + r.width / 2)), dy: Math.round(p.top - r.bottom), front: st.activeWorktreeId === wt } : { error: 'no row' }
    })()`)
  }
  await shot('50-knock-other-project')
  check("it knocks on the other project's sidebar row", ok(near), JSON.stringify(near))
  const c = await petCenter()
  await mouse([{ type: 'mouseMoved', x: c.x, y: c.y }, { type: 'mousePressed', x: c.x, y: c.y, button: 'left', buttons: 1, clickCount: 1 }, { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', clickCount: 1 }])
  let went = false
  for (let i = 0; i < 12 && !went; i++) {
    await sleep(500)
    went = await ev(`window.__lcStore.getState().activeWorktreeId === ${JSON.stringify(two.b)} && (${sel(two.tb)}?.getBoundingClientRect().width ?? 0) > 0 && ${sel(two.tb)}.dataset.active === 'true'`)
  }
  await shot('51-switched-project')
  check('a click on it switches to that project and opens the tab', went)
  await ev(`(${sel(two.tb)}?.removeAttribute('data-agent-activity-status'), true)`)
  await sleep(2500) // it flies home
}

try {
  await sleep(3000)
  // Page errors from here on: uncaught exceptions, rejected promises, and console errors / warnings.
  const hookErrors = () => ev(`(() => { window.__lc = []; addEventListener('error', e => __lc.push('error: ' + e.message)); addEventListener('unhandledrejection', e => __lc.push('rejection: ' + (e.reason?.message ?? e.reason))); for (const k of ['error', 'warn']) { const o = console[k]; console[k] = (...a) => { __lc.push(k + ': ' + a.map(String).join(' ').slice(0, 200)); o.apply(console, a) } } })()`)
  await hookErrors()
  const errors = () => ev(`__lc.filter(m => !m.includes('[terminal]'))`) // Orca's own terminal warnings are not ours
  check('the pet is on screen', await ev(`!!document.querySelector('[data-orca-themer-companion], #orca-themer-companion-${PET}') || [...__orcaThemer.companions.values()].some(p => p.root?.isConnected)`))
  await shot('00-start')
  await otherProject()
  if (PROJECTS_ONLY) throw SKIP_REST

  // ---- picker -> 寵物設定
  await ctrlAltT()
  await settle()
  check('Ctrl+Alt+T opens the picker', await pickerOpen())
  const hasRow = await ev(`[...document.querySelectorAll('#orca-themer-picker .otp-row')].some(b => b.textContent.includes('寵物設定'))`)
  check('the picker lists 寵物設定', hasRow)
  await shot('01-picker')
  await esc()
  await settle()
  check('Esc does not close the picker', await pickerOpen())
  await ctrlAltT()
  await settle()
  check('Ctrl+Alt+T again closes the picker', !(await pickerOpen()))
  await ctrlAltT()
  await settle()
  await esc()
  await mouse([{ type: 'mousePressed', x: 3, y: 3, button: 'left', clickCount: 1 }, { type: 'mouseReleased', x: 3, y: 3, button: 'left', clickCount: 1 }])
  await settle()
  check('a click on the picker scrim closes it', !(await pickerOpen()))
  await ctrlAltT()
  await settle()
  await ev(`[...document.querySelectorAll('#orca-themer-picker .otp-row')].find(b => b.textContent.includes('寵物設定'))?.click()`)
  await settle()
  check('picking 寵物設定 opens the panel and closes the picker', (await settingsOpen()) && !(await pickerOpen()))
  await shot('02-opened-from-picker')

  // ---- Esc, then the three ways to close
  await esc()
  await settle()
  check('Esc does not close the panel', await settingsOpen())
  await ev(`document.querySelector('#oc-settings .ocs-x').click()`)
  await sleep(700)
  check('✕ closes the panel', !(await settingsOpen()))
  await ctrlAltT()
  await settle()
  await ev(`[...document.querySelectorAll('#orca-themer-picker .otp-row')].find(b => b.textContent.includes('寵物設定'))?.click()`)
  await settle()
  await ctrlAltT()
  await sleep(700)
  check('Ctrl+Alt+T closes the panel', !(await settingsOpen()))

  // ---- right-click on the pet
  let c = await petCenter()
  await mouse([{ type: 'mouseMoved', x: c.x, y: c.y }, { type: 'mousePressed', x: c.x, y: c.y, button: 'right', buttons: 2, clickCount: 1 }, { type: 'mouseReleased', x: c.x, y: c.y, button: 'right', clickCount: 1 }])
  await settle()
  check('right-click on the pet opens the panel', await settingsOpen())
  await shot('03-right-click')
  const outside = await ev(`(() => { const r = document.querySelector('#oc-settings .ocs-panel').getBoundingClientRect(); return { x: r.left > innerWidth / 2 ? 40 : innerWidth - 40, y: innerHeight / 2 } })()`)
  const hit = await ev(`(() => { const e = document.elementFromPoint(${outside.x}, ${outside.y}); return (e?.className || e?.tagName) + ' / body pointer-events ' + getComputedStyle(document.body).pointerEvents })()`)
  await mouse([{ type: 'mousePressed', x: outside.x, y: outside.y, button: 'left', clickCount: 1 }, { type: 'mouseReleased', x: outside.x, y: outside.y, button: 'left', clickCount: 1 }])
  await sleep(700)
  check('a click outside closes the panel', !(await settingsOpen()), hit)

  // ---- every tab renders; every 試試看 plays
  c = await petCenter()
  await mouse([{ type: 'mousePressed', x: c.x, y: c.y, button: 'right', buttons: 2, clickCount: 1 }, { type: 'mouseReleased', x: c.x, y: c.y, button: 'right', clickCount: 1 }])
  await settle()
  const tabs = await ev(`[...document.querySelectorAll('#oc-settings .ocs-tab')].map(b => b.dataset.tab)`)
  check('the panel has tabs', tabs.length >= 5, tabs.join(','))
  const tried = []
  for (const tab of tabs) {
    await ev(`document.querySelector('#oc-settings .ocs-tab[data-tab="${tab}"]').click()`)
    await settle()
    const info = await ev(`(() => { const pane = document.querySelector('#oc-settings .ocs-pane'); return { rows: pane.querySelectorAll('[data-row]').length, head: pane.querySelector('.ocs-h')?.textContent, tries: [...pane.querySelectorAll('.ocs-try')].filter(b => !b.disabled).length } })()`)
    check(`tab ${tab} renders`, info.rows > 0 && info.head, `${info.head}, ${info.rows} rows, ${info.tries} 試試看`)
    await shot(`10-tab-${tab}`)
    const rowIds = await ev(`[...document.querySelectorAll('#oc-settings .ocs-pane [data-row]')].filter(r => r.querySelector('.ocs-try:not(:disabled)')).map(r => r.dataset.row)`)
    for (const id of rowIds) {
      // 敲分頁 needs a tab to knock on; the bare isolated Orca may have none.
      if (id === 'knock' && !(await ev(`!!document.querySelector('[data-testid="sortable-tab"]')`))) {
        check('試試看 knock', true, 'skipped: no tab in this window')
        continue
      }
      // Wait until the pet is free (a preview refuses while it is busy), then press the button.
      let ok = false
      for (let i = 0; i < 12 && !ok; i++) {
        await ev(`(() => { window.__lcAnim = document.getAnimations().length; window.__lcPeak = __lcAnim; clearInterval(window.__lcPoll); window.__lcPoll = setInterval(() => { __lcPeak = Math.max(__lcPeak, document.getAnimations().length) }, 30); window.__lcMut = 0; window.__lcObs?.disconnect(); window.__lcObs = new MutationObserver(m => { for (const r of m) if (!r.target.closest?.('#oc-settings')) window.__lcMut++ }); __lcObs.observe(document.body, { childList: true, subtree: true, attributes: true }) })()`)
        await ev(`document.querySelector('#oc-settings [data-row="${id}"] .ocs-try').click()`)
        await sleep(250)
        ok = await ev(`document.querySelector('#oc-settings [data-row="${id}"] .ocs-try')?.hasAttribute('data-playing')`)
        if (!ok) await sleep(1700)
      }
      await sleep(500)
      const seen = await ev(`(clearInterval(window.__lcPoll), { anim: Math.max(__lcPeak, document.getAnimations().length) - __lcAnim, mut: __lcMut })`)
      tried.push({ id, ok, ...seen })
      check(`試試看 ${id} plays`, ok, `animations ${seen.anim >= 0 ? '+' : ''}${seen.anim}, page changes ${seen.mut}`)
      await sleep(900)
    }
  }
  const AUDIO = ['sound', 'chime'] // heard, not seen
  const quiet = tried.filter((t) => t.ok && !AUDIO.includes(t.id) && t.mut === 0 && t.anim <= 0).map((t) => t.id)
  check('every 試試看 visibly changes the page', quiet.length === 0, quiet.length ? `no visible change: ${quiet.join(',')}` : '')
  check('no page errors while trying every behaviour', (await errors()).length === 0, (await errors()).slice(0, 3).join(' | '))

  // ---- the pet's own row (examples/touches/puff.js)
  await ev(`document.querySelector('#oc-settings .ocs-tab[data-tab="daily"]').click()`)
  await settle()
  const own = await ev(`(() => { const r = document.querySelector('#oc-settings [data-row="${OWN_ROW}"]'); return r ? { text: r.textContent, has: !!r.querySelector('.ocs-try'), freq: !!r.querySelector('.ocs-seg') } : null })()`)
  check(`the pet's own row ${OWN_ROW} is listed`, own && own.has && own.freq, own?.text.slice(0, 30))
  await shot('20-own-row')

  // ---- switching a behaviour off stops it
  const sweep = async () => {
    const p = await petCenter()
    await ev(`(() => { window.__lcMut = 0; window.__lcObs?.disconnect(); window.__lcObs = new MutationObserver(m => { for (const r of m) if (!r.target.closest?.('#oc-settings')) window.__lcMut++ }); __lcObs.observe(document.body, { childList: true, subtree: true }) })()`)
    const steps = []
    for (let i = 0; i < 14; i++) steps.push({ type: 'mouseMoved', x: p.x + (i % 2 ? 28 : -28), y: p.y, wait: 55 })
    await mouse(steps)
    await sleep(900)
    const n = await ev(`__lcMut`)
    await mouse([{ type: 'mouseMoved', x: 5, y: 5 }])
    return n
  }
  const setSwitch = async (tab, id, want) => {
    await ev(`document.querySelector('#oc-settings .ocs-tab[data-tab="${tab}"]').click()`)
    await settle()
    await ev(`(() => { const s = document.querySelector('#oc-settings [data-row="${id}"] .ocs-switch'); if ((s.getAttribute('aria-checked') === 'true') !== ${want}) s.click() })()`)
    await settle()
  }
  const closeByShortcut = async () => (await ctrlAltT(), await sleep(700))
  await closeByShortcut()
  const onCount = await sweep()
  check('with 摸摸 on, a back-and-forth over the pet reacts', onCount > 0, `${onCount} DOM changes`)
  await sleep(3000)
  await ctrlAltT()
  await settle()
  await ev(`[...document.querySelectorAll('#orca-themer-picker .otp-row')].find(b => b.textContent.includes('寵物設定'))?.click()`)
  await settle()
  await setSwitch('touch', 'pet', false)
  await shot('30-pet-off')
  await closeByShortcut()
  const offCount = await sweep()
  check('with 摸摸 off, the same movement barely does anything', offCount <= Math.max(2, onCount / 4), `${offCount} DOM changes against ${onCount} with it on (idle chatter allowed)`)

  // ---- persistence: settings.json, then a reload
  await ctrlAltT()
  await settle()
  await ev(`[...document.querySelectorAll('#orca-themer-picker .otp-row')].find(b => b.textContent.includes('寵物設定'))?.click()`)
  await settle()
  await ev(`document.querySelector('#oc-settings .ocs-tab[data-tab="daily"]').click()`)
  await settle()
  await ev(`[...document.querySelectorAll('#oc-settings [data-row="${OWN_ROW}"] .ocs-seg button')].find(b => b.dataset.v === '2').click()`)
  await settle()
  await closeByShortcut()
  await sleep(600)
  const file = path.join(inst.root, 'settings.json')
  const saved = JSON.parse(fs.readFileSync(file, 'utf8')).companions?.[PET]
  check('settings.json holds the changes', saved?.features?.pet === false && saved?.freq?.[OWN_ROW] === 2, JSON.stringify(saved).slice(0, 120))
  await inst.cdp('Page.reload', {})
  await sleep(6000)
  await ev(`!!window.__orcaThemer`)
  await sleep(2500)
  await hookErrors()
  const after = await ev(`(() => { const s = __orcaThemer.state?.companions?.${PET}; return s ? JSON.stringify(s) : null })()`).catch(() => null)
  check('the state survives a reload', after && JSON.parse(after).features?.pet === false)
  await ctrlAltT()
  await settle()
  await ev(`[...document.querySelectorAll('#orca-themer-picker .otp-row')].find(b => b.textContent.includes('寵物設定'))?.click()`)
  await settle()
  await ev(`document.querySelector('#oc-settings .ocs-tab[data-tab="touch"]').click()`)
  await settle()
  const switchOn = await ev(`document.querySelector('#oc-settings [data-row="pet"] .ocs-switch').getAttribute('aria-checked')`)
  await ev(`document.querySelector('#oc-settings .ocs-tab[data-tab="daily"]').click()`)
  await settle()
  const freqNow = await ev(`document.querySelector('#oc-settings [data-row="${OWN_ROW}"] .ocs-seg [aria-checked="true"], #oc-settings [data-row="${OWN_ROW}"] .ocs-seg [aria-pressed="true"]')?.dataset.v`)
  check('after the reload the panel shows the saved values', switchOn === 'false' && freqNow === '2', `摸摸 ${switchOn}, ${OWN_ROW} freq ${freqNow}`)
  await shot('40-after-reload')
  await esc()
  await settle()
  check('Esc still does not close the panel after a reload', await settingsOpen())
  await closeByShortcut()
  check('no page errors in the whole run', (await errors()).length === 0, (await errors()).slice(0, 3).join(' | '))
} catch (error) {
  if (error === SKIP_REST) check('no page errors', (await ev(`__lc.filter(m => !m.includes('[terminal]'))`)).length === 0)
  else check('the run finished', false, error.stack?.split('\n').slice(0, 3).join(' '))
} finally {
  await inst.stop()
  if (!args.includes('--keep-work')) fs.rmSync(WORK, { recursive: true, force: true })
}
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
