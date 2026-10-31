import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { launchWithPipe } from '../src/cdp-pipe.mjs'

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8')

// Any flag that would open a network debugging endpoint, or bind one to every interface.
const NETWORK_DEBUG = /--remote-debugging-(port|address)|--inspect(-brk)?(=|\b)|0\.0\.0\.0/

test('launch: Orca gets the CDP pipe and no network debugging port', async () => {
  // Node stands in for Orca: it rejects the unknown flag and exits, but spawnargs shows what Orca would get.
  const { child } = launchWithPipe(process.execPath, ['--user-data-dir=fake'], { windowsHide: true })
  const exited = new Promise((resolve) => child.on('close', resolve))
  const args = child.spawnargs.slice(1)
  assert.equal(args[0], '--remote-debugging-pipe')
  assert.deepEqual(args.slice(1), ['--user-data-dir=fake'])
  for (const a of args) assert.doesNotMatch(a, NETWORK_DEBUG)
  await exited
})

test('launch: the Windows and macOS launchers never add a debugging port', () => {
  // install.ps1 (Windows) and install.sh (macOS) both run src/themer.mjs, which launches through cdp-pipe.mjs.
  for (const file of ['install.ps1', 'install.sh', 'src/themer.mjs', 'src/cdp-pipe.mjs', 'src/platform.mjs']) {
    assert.doesNotMatch(read(file), NETWORK_DEBUG, file)
  }
  assert.match(read('install.ps1'), /src\\themer\.mjs/)
  assert.match(read('install.sh'), /src\/themer\.mjs/)
  assert.match(read('src/themer.mjs'), /launchWithPipe\(ORCA_EXE, forwardedArgs/)
})
