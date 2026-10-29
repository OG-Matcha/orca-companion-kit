import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { mainProcessesFromPs, orcaInstall } from '../src/platform.mjs'

const EXE = '/Applications/Orca.app/Contents/MacOS/Orca'

test('platform: macOS finds Orca in /Applications, then ~/Applications; ORCA_APP wins', () => {
  const home = '/Users/you'
  const at = (...apps) => (p) => apps.includes(p)
  const system = orcaInstall({ platform: 'darwin', env: {}, home, exists: at('/Applications/Orca.app') })
  assert.equal(system.exe, EXE)
  assert.equal(system.asar, '/Applications/Orca.app/Contents/Resources/app.asar')
  const user = orcaInstall({ platform: 'darwin', env: {}, home, exists: at('/Users/you/Applications/Orca.app') })
  assert.equal(user.app, '/Users/you/Applications/Orca.app')
  const custom = orcaInstall({ platform: 'darwin', env: { ORCA_APP: '/opt/Orca.app' }, home, exists: at('/Applications/Orca.app') })
  assert.equal(custom.exe, '/opt/Orca.app/Contents/MacOS/Orca')
})

test('platform: Windows keeps the per-user install, ORCA_DIR overrides', () => {
  const win = orcaInstall({ platform: 'win32', env: { LOCALAPPDATA: 'L' } })
  assert.equal(win.exe, path.win32.join('L', 'Programs', 'orca', 'Orca.exe'))
  assert.equal(win.asar, path.win32.join('L', 'Programs', 'orca', 'resources', 'app.asar'))
  assert.equal(orcaInstall({ platform: 'win32', env: { ORCA_DIR: 'D' } }).exe, path.win32.join('D', 'Orca.exe'))
})

test('platform: only the main Orca counts; helpers, asar scripts and trial runs do not', () => {
  // Shaped like real `ps -axo pid=,command=` output on macOS.
  const ps = [
    `  501 ${EXE}`,
    `  502 /Applications/Orca.app/Contents/Frameworks/Orca Helper.app/Contents/MacOS/Orca Helper --type=gpu-process`,
    `  503 /Applications/Orca.app/Contents/Frameworks/Orca Helper (Renderer).app/Contents/MacOS/Orca Helper (Renderer) --type=renderer`,
    `  504 /Applications/Orca.app/Contents/Frameworks/Orca Helper.app/Contents/MacOS/Orca Helper /Applications/Orca.app/Contents/Resources/app.asar.unpacked/out/main/x.js`,
    `  505 ${EXE} --remote-debugging-pipe --user-data-dir=/tmp/orca-trial`,
    `  506 ${EXE}Other`,
    `  507 /Users/you/Library/Application Support/orca/daemon-host/macos/terminal-host-1/app.noindex/Orca Terminal Host.app/Contents/MacOS/orca-terminal-host`,
    ''
  ].join('\n')
  assert.deepEqual(mainProcessesFromPs(ps, EXE), [{ pid: 501, piped: false }])
})

test('platform: an Orca started over a pipe is marked as owned by a launcher', () => {
  assert.deepEqual(mainProcessesFromPs(`77 ${EXE} --remote-debugging-pipe\n`, EXE), [{ pid: 77, piped: true }])
  assert.deepEqual(mainProcessesFromPs(`78 ${EXE} --remote-debugging-pipes\n`, EXE), [{ pid: 78, piped: false }])
})
