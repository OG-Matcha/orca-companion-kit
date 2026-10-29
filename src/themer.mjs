// Orca Companion Kit launcher: starts Orca over a private CDP pipe (no network port), injects themes and
// touches (small JS effects, companions included) into every Orca window, and hot-reloads both.
// Never writes inside Orca's install, so an Orca update cannot break it.
// Usage: node src/themer.mjs [--no-restart] [extra Orca args, e.g. --user-data-dir=...]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { launchWithPipe } from './cdp-pipe.mjs'
import { composeCss, loadLibrary, publicState, companionConfig } from './themes.mjs'
import { buildRuntimeSource } from './runtime-source.mjs'
import { seedBundled } from './seed.mjs'
import { prepareFixes } from './fixes/index.mjs'
import { orcaInstall, orcaOwnedByLauncher, stopRunningOrca } from './platform.mjs'
import { checkupDue, lastCheckedVersion, pageProbeExpression, readOrcaVersion, recordChecked, summarizeCheckup } from './checkup.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..')
const ROOT = process.env.ORCA_THEMER_ROOT || path.join(os.homedir(), '.orca', 'themer')
const { app: ORCA_APP, exe: ORCA_EXE, asar: ORCA_ASAR } = orcaInstall()
const SETTINGS_FILE = path.join(ROOT, 'settings.json')
const LOG_FILE = path.join(ROOT, 'themer.log')
const USER_TOUCHES = path.join(ROOT, 'touches')

fs.mkdirSync(ROOT, { recursive: true })
const logStream = fs.createWriteStream(LOG_FILE, { flags: 'w' })
const log = (...parts) => logStream.write(`${new Date().toISOString()} ${parts.join(' ')}\n`)

// Why never crash: Orca closes itself when the CDP pipe closes, so this process must outlive any bug.
process.on('uncaughtException', (error) => log('uncaught', error?.stack ?? String(error)))
process.on('unhandledRejection', (error) => log('unhandled rejection', error?.stack ?? String(error)))

// ---------- library ----------
// The classic themes and the examples are copied into ROOT; the user's edits there are never overwritten.
function seed() {
  try {
    // Only the classic themes; `npm run example` copies the examples when you want them.
    const copied = seedBundled(ROOT, [{ from: path.join(REPO, 'themes'), kind: 'themes' }])
    if (copied.length) log('seeded', copied.join(', '))
  } catch (e) {
    log('seed failed', e.message)
  }
  for (const kind of ['themes', 'snippets', 'terminal', 'touches', 'sounds']) fs.mkdirSync(path.join(ROOT, kind), { recursive: true })
}

function readSettings() {
  const defaults = {
    themeId: null,
    enabledSnippets: [],
    enabledTouches: [],
    touchDefaultsApplied: [],
    // The terminal theme Orca had before a themer palette replaced it; restored when leaving it.
    terminalRestore: null,
    terminalAppliedFor: null,
    // The notification sound Orca had before a theme's sound replaced it.
    soundRestore: null,
    soundAppliedFor: null,
    // Optional runtime fixes (src/fixes); off unless listed here, e.g. ["claude-restart-after-switch"].
    enabledFixes: [],
    // Each pet's settings panel, by touch id: only what differs from that pet's defaults.
    companions: {}
  }
  try {
    return { ...defaults, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) }
  } catch {
    return defaults
  }
}
const saveSettings = () => fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2))

seed()
let settings = readSettings()
let library = loadLibrary(ROOT)

// A touch starts on the first time its theme is used with it; turning it off afterwards sticks.
function enableNewTouchDefaults() {
  const theme = library.themes.find((t) => t.id === settings.themeId)
  if (!theme) return
  for (const touch of theme.touches) {
    const key = `${theme.id}/${touch}`
    if (settings.touchDefaultsApplied.includes(key)) continue
    settings.touchDefaultsApplied.push(key)
    if (!settings.enabledTouches.includes(touch)) settings.enabledTouches.push(touch)
  }
}
enableNewTouchDefaults()
saveSettings()

// Repo touches first, then the user's own (~/.orca/themer/touches), each sorted by name.
let runtimeSource = ''
function rebuildRuntime() {
  const built = buildRuntimeSource({
    runtimeFile: path.join(HERE, 'page-runtime.js'),
    repoTouchesDir: path.join(HERE, 'touches'),
    userTouchesDir: USER_TOUCHES
  })
  runtimeSource = built.source
  log('touches loaded', built.loaded.map((f) => path.basename(f)).join(', '))
  for (const { file, error } of built.skipped) log('touch skipped (syntax error)', path.basename(file), error)
}
rebuildRuntime()

function payload() {
  return { css: composeCss(library, settings), state: publicState(library, settings) }
}

// Only Orca's own windows get the runtime; the in-app browser's web pages never do.
function pageScript() {
  return `if (/^file:\\/\\/\\/.*\\/out\\/renderer\\/[^/]+\\.html/i.test(location.href)) {\n${runtimeSource}\n;window.__orcaThemer?.apply(${JSON.stringify(payload())})\n}`
}

// ---------- main ----------
const forwardedArgs = process.argv.slice(2).filter((a) => !a.startsWith('--no-restart'))
// A trial run with its own --user-data-dir is a second Orca and must not close the one you are using.
const trialRun = forwardedArgs.some((a) => a.startsWith('--user-data-dir'))
// Orca allows one instance: an Orca started without the pipe has to close before this one can start.
if (!process.argv.includes('--no-restart') && !trialRun) {
  if (orcaOwnedByLauncher(ORCA_EXE)) {
    log('Orca already runs through a launcher; bringing it forward instead of restarting it')
    execFile('open', ['-a', ORCA_APP], () => process.exit(0))
    await new Promise(() => {}) // the callback above exits
  }
  stopRunningOrca(ORCA_EXE, log)
}
// Enabled fixes that did not apply to this Orca build, for the update checkup.
const fixWarnings = []
const patchedAssets = await prepareFixes(ORCA_ASAR, settings.enabledFixes ?? [], log, fixWarnings)

// ---------- update checkup ----------
// Once per Orca version: do the fixes, the DOM hooks themes style and the touches still work? Silent
// when they do; one notice in Orca when not, with the details in themer.log.
const CHECKUP_FILE = path.join(ROOT, 'orca-version.json')
const asarModule = (await import('@electron/asar').catch(() => null))?.default
const orcaVersion = readOrcaVersion(asarModule, ORCA_ASAR)
let checkupPending = checkupDue(lastCheckedVersion(CHECKUP_FILE), orcaVersion)
let runtimeError = null // the first error the injected runtime threw, for the checkup
log(`Orca ${orcaVersion ?? '(version unknown)'}${checkupPending ? ': new version, checkup after the window loads' : ''}`)

async function runCheckup() {
  if (!checkupPending) return
  const sessionId = await mainWindowSession()
  if (!sessionId) return
  checkupPending = false
  const r = await cdp
    .send('Runtime.evaluate', { expression: pageProbeExpression(), awaitPromise: true, returnByValue: true }, sessionId)
    .catch((e) => ({ error: e.message }))
  const probe = r?.result?.value
  const summary = summarizeCheckup({
    version: orcaVersion,
    fixWarnings,
    hooks: probe?.hooks ?? null,
    touchErrors: probe?.touchErrors ?? [],
    runtimeError
  })
  for (const line of summary.details) log(line)
  if (summary.notice) {
    await cdp
      .send('Runtime.evaluate', { expression: `window.__orcaThemer?.checkupNotice(${JSON.stringify(summary.notice)})` }, sessionId)
      .catch((e) => log('checkup notice failed', e.message))
  }
  recordChecked(CHECKUP_FILE, orcaVersion, summary.ok)
}

const { child, cdp } = launchWithPipe(ORCA_EXE, forwardedArgs, { detached: false })
log('launched Orca pid', child.pid)

// Orca's updater points the shortcuts back at Orca.exe, which would start it without the theme next time.
// Skipped for test runs (a separate --user-data-dir, or ORCA_COMPANION_NO_SHORTCUTS=1) and before install.ps1
// has made the launcher, so a trial run never rewrites anyone's shortcuts. Windows only: on macOS the
// launcher is its own app (install.sh), which Orca's updater never touches.
const manageShortcuts =
  process.platform === 'win32' &&
  process.env.ORCA_COMPANION_NO_SHORTCUTS !== '1' &&
  !trialRun &&
  fs.existsSync(path.join(REPO, 'Orca Companion.vbs'))
function retargetShortcuts() {
  if (!manageShortcuts) return Promise.resolve()
  return new Promise((resolve) =>
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(HERE, 'shortcuts.ps1')], { encoding: 'utf8', windowsHide: true, timeout: 20000 }, (error, out) => {
      if (error) log('shortcuts failed', error.message)
      else if (out.trim()) log('shortcuts', out.trim())
      resolve()
    })
  )
}
setTimeout(retargetShortcuts, 5000)

child.on('exit', (code) => {
  log('Orca exited', code)
  // The dev channel belongs to this Orca; a launcher still waiting must not answer for the next one.
  clearInterval(devTimer)
  if (!manageShortcuts) process.exit(0)
  // An update installs while Orca is closed: keep checking for a few minutes so the next launch is themed.
  const until = Date.now() + 180000
  const again = async () => {
    await retargetShortcuts()
    if (Date.now() < until) setTimeout(again, 20000)
    else process.exit(0)
  }
  again()
})
cdp.on('close', () => log('CDP pipe closed'))

const sessions = new Map() // sessionId -> { scriptId }

async function installInto(sessionId) {
  const entry = sessions.get(sessionId)
  if (!entry) return
  const { identifier } = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: pageScript() }, sessionId)
  if (entry.scriptId) await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: entry.scriptId }, sessionId).catch(() => {})
  entry.scriptId = identifier
}

async function broadcast() {
  const data = JSON.stringify(payload())
  for (const sessionId of sessions.keys()) {
    await installInto(sessionId).catch((e) => log('reinstall failed', e.message))
    await cdp
      .send('Runtime.evaluate', { expression: `window.__orcaThemer?.apply(${data})` }, sessionId)
      .catch((e) => log('apply failed', e.message))
  }
}

// ---------- terminal palette sync ----------
// Writes through Orca's own settings API (the one its "Import" button uses) in the main window.
const THEMER_TERMINAL_PREFIX = 'manual:orca-themer-'

async function mainWindowSession() {
  for (const sessionId of sessions.keys()) {
    const info = await cdp.send('Target.getTargetInfo', {}, sessionId).catch(() => null)
    if (/\/out\/renderer\/index\.html/i.test(info?.targetInfo?.url ?? '')) return sessionId
  }
  return null
}

async function syncTerminal() {
  const sessionId = await mainWindowSession()
  if (!sessionId) return
  const theme = library.themes.find((t) => t.id === settings.themeId)
  const want = theme?.terminal ? { id: `${THEMER_TERMINAL_PREFIX}${theme.id}`, name: `${theme.name}（Orca Companion Kit）`, terminal: theme.terminal } : null
  // Keyed by palette content too, so editing a theme's terminal colors re-applies them.
  const appliedKey = want ? `${theme.id}:${createHash('sha1').update(JSON.stringify(theme.terminal)).digest('hex').slice(0, 10)}` : null
  if (!want && !settings.terminalAppliedFor) return
  if (want && settings.terminalAppliedFor === appliedKey) return
  const args = JSON.stringify({ want, restore: settings.terminalRestore, prefix: THEMER_TERMINAL_PREFIX })
  const expression = `(async (a) => {
    const api = window.api?.settings
    if (!api) return { ok: false, reason: 'no settings api' }
    const s = await api.get()
    const current = s.terminalThemeDark
    const ours = typeof current === 'string' && current.startsWith('custom:' + a.prefix)
    if (!a.want) {
      if (!ours) return { ok: true, patch: null }
      const patch = { terminalThemeDark: a.restore ?? 'Ghostty Default Style Dark' }
      await api.set(patch)
      return { ok: true, patch }
    }
    const themes = (s.terminalCustomThemes ?? []).filter((t) => t.id !== a.want.id)
    themes.push({ id: a.want.id, name: a.want.name, source: 'manual', mode: 'dark', terminal: a.want.terminal, importedAt: new Date().toISOString(), sourceLabel: 'Orca Companion Kit' })
    const patch = { terminalCustomThemes: themes, terminalThemeDark: 'custom:' + a.want.id }
    await api.set(patch)
    return { ok: true, previous: ours ? null : current, patch }
  })(${args})`
  const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId).catch((e) => ({ error: e.message }))
  const value = r?.result?.value
  log('terminal sync', JSON.stringify(value ? { ...value, patch: value.patch && Object.keys(value.patch) } : r?.exceptionDetails?.exception?.description ?? r?.error))
  if (!value?.ok) return
  if (want) {
    if (value.previous) settings.terminalRestore = value.previous
    settings.terminalAppliedFor = appliedKey
  } else {
    settings.terminalAppliedFor = null
  }
  saveSettings()
  if (!value.patch) return
  // Orca tells every window about a settings change except the one that wrote it, so this window would
  // keep its old terminal colors. Hand it the same "settings changed" message Orca sends the others:
  // the terminals recolor in place, and nothing a reload resets (sidebar groups, open menus) is lost.
  if (await announceSettingsChange(sessionId, value.patch)) return log('terminal palette applied in place')
  // Fallback when that hook is gone in a new Orca: Orca's own View → Reload (terminals reattach to the
  // daemon). Say so first; Chromium keeps showing the last frame until the reloaded page paints.
  await cdp
    .send('Runtime.evaluate', { expression: `window.__orcaThemer?.beforeReload?.(${JSON.stringify('換上終端機配色，視窗重新整理一下…')})`, awaitPromise: true }, sessionId)
    .catch(() => {})
  await cdp.send('Page.reload', {}, sessionId).catch((e) => log('reload failed', e.message))
  log('reloaded main window to pick up the terminal palette')
}

// Electron's preload world of each Orca window, where Orca's ipcRenderer lives (sessionId -> contextId),
// and the ipcRenderer found there (sessionId -> Promise<objectId | null>), looked up once per page load.
const preloadContexts = new Map()
const ipcHandles = new Map()

// Finding it walks every object in the preload world (~1–3 s), so the picker warms it up when it opens.
function findOrcaIpc(sessionId) {
  const contextId = preloadContexts.get(sessionId)
  if (!contextId) return Promise.resolve(null)
  if (ipcHandles.has(sessionId)) return ipcHandles.get(sessionId)
  const lookup = (async () => {
    const group = `orca-themer-ipc-${contextId}`
    try {
      const proto = await cdp.send('Runtime.evaluate', { expression: 'Object.prototype', contextId, objectGroup: group }, sessionId)
      if (!proto.result?.objectId) return null
      const { objects } = await cdp.send('Runtime.queryObjects', { prototypeObjectId: proto.result.objectId, objectGroup: group }, sessionId)
      const found = await cdp.send(
        'Runtime.callFunctionOn',
        {
          objectId: objects.objectId,
          objectGroup: group,
          // Electron keeps an internal ipc emitter of the same shape; only Orca's listens for settings changes.
          functionDeclaration: `function () {
            return this.find((o) => {
              try {
                return typeof o.invoke === 'function' && typeof o.emit === 'function' && typeof o.listeners === 'function' && o.listeners('settings:changed').length > 0
              } catch {
                return false
              }
            }) ?? null
          }`
        },
        sessionId
      )
      await cdp.send('Runtime.releaseObject', { objectId: objects.objectId }, sessionId).catch(() => {})
      return found.result?.objectId ?? null
    } catch (e) {
      log('looking up Orca ipc failed', e.message)
      return null
    }
  })()
  ipcHandles.set(sessionId, lookup)
  return lookup
}

function forgetPreloadContext(sessionId) {
  preloadContexts.delete(sessionId)
  ipcHandles.delete(sessionId)
}

// Emits Orca's own `settings:changed` IPC event inside one window, exactly what main sends the other
// windows. Returns false when this Orca build has no such listener, so the caller can fall back.
async function announceSettingsChange(sessionId, patch) {
  const ipcId = await findOrcaIpc(sessionId)
  if (!ipcId) return false
  const r = await cdp
    .send(
      'Runtime.callFunctionOn',
      {
        objectId: ipcId,
        functionDeclaration: `function (patch) { this.emit('settings:changed', { sender: this }, patch); return true }`,
        arguments: [{ value: patch }],
        returnByValue: true
      },
      sessionId
    )
    .catch((e) => ({ error: e.message }))
  if (r.result?.value !== true) log('announce settings change failed', JSON.stringify(r.exceptionDetails?.exception?.description ?? r.error))
  return r.result?.value === true
}

// ---------- notification sound sync ----------
// Native notifications are drawn by Windows, so the sound is the one part a theme can own.
// Main reads notification settings at dispatch time, so no reload is needed.
async function syncSound() {
  const sessionId = await mainWindowSession()
  if (!sessionId) return
  const theme = library.themes.find((t) => t.id === settings.themeId)
  const file = theme ? path.join(ROOT, 'sounds', `${theme.id}.wav`) : null
  const want = theme?.touches.includes('theme-sound') && settings.enabledTouches.includes('theme-sound') && fs.existsSync(file) ? file : null
  // Re-checked even when already applied: the volume may have been muted since.
  if (!want && !settings.soundAppliedFor) return
  const args = JSON.stringify({ want, restore: settings.soundRestore, ours: settings.soundAppliedFor })
  const expression = `(async (a) => {
    const api = window.api?.settings
    if (!api) return { ok: false, reason: 'no settings api' }
    const n = (await api.get()).notifications ?? {}
    const previous = {
      customSoundId: n.customSoundId ?? null,
      customSoundPath: n.customSoundPath ?? null,
      customSoundVolume: n.customSoundVolume ?? null
    }
    // Already applied but the user picked another sound in Orca since: theirs wins.
    if (a.want && a.ours === a.want && n.customSoundPath !== a.want) return { ok: false, reason: 'user picked another sound' }
    if (a.want) {
      // A muted volume (0) would make the theme bell silent; unmute it, and restore puts 0 back.
      const volume = n.customSoundVolume === 0 ? 70 : n.customSoundVolume
      await api.set({ notifications: { ...n, customSoundId: 'custom', customSoundPath: a.want, customSoundVolume: volume } })
      return { ok: true, previous: n.customSoundPath === a.ours ? null : previous, wasMuted: n.customSoundVolume === 0 }
    }
    // Restore only if the sound is still ours; a sound the user picked meanwhile stays.
    if (n.customSoundPath === a.ours && a.restore) await api.set({ notifications: { ...n, ...a.restore } })
    return { ok: true }
  })(${args})`
  const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId).catch((e) => ({ error: e.message }))
  const value = r?.result?.value
  log('sound sync', JSON.stringify(value ?? r?.exceptionDetails?.exception?.description ?? r?.error))
  if (!value?.ok) return
  if (want && value.previous) settings.soundRestore = value.previous
  if (want && value.wasMuted && settings.soundRestore && !('customSoundVolume' in settings.soundRestore))
    settings.soundRestore.customSoundVolume = 0
  settings.soundAppliedFor = want
  saveSettings()
}

cdp.on('Target.attachedToTarget', async ({ sessionId, targetInfo }) => {
  if (targetInfo.type !== 'page') {
    await cdp.send('Runtime.runIfWaitingForDebugger', {}, sessionId).catch(() => {})
    return
  }
  const entry = { scriptId: null }
  sessions.set(sessionId, entry)
  // Why not awaited one by one: a paused target answers some commands only after it resumes.
  // CDP handles them in order, so everything below is registered before the page runs.
  const steps = [
    cdp.send('Runtime.addBinding', { name: 'orcaThemerSend' }, sessionId),
    patchedAssets.size
      ? cdp.send('Fetch.enable', { patterns: [...patchedAssets.keys()].map((name) => ({ urlPattern: `*/out/renderer/assets/${name}` })) }, sessionId)
      : null,
    cdp
      .send('Page.addScriptToEvaluateOnNewDocument', { source: pageScript() }, sessionId)
      .then(({ identifier }) => (entry.scriptId = identifier)),
    // Context events cover a document that was already navigating when we attached.
    cdp.send('Runtime.enable', {}, sessionId)
  ].filter(Boolean)
  const resumed = cdp.send('Runtime.runIfWaitingForDebugger', {}, sessionId).catch(() => {})
  try {
    await Promise.all([...steps, resumed])
    log('attached', targetInfo.url || '(loading)')
    // Once Orca's settings API is up, bring the terminal palette in line with the saved theme.
    setTimeout(async () => {
      await syncSound().catch((e) => log('sound sync failed', e.message))
      await syncTerminal().catch((e) => log('terminal sync failed', e.message))
      await runCheckup().catch((e) => log('checkup failed', e.message))
    }, 4000)
  } catch (e) {
    log('attach setup failed', e.message)
  }
})

cdp.on('Target.detachedFromTarget', ({ sessionId }) => {
  sessions.delete(sessionId)
  forgetPreloadContext(sessionId)
})
cdp.on('Runtime.executionContextDestroyed', ({ executionContextId }, sessionId) => {
  if (preloadContexts.get(sessionId) === executionContextId) forgetPreloadContext(sessionId)
})
cdp.on('Runtime.executionContextsCleared', (_, sessionId) => forgetPreloadContext(sessionId))

// Every new main-world context of an Orca window gets the runtime; the runtime ignores a second copy.
cdp.on('Runtime.executionContextCreated', ({ context }, sessionId) => {
  if (!sessions.has(sessionId) || !String(context.origin).startsWith('file://')) return
  if (!context.auxData?.isDefault) {
    // Electron's preload world; announceSettingsChange() reaches Orca's ipcRenderer through it.
    if (context.auxData?.type === 'isolated' && /electron/i.test(context.name ?? '')) {
      forgetPreloadContext(sessionId)
      preloadContexts.set(sessionId, context.id)
    }
    return
  }
  cdp
    .send('Runtime.evaluate', { expression: pageScript(), contextId: context.id }, sessionId)
    .then((r) => {
      const error = r.exceptionDetails ? r.exceptionDetails.exception?.description ?? r.exceptionDetails.text ?? 'error' : null
      if (error) runtimeError ??= error.slice(0, 500)
      log('runtime evaluated', error ? `error: ${error.slice(0, 200)}` : 'ok')
    })
    .catch((e) => log('runtime evaluate failed', e.message))
})

// Serves the patched copy of a renderer script an enabled fix asked for; everything else passes through.
cdp.on('Fetch.requestPaused', async ({ requestId, request }, sessionId) => {
  const name = request.url.split(/[?#]/)[0].split('/').pop()
  const body = patchedAssets.get(name)
  try {
    if (body && request.url.startsWith('file:///')) {
      await cdp.send(
        'Fetch.fulfillRequest',
        {
          requestId,
          responseCode: 200,
          responseHeaders: [{ name: 'Content-Type', value: 'text/javascript; charset=utf-8' }],
          body: Buffer.from(body, 'utf8').toString('base64')
        },
        sessionId
      )
      log('served patched', name)
    } else {
      await cdp.send('Fetch.continueRequest', { requestId }, sessionId)
    }
  } catch (e) {
    log('fetch handling failed', e.message)
    await cdp.send('Fetch.continueRequest', { requestId }, sessionId).catch(() => {})
  }
})

cdp.on('Runtime.bindingCalled', async ({ name, payload: raw }, sessionId) => {
  if (name !== 'orcaThemerSend') return
  // Why the URL check: the in-app browser's web pages share the binding but must not drive the themer.
  const info = await cdp.send('Target.getTargetInfo', {}, sessionId).catch(() => null)
  if (!/^file:\/\/\/.*\/out\/renderer\//i.test(info?.targetInfo?.url ?? '')) return
  let message
  try {
    message = JSON.parse(raw)
  } catch {
    return
  }
  if (message.type === 'log') return log('page', String(message.message).slice(0, 300))
  // The picker opened: find Orca's ipc now, so picking a theme recolors the terminal without waiting.
  if (message.type === 'picker-open') return void findOrcaIpc(sessionId)
  if (message.type === 'select-theme') {
    const theme = library.themes.find((t) => t.id === message.id) ?? null
    settings.themeId = theme?.id ?? null
    enableNewTouchDefaults()
  } else if (message.type === 'toggle-snippet' && library.snippets.some((s) => s.id === message.id)) {
    const on = settings.enabledSnippets.includes(message.id)
    settings.enabledSnippets = on ? settings.enabledSnippets.filter((id) => id !== message.id) : [...settings.enabledSnippets, message.id]
  } else if (message.type === 'toggle-touch' && typeof message.id === 'string') {
    const on = settings.enabledTouches.includes(message.id)
    settings.enabledTouches = on ? settings.enabledTouches.filter((id) => id !== message.id) : [...settings.enabledTouches, message.id]
  } else if (message.type === 'companion-config') {
    // A pet's settings panel: what differs from its defaults (the page normalizes it again on read).
    const config = companionConfig(message.id, message.config)
    if (!config) return log('companion-config rejected')
    settings.companions = { ...settings.companions, [message.id]: config }
  } else {
    return
  }
  saveSettings()
  log('settings', JSON.stringify({ themeId: settings.themeId, snippets: settings.enabledSnippets, touches: settings.enabledTouches }))
  await broadcast()
  if (message.type === 'select-theme') await syncTerminal()
  if (message.type === 'select-theme' || message.id === 'theme-sound') await syncSound()
})

// Hot reload: a save in themes/, snippets/ or terminal/ re-reads the library and re-applies everywhere.
// A save in touches/ rebuilds the injected script and runs it again in every window; the runtime
// ignores its own second copy, and each touch that registers again replaces its running version.
let reloadTimer = null
let touchesChanged = false
for (const kind of ['themes', 'snippets', 'terminal', 'touches']) {
  const watcher = fs.watch(path.join(ROOT, kind), () => {
    if (kind === 'touches') touchesChanged = true
    clearTimeout(reloadTimer)
    reloadTimer = setTimeout(async () => {
      try {
        library = loadLibrary(ROOT)
        log('library reloaded', library.themes.length, 'themes', library.snippets.length, 'snippets')
        if (touchesChanged) {
          touchesChanged = false
          rebuildRuntime()
          for (const sessionId of sessions.keys())
            await cdp.send('Runtime.evaluate', { expression: pageScript() }, sessionId).catch((e) => log('touch reload failed', e.message))
        }
        await broadcast()
        await syncTerminal()
      } catch (e) {
        log('reload failed', e.message)
      }
    }, 150)
  })
  watcher.on('error', (e) => log('watch error', kind, e.message))
}

let devTimer = null
// Dev-only control for automated checks: drop {cmd,...}.json into ROOT/dev; the result lands beside it.
if (process.env.ORCA_THEMER_DEV === '1') {
  const devDir = path.join(ROOT, 'dev')
  fs.mkdirSync(devDir, { recursive: true })
  let screencast = null // the open-ended recording, when one runs (screencast-start)
  const mainSession = async () => {
    const seen = []
    for (const sessionId of sessions.keys()) {
      const info = await cdp.send('Target.getTargetInfo', {}, sessionId).catch((e) => ({ error: e.message }))
      seen.push(info?.targetInfo?.url ?? info?.error)
      if (/\/out\/renderer\/index\.html/i.test(info?.targetInfo?.url ?? '')) return sessionId
    }
    log('dev: no main window among', JSON.stringify(seen))
    return null
  }
  devTimer = setInterval(async () => {
    for (const name of fs.readdirSync(devDir).filter((n) => n.endsWith('.cmd.json'))) {
      const file = path.join(devDir, name)
      const out = file.replace(/\.cmd\.json$/, '.result.json')
      // A long command (cdp-seq, trace) overlaps the next tick: the file is taken before it is parsed, so
      // a tick that finds it already gone moves on instead of answering with an error.
      let text
      try {
        text = fs.readFileSync(file, 'utf8')
        fs.unlinkSync(file)
      } catch {
        continue
      }
      let result
      try {
        const command = JSON.parse(text)
        const sessionId = await mainSession()
        if (!sessionId) throw new Error('main window not attached')
        if (command.cmd === 'screenshot') {
          const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId)
          fs.writeFileSync(command.out, Buffer.from(data, 'base64'))
          result = { ok: true, out: command.out }
        } else if (command.cmd === 'eval') {
          const r = await cdp.send('Runtime.evaluate', { expression: command.expr, returnByValue: true, awaitPromise: true }, sessionId)
          result = { ok: !r.exceptionDetails, value: r.result?.value, error: r.exceptionDetails?.exception?.description }
        } else if (command.cmd === 'screencast') {
          // Records the page (not the window frame) for docs: JPEG frames plus their timestamps.
          fs.mkdirSync(command.dir, { recursive: true })
          const frames = []
          const onFrame = (params, sid) => {
            if (sid !== sessionId) return
            const name = `f${String(frames.length).padStart(5, '0')}.jpg`
            fs.writeFileSync(path.join(command.dir, name), Buffer.from(params.data, 'base64'))
            frames.push({ name, t: params.metadata.timestamp })
            cdp.send('Page.screencastFrameAck', { sessionId: params.sessionId }, sessionId).catch(() => {})
          }
          cdp.on('Page.screencastFrame', onFrame)
          await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: command.maxWidth ?? 1920, maxHeight: command.maxHeight ?? 1200, everyNthFrame: 1 }, sessionId)
          await new Promise((r) => setTimeout(r, command.ms ?? 5000))
          await cdp.send('Page.stopScreencast', {}, sessionId)
          cdp.off('Page.screencastFrame', onFrame)
          fs.writeFileSync(path.join(command.dir, 'frames.json'), JSON.stringify(frames))
          result = { ok: true, frames: frames.length }
        } else if (command.cmd === 'mouse') {
          // Real (trusted) pointer input, for checks and docs footage: [{ type, x, y, button?, buttons?, clickCount?, wait? }]
          for (const { wait = 0, ...event } of command.events) {
            await cdp.send('Input.dispatchMouseEvent', { button: 'none', ...event }, sessionId)
            if (wait) await new Promise((r) => setTimeout(r, wait))
          }
          result = { ok: true }
        } else if (command.cmd === 'key') {
          for (const type of ['keyDown', 'keyUp'])
            await cdp.send('Input.dispatchKeyEvent', { type, ...command.event }, sessionId)
          result = { ok: true }
        } else if (command.cmd === 'cdp') {
          // Raw CDP call on the main window (or the browser when browser:true), for perf runs and scripted demos.
          const value = await cdp.send(command.method, command.params ?? {}, command.browser ? undefined : sessionId)
          result = { ok: true, value }
        } else if (command.cmd === 'cdp-seq') {
          // Timed steps [{method, params, wait}] run back to back, so typing and drags play smoothly.
          for (const step of command.steps) {
            if (step.method) await cdp.send(step.method, step.params ?? {}, sessionId)
            if (step.wait) await new Promise((r) => setTimeout(r, step.wait))
          }
          result = { ok: true }
        } else if (command.cmd === 'trace') {
          // A Chromium trace of the browser for command.ms (perf work: why an animation is not composited,
          // what a long task did); events land in command.out as a JSON array.
          const events = []
          const onData = ({ value }) => events.push(...value)
          cdp.on('Tracing.dataCollected', onData)
          const done = new Promise((resolve) => cdp.once('Tracing.tracingComplete', resolve))
          await cdp.send('Tracing.start', { traceConfig: { includedCategories: command.categories ?? ['devtools.timeline', 'blink.animations', 'cc', 'disabled-by-default-devtools.timeline'] }, transferMode: 'ReportEvents' })
          await new Promise((r) => setTimeout(r, command.ms ?? 5000))
          await cdp.send('Tracing.end')
          await done
          cdp.off('Tracing.dataCollected', onData)
          fs.writeFileSync(command.out, JSON.stringify(events))
          result = { ok: true, events: events.length }
        } else if (command.cmd === 'screencast-start') {
          // Open-ended recording: frames land in command.dir as <n>.jpg with a frames.txt of capture timestamps (s).
          fs.mkdirSync(command.dir, { recursive: true })
          screencast?.stop()
          let n = 0
          const index = fs.openSync(path.join(command.dir, 'frames.txt'), 'w')
          const onFrame = (params, frameSession) => {
            if (frameSession !== sessionId) return
            const name = `${String(n++).padStart(6, '0')}.jpg`
            fs.writeFileSync(path.join(command.dir, name), Buffer.from(params.data, 'base64'))
            fs.writeSync(index, `${name} ${params.metadata.timestamp}\n`)
            cdp.send('Page.screencastFrameAck', { sessionId: params.sessionId }, sessionId).catch(() => {})
          }
          cdp.on('Page.screencastFrame', onFrame)
          await cdp.send('Page.startScreencast', { format: 'jpeg', quality: command.quality ?? 92, everyNthFrame: 1 }, sessionId)
          screencast = {
            stop: () => {
              cdp.off('Page.screencastFrame', onFrame)
              cdp.send('Page.stopScreencast', {}, sessionId).catch(() => {})
              fs.closeSync(index)
              screencast = null
              return n
            }
          }
          result = { ok: true }
        } else if (command.cmd === 'screencast-stop') {
          result = { ok: true, frames: screencast ? screencast.stop() : 0 }
        } else {
          result = { ok: false, error: 'unknown cmd' }
        }
      } catch (e) {
        result = { ok: false, error: e.message }
      }
      fs.writeFileSync(out, JSON.stringify(result))
    }
  }, 250)
}

try {
  await cdp.send('Target.setDiscoverTargets', { discover: true })
  await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true })
  log('ready; themes', library.themes.length, 'snippets', library.snippets.length, 'fixes', patchedAssets.size)
} catch (e) {
  log('CDP setup failed', e.message)
}
