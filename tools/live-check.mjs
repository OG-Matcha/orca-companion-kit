// `npm run live-check`: drives the pet settings panel in an isolated Orca (never yours) with real input
// and prints one line per check. Use it after touching companion_settings.js, companion.js or the picker.
//
//   npm run live-check                          Puff (examples/touches/puff.js) in the Cotton Sky theme
//   node tools/live-check.mjs --shots DIR       also save screenshots of each step into DIR
//   node tools/live-check.mjs --keep-work       keep the temp folder (settings.json, user data)
//   node tools/live-check.mjs --projects-only   only the two-project check below
//   node tools/live-check.mjs --emotion-only    only the feelings checks below
//
// Checks: with two projects, a tab of the one not in front that waits for permission gets a knock on that
// project's sidebar row, and a click on the pet switches project and opens the tab; then the first project
// is put back in front and the pet waited for until it is home and idle. Then: the picker opens 「寵物設定」; right-click on the pet opens it; ✕, a click outside and Ctrl+Alt+T
// close it; Esc closes neither it nor the picker; every tab renders; every 「試試看」 plays with no page
// error; a switch that is off stops the behaviour; settings land in settings.json and survive a reload;
// the pet's own row (Puff's 蓬起毛) is there. Feelings: the 心情 tab comes first and renders, holding Alt
// shows its numbers, an agent tab that fails lowers the mood (each failure counted, even back to back)
// and not the affection, the sulk happens once a day, three pats make up, and its switch turns it off.
// Exit code 1 when a check fails.
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
const EMOTION_ONLY = args.includes('--emotion-only')
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
// Polls an expression until it is truthy (bounded); returns its last value. Waits on what the page shows,
// not on a fixed timer: a window that another isolated Orca (or the one in use) keeps busy runs late.
const waitFor = async (expr, ms = 5000, every = 100) => {
  const until = Date.now() + ms
  while (true) {
    const v = await ev(expr).catch(() => null)
    if (v || Date.now() >= until) return v
    await sleep(every)
  }
}
const SETTINGS_OPEN = `(!!document.getElementById('oc-settings') && !document.getElementById('oc-settings').dataset.closing)`
const PET_EXPR = `([...__orcaThemer.companions.values()].find(p => p.id === ${JSON.stringify(PET)}) ?? [...__orcaThemer.companions.values()][0])`
// Home, still, and not in the middle of anything (a preview or a pass of the pointer finds it there).
const petFree = (ms = 15000) => waitFor(`(() => { const p = ${PET_EXPR}; return p.mode === 'home' && !p.busy && !document.hidden })()`, ms, 150)
// Clicks the first element the expression finds, waiting for it to be there; a clear error when it never is.
const clickWhenThere = async (expr, what, ms = 5000) => {
  if (!(await waitFor(`!!(${expr})`, ms))) throw new Error(`${what} is not on the page (${expr})`)
  await ev(`(${expr}).click()`)
}
const openPicker = async () => {
  if (!(await pickerOpen())) await ctrlAltT()
  return waitFor(`!!document.getElementById('orca-themer-picker')`, 4000)
}
// Ctrl+Alt+T, then 「寵物設定」 in the picker, until the panel is open.
const openSettings = async () => {
  if (await settingsOpen()) return true
  await openPicker()
  await clickWhenThere(`[...document.querySelectorAll('#orca-themer-picker .otp-row')].find(b => b.textContent.includes('寵物設定'))`, 'the 寵物設定 row')
  return waitFor(SETTINGS_OPEN, 4000)
}
const waitClosed = () => waitFor(`!(${SETTINGS_OPEN})`, 4000)
const showTab = async (tab) => {
  await clickWhenThere(`document.querySelector('#oc-settings .ocs-tab[data-tab="${tab}"]')`, `the ${tab} tab`)
  await waitFor(`document.querySelector('#oc-settings .ocs-tab[data-tab="${tab}"]')?.getAttribute('aria-selected') === 'true'`, 3000)
}

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
        const assets = new URL('assets/', location.href).href
        const u = [...document.querySelectorAll('link[rel="modulepreload"][href]')].map((e) => e.href).find((s) => s.startsWith(assets) && /^store-[\\w-]{8}\\.js$/.test(s.slice(assets.length)))
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
  // Back to how the window was before this check: the first project in front with its own tab, the pet
  // home and idle. Left on the other project, the checks below ran against a window the pet had just
  // been switching around in, and failed now and then.
  await ev(`(window.__lcStore.getState().setActiveWorktree(${JSON.stringify(two.a)}), true)`)
  const back = await waitFor(`window.__lcStore.getState().activeWorktreeId === ${JSON.stringify(two.a)} && (${sel(two.ta)}?.getBoundingClientRect().width ?? 0) > 0 && !document.querySelector('[data-agent-activity-status="permission"]')`, 10000)
  check('afterwards the first project is in front again', back)
  check('afterwards the pet is home and idle', await petFree(20000), JSON.stringify(await ev(`(() => { const p = ${PET_EXPR}; return { mode: p.mode, busy: p.busy, hidden: document.hidden } })()`)))
}

// The window counts as focused and visible even behind other windows (the Orca in use, another isolated
// one): the pet says nothing and starts nothing while the page is hidden, and that is not what is checked.
const focusEmulation = () => inst.cdp('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {})

// ---- feelings (src/touches/companion_emotion.js): the 心情 tab, Alt, a failure, the sulk and making up.
const emotionChecks = async () => {
  const P = `[...__orcaThemer.companions.values()].find(p => p.id === ${JSON.stringify(PET)})`
  const emo = (expr) => ev(`(() => { const e = ${P}.emotion; return ${expr} })()`)
  const view = () => emo(`(({ mood, aff, anx, target, moodlets }) => ({ mood, aff, anx, target, kinds: moodlets.map(m => m.kind + 'x' + m.count) }))(e.view())`)
  const sulking = () => ev(`!!${P}.emotion.sulking`)
  const waitUntil = async (fn, ms) => {
    for (let t = 0; t < ms; t += 250) {
      if (await fn()) return true
      await sleep(250)
    }
    return false
  }
  const openPanel = async () => {
    const c = await petCenter()
    await mouse([{ type: 'mouseMoved', x: c.x, y: c.y }, { type: 'mousePressed', x: c.x, y: c.y, button: 'right', buttons: 2, clickCount: 1 }, { type: 'mouseReleased', x: c.x, y: c.y, button: 'right', clickCount: 1 }])
    await settle()
  }
  const closePanel = async () => {
    if (await settingsOpen()) await ctrlAltT()
    await sleep(700)
  }
  const setSulkSwitch = async (want) => {
    await openPanel()
    await ev(`(() => { const s = document.querySelector('#oc-settings [data-row="sulk"] .ocs-switch'); if ((s.getAttribute('aria-checked') === 'true') !== ${want}) s.click() })()`)
    await settle()
    await closePanel()
  }
  check('the pet has feelings', await ev(`!!${P}?.emotion?.view()`))
  // A calm, known state to start from (an isolated Orca: nothing of yours is touched), and no tab remembered.
  await ev(`(Object.keys(localStorage).filter(k => k.startsWith('ocs-') || k.includes('settings-tab')).forEach(k => localStorage.removeItem(k)), true)`)
  await emo(`(e.set({ mood: 60, anx: 0, lone: 0, sulkedToday: false }), true)`)

  // The 心情 tab: first, words shown and numbers hidden.
  await openPanel()
  const first = await ev(`(() => { const t = document.querySelector('#oc-settings .ocs-tab'); return t ? { tab: t.dataset.tab, selected: t.getAttribute('aria-selected') } : null })()`)
  check('the 心情 tab comes first', first?.tab === 'heart', JSON.stringify(first))
  await ev(`(document.querySelector('#oc-settings .ocs-tab[data-tab="heart"]').click(), true)`)
  await settle()
  const heart = await ev(`(() => { const r = document.querySelector('#oc-settings [data-row="heart"]'); if (!r) return null; const alt = r.querySelector('.ocs-alt'); return { mood: r.querySelector('.ocs-hmood')?.textContent, tier: r.querySelector('.ocs-hv')?.textContent, hearts: r.querySelector('.ocs-hearts')?.textContent.length, altShown: !!alt && getComputedStyle(alt).display !== 'none', sulkRow: !!document.querySelector('#oc-settings [data-row="sulk"] .ocs-switch') } })()`)
  check('the 心情 tab shows words, hearts and the 鬧彆扭 switch, numbers hidden', heart && heart.mood && heart.mood !== '—' && heart.tier && heart.hearts === 5 && !heart.altShown && heart.sulkRow, JSON.stringify(heart))
  await shot('60-heart-tab')
  // Holding Alt shows the numbers; letting go hides them again.
  await inst.cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Alt', code: 'AltLeft', windowsVirtualKeyCode: 18, modifiers: 1 })
  await sleep(300)
  const held = await ev(`(() => { const a = document.querySelector('#oc-settings [data-row="heart"] .ocs-alt'); return { shown: !!a && getComputedStyle(a).display !== 'none', text: a?.textContent } })()`)
  await shot('61-heart-alt')
  await inst.cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Alt', code: 'AltLeft', windowsVirtualKeyCode: 18 })
  await sleep(300)
  const released = await ev(`getComputedStyle(document.querySelector('#oc-settings [data-row="heart"] .ocs-alt')).display`)
  check('holding Alt shows the numbers, letting go hides them', held.shown && /\d/.test(held.text ?? '') && released === 'none', `${held.text}; after: ${released}`)
  check('Alt does not close the panel', await settingsOpen())

  // An agent tab fails twice in a row (the attribute Orca sets on its tab; a stand-in tab, so no real one
  // changes): both count, before any reaction cooldown; anxiety and the mood's pull go one way, affection stays.
  await ev(`(() => { const t = document.createElement('div'); t.dataset.testid = 'sortable-tab'; t.dataset.tabId = 'live-check-emotion'; t.style.display = 'none'; document.body.appendChild(t); return true })()`)
  const tabSel = `document.querySelector('[data-tab-id="live-check-emotion"]')`
  await sleep(3500) // the 3 s status poll sees it with no status yet
  const before = await view()
  for (let i = 0; i < 2; i++) {
    await ev(`(${tabSel}.setAttribute('data-agent-activity-status', 'working'), true)`)
    await sleep(400)
    await ev(`(${tabSel}.setAttribute('data-agent-activity-status', 'failed'), true)`)
    await sleep(600)
  }
  await emo(`(e.tick(), true)`)
  const after = await view()
  await sleep(5300) // the panel repaints every 5 s
  const listed = await ev(`[...document.querySelectorAll('#oc-settings [data-row="heart"] .ocs-hlist li')].map(li => (li.dataset.kind ?? '') + ' ' + li.textContent)`)
  await shot('62-heart-after-failure')
  check(
    'two agent failures both count: anxiety up, mood falling toward a lower target, affection unchanged',
    after.kinds.includes('agentFailx2') && after.anx > before.anx + 10 && after.target < before.target - 5 && after.mood < before.mood && Math.abs(after.aff - before.aff) < 0.001,
    `anx ${before.anx.toFixed(1)}→${after.anx.toFixed(1)}, target ${before.target.toFixed(1)}→${after.target.toFixed(1)}, mood ${before.mood.toFixed(2)}→${after.mood.toFixed(2)}, aff ${before.aff}→${after.aff}, ${after.kinds.join(',')}`
  )
  check('the panel lists the failure', listed.some((t) => t.startsWith('agentFail')), listed.slice(0, 3).join(' | '))
  await ev(`(${tabSel}?.remove(), true)`)
  await closePanel()
  await sleep(4000) // the droop and its line play out

  // The sulk: mood under 20 sends it to a corner; three real pats (back and forth over it) win it back.
  const homeAt = await petCenter()
  await emo(`(e.set({ mood: 10, anx: 0, lone: 0, sulkedToday: false }), e.tick(), true)`)
  const sulked = await waitUntil(sulking, 6000)
  await sleep(2600) // it flies to the corner and turns away
  const corner = await petCenter()
  await shot('63-sulk')
  check('mood under 20: it sulks in a corner', sulked && Math.hypot(corner.x - homeAt.x, corner.y - homeAt.y) > 20, `from ${Math.round(homeAt.x)},${Math.round(homeAt.y)} to ${Math.round(corner.x)},${Math.round(corner.y)}`)
  const pats = []
  for (let i = 0; i < 8 && (await sulking()); i++) {
    const p = await petCenter()
    const hit = await ev(`(() => { const e = document.elementFromPoint(${p.x}, ${p.y}); return e?.closest('[data-companion]') ? 'pet' : (e?.tagName ?? 'none') + '.' + String(e?.className?.baseVal ?? e?.className ?? '').slice(0, 40) })()`)
    const steps = [{ type: 'mouseMoved', x: p.x, y: p.y, wait: 80 }]
    for (let j = 0; j < 12; j++) steps.push({ type: 'mouseMoved', x: p.x + (j % 2 ? 14 : -14), y: p.y, wait: 50 })
    await mouse(steps)
    await sleep(300)
    pats.push(`${await ev(`${P}.emotion.sulking?.pets ?? 'made up'`)}${hit === 'pet' ? '' : `(${hit})`}`)
    await sleep(2400) // one pat per 2.5 s
  }
  await mouse([{ type: 'mouseMoved', x: 5, y: 5 }])
  await shot('64-made-up')
  const madeUp = await view()
  check('three pats make up: the sulk ends and 被哄好了 is on its mind', !(await sulking()) && madeUp.kinds.some((k) => k.startsWith('comforted')) && pats.length >= 3, `pets ${pats.join(' → ')}; ${madeUp.kinds.join(',')}`)
  await sleep(2500)
  // Once a day at most.
  await emo(`(e.set({ mood: 10 }), e.tick(), true)`)
  check('a second sulk the same day does not happen', !(await waitUntil(sulking, 2000)))
  // The switch: off, and a fresh day's sulk does not happen either.
  await setSulkSwitch(false)
  await emo(`(e.set({ mood: 10, sulkedToday: false }), e.tick(), true)`)
  check('with 鬧彆扭 off, it does not sulk', !(await waitUntil(sulking, 2000)))
  await setSulkSwitch(true)
  await emo(`(e.set({ mood: 60, anx: 0, lone: 0, sulkedToday: false }), true)`)
  await sleep(1500)
}

try {
  await focusEmulation()
  await sleep(3000)
  // Page errors from here on: uncaught exceptions, rejected promises, and console errors / warnings.
  const hookErrors = () => ev(`(() => { window.__lc = []; addEventListener('error', e => __lc.push('error: ' + e.message)); addEventListener('unhandledrejection', e => __lc.push('rejection: ' + (e.reason?.message ?? e.reason))); for (const k of ['error', 'warn']) { const o = console[k]; console[k] = (...a) => { __lc.push(k + ': ' + a.map(String).join(' ').slice(0, 200)); o.apply(console, a) } } })()`)
  await hookErrors()
  const errors = () => ev(`__lc.filter(m => !m.includes('[terminal]'))`) // Orca's own terminal warnings are not ours
  check('the pet is on screen', await ev(`!!document.querySelector('[data-orca-themer-companion], #orca-themer-companion-${PET}') || [...__orcaThemer.companions.values()].some(p => p.root?.isConnected)`))
  await shot('00-start')
  if (!EMOTION_ONLY) await otherProject()
  if (PROJECTS_ONLY) throw SKIP_REST
  await emotionChecks()
  check('no page errors in the feelings checks', (await errors()).length === 0, (await errors()).slice(0, 3).join(' | '))
  if (EMOTION_ONLY) throw SKIP_REST
  await petFree(20000) // back home and idle before the panel checks

  // ---- picker -> 寵物設定
  await ctrlAltT()
  check('Ctrl+Alt+T opens the picker', await waitFor(`!!document.getElementById('orca-themer-picker')`, 4000))
  const hasRow = await ev(`[...document.querySelectorAll('#orca-themer-picker .otp-row')].some(b => b.textContent.includes('寵物設定'))`)
  check('the picker lists 寵物設定', hasRow)
  await shot('01-picker')
  await esc()
  await settle()
  check('Esc does not close the picker', await pickerOpen())
  await ctrlAltT()
  check('Ctrl+Alt+T again closes the picker', await waitFor(`!document.getElementById('orca-themer-picker')`, 4000))
  await openPicker()
  await esc()
  await mouse([{ type: 'mousePressed', x: 3, y: 3, button: 'left', clickCount: 1 }, { type: 'mouseReleased', x: 3, y: 3, button: 'left', clickCount: 1 }])
  check('a click on the picker scrim closes it', await waitFor(`!document.getElementById('orca-themer-picker')`, 4000))
  await openSettings()
  check('picking 寵物設定 opens the panel and closes the picker', (await settingsOpen()) && (await waitFor(`!document.getElementById('orca-themer-picker')`, 3000)))
  await shot('02-opened-from-picker')

  // ---- Esc, then the three ways to close
  await esc()
  await settle()
  check('Esc does not close the panel', await settingsOpen())
  await clickWhenThere(`document.querySelector('#oc-settings .ocs-x')`, 'the ✕ button')
  check('✕ closes the panel', await waitClosed())
  await openSettings()
  await ctrlAltT()
  check('Ctrl+Alt+T closes the panel', await waitClosed())

  // ---- right-click on the pet (home and still, so the click lands on it)
  await petFree()
  let c = await petCenter()
  await mouse([{ type: 'mouseMoved', x: c.x, y: c.y }, { type: 'mousePressed', x: c.x, y: c.y, button: 'right', buttons: 2, clickCount: 1 }, { type: 'mouseReleased', x: c.x, y: c.y, button: 'right', clickCount: 1 }])
  check('right-click on the pet opens the panel', await waitFor(SETTINGS_OPEN, 4000))
  await shot('03-right-click')
  const outside = await ev(`(() => { const r = document.querySelector('#oc-settings .ocs-panel').getBoundingClientRect(); return { x: r.left > innerWidth / 2 ? 40 : innerWidth - 40, y: innerHeight / 2 } })()`)
  const hit = await ev(`(() => { const e = document.elementFromPoint(${outside.x}, ${outside.y}); return (e?.className || e?.tagName) + ' / body pointer-events ' + getComputedStyle(document.body).pointerEvents })()`)
  await mouse([{ type: 'mousePressed', x: outside.x, y: outside.y, button: 'left', clickCount: 1 }, { type: 'mouseReleased', x: outside.x, y: outside.y, button: 'left', clickCount: 1 }])
  check('a click outside closes the panel', await waitClosed(), hit)

  // ---- every tab renders; every 試試看 plays
  await openSettings()
  const tabs = await ev(`[...document.querySelectorAll('#oc-settings .ocs-tab')].map(b => b.dataset.tab)`)
  check('the panel has tabs', tabs.length >= 5, tabs.join(','))
  const tried = []
  for (const tab of tabs) {
    if (!(await settingsOpen())) await openSettings()
    await showTab(tab)
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
      // Wait until the pet is free (a preview refuses while it is busy), then press the button. What the
      // button shows is read in the same step as the click (its handler runs inside the click), so a
      // window that runs late cannot make the 1.2-s 「playing」 mark come and go unseen.
      const btn = `document.querySelector('#oc-settings [data-row="${id}"] .ocs-try')`
      let ok = false
      let answer = null
      for (let i = 0; i < 8 && !ok; i++) {
        await petFree()
        if (!(await settingsOpen()) || !(await ev(`!!${btn}`))) (await openSettings(), await showTab(tab))
        answer = await ev(`(() => { window.__lcAnim = document.getAnimations().length; window.__lcPeak = __lcAnim; clearInterval(window.__lcPoll); window.__lcPoll = setInterval(() => { __lcPeak = Math.max(__lcPeak, document.getAnimations().length) }, 30); window.__lcMut = 0; window.__lcObs?.disconnect(); window.__lcObs = new MutationObserver(m => { for (const r of m) if (!r.target.closest?.('#oc-settings')) window.__lcMut++ }); __lcObs.observe(document.body, { childList: true, subtree: true, attributes: true }); const b = ${btn}; if (!b) return 'no button'; b.click(); const p = ${PET_EXPR}; return b.hasAttribute('data-playing') ? 'playing' : 'refused (' + p.mode + (p.busy ? ', busy' : '') + (document.hidden ? ', hidden' : '') + ')' })()`)
        ok = answer === 'playing'
        if (!ok) await sleep(1500)
      }
      // Something on the page moves or changes because of it: watched until it does (bounded), not for a
      // fixed half second (a preview that starts with a short pause was missed on a slow window).
      const SEEN = `({ anim: (__lcPeak = Math.max(__lcPeak, document.getAnimations().length)) - __lcAnim, mut: __lcMut })`
      if (ok) await waitFor(`(() => { const s = ${SEEN}; return s.anim > 0 || s.mut > 0 })()`, 3000)
      const seen = await ev(`(() => { const s = ${SEEN}; clearInterval(window.__lcPoll); return s })()`)
      tried.push({ id, ok, ...seen })
      check(`試試看 ${id} plays`, ok, `${ok ? '' : `${answer}; `}animations ${seen.anim >= 0 ? '+' : ''}${seen.anim}, page changes ${seen.mut}`)
      await sleep(900)
    }
  }
  const AUDIO = ['sound', 'chime'] // heard, not seen
  const quiet = tried.filter((t) => t.ok && !AUDIO.includes(t.id) && t.mut === 0 && t.anim <= 0).map((t) => t.id)
  check('every 試試看 visibly changes the page', quiet.length === 0, quiet.length ? `no visible change: ${quiet.join(',')}` : '')
  check('no page errors while trying every behaviour', (await errors()).length === 0, (await errors()).slice(0, 3).join(' | '))

  // ---- the pet's own row (examples/touches/puff.js)
  if (!(await settingsOpen())) await openSettings()
  await showTab('daily')
  const own = await ev(`(() => { const r = document.querySelector('#oc-settings [data-row="${OWN_ROW}"]'); return r ? { text: r.textContent, has: !!r.querySelector('.ocs-try'), freq: !!r.querySelector('.ocs-seg') } : null })()`)
  check(`the pet's own row ${OWN_ROW} is listed`, own && own.has && own.freq, own?.text.slice(0, 30))
  await shot('20-own-row')

  // ---- switching a behaviour off stops it
  // A back-and-forth over the pet, once it is home and still (a pass over where it was a moment ago misses).
  const sweep = async () => {
    await petFree()
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
    await showTab(tab)
    const sw = `document.querySelector('#oc-settings [data-row="${id}"] .ocs-switch')`
    if (!(await waitFor(`!!${sw}`, 3000))) throw new Error(`no switch for ${id}`)
    await ev(`(() => { const s = ${sw}; if ((s.getAttribute('aria-checked') === 'true') !== ${want}) s.click() })()`)
    await waitFor(`${sw}.getAttribute('aria-checked') === ${JSON.stringify(String(want))}`, 3000)
  }
  const closeByShortcut = async () => {
    if (await settingsOpen()) await ctrlAltT()
    await waitClosed()
    await sleep(300)
  }
  await closeByShortcut()
  const onCount = await sweep()
  check('with 摸摸 on, a back-and-forth over the pet reacts', onCount > 0, `${onCount} DOM changes`)
  await openSettings()
  await setSwitch('touch', 'pet', false)
  await shot('30-pet-off')
  await closeByShortcut()
  const offCount = await sweep()
  check('with 摸摸 off, the same movement barely does anything', offCount <= Math.max(2, onCount / 4), `${offCount} DOM changes against ${onCount} with it on (idle chatter allowed)`)

  // ---- persistence: settings.json, then a reload
  await openSettings()
  await showTab('daily')
  await clickWhenThere(`[...document.querySelectorAll('#oc-settings [data-row="${OWN_ROW}"] .ocs-seg button')].find(b => b.dataset.v === '2')`, `${OWN_ROW}'s frequency 2`)
  await closeByShortcut()
  const file = path.join(inst.root, 'settings.json')
  const readSaved = () => {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8')).companions?.[PET]
    } catch {
      return null
    }
  }
  let saved = readSaved()
  for (let i = 0; i < 30 && !(saved?.features?.pet === false && saved?.freq?.[OWN_ROW] === 2); i++) (await sleep(200), (saved = readSaved()))
  check('settings.json holds the changes', saved?.features?.pet === false && saved?.freq?.[OWN_ROW] === 2, JSON.stringify(saved).slice(0, 120))
  await inst.cdp('Page.reload', {})
  await sleep(2000)
  // Back when the themer has put the pet on the page again.
  await waitFor(`!!window.__orcaThemer && !!document.querySelector('.bg-worktree-sidebar') && [...(window.__orcaThemer.companions?.values() ?? [])].some(p => p.root?.isConnected)`, 30000, 300)
  await focusEmulation()
  await hookErrors()
  const after = await waitFor(`(() => { const s = __orcaThemer.state?.companions?.${PET}; return s ? JSON.stringify(s) : null })()`, 10000, 200)
  check('the state survives a reload', after && JSON.parse(after).features?.pet === false)
  await openSettings()
  await showTab('touch')
  const switchOn = await ev(`document.querySelector('#oc-settings [data-row="pet"] .ocs-switch')?.getAttribute('aria-checked') ?? null`)
  await showTab('daily')
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
