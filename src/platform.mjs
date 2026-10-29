// Where Orca is installed and how to find and stop its main process, per OS.
// Windows: the per-user install in %LOCALAPPDATA%\Programs\orca (ORCA_DIR overrides).
// macOS: /Applications/Orca.app, then ~/Applications/Orca.app (ORCA_APP overrides).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

/** Orca's executable and its app.asar on this OS (and the .app bundle on macOS). */
export function orcaInstall({ platform = process.platform, env = process.env, home = os.homedir(), exists = fs.existsSync } = {}) {
  // Each OS's own path rules, so the answer does not depend on the OS the tests run on.
  if (platform === 'darwin') {
    const p = path.posix
    const candidates = env.ORCA_APP ? [env.ORCA_APP] : ['/Applications/Orca.app', p.join(home, 'Applications', 'Orca.app')]
    const app = candidates.find((c) => exists(c)) ?? candidates[0]
    return { app, exe: p.join(app, 'Contents', 'MacOS', 'Orca'), asar: p.join(app, 'Contents', 'Resources', 'app.asar') }
  }
  const w = path.win32
  const dir = env.ORCA_DIR || w.join(env.LOCALAPPDATA ?? '', 'Programs', 'orca')
  return { exe: w.join(dir, 'Orca.exe'), asar: w.join(dir, 'resources', 'app.asar') }
}

/**
 * The main Orca processes in `ps -axo pid=,command=` output. Helpers (--type=), scripts Orca runs from its
 * app.asar, and runs with their own --user-data-dir (a trial, a recording) are left out, as on Windows.
 */
export function mainProcessesFromPs(out, exe) {
  const found = []
  for (const line of out.split('\n')) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(line)
    if (!m) continue
    const command = m[2].trimEnd()
    if (command !== exe && !command.startsWith(`${exe} `)) continue
    if (/--type=|app\.asar|--user-data-dir/.test(command)) continue
    found.push({ pid: Number(m[1]), piped: /(^| )--remote-debugging-pipe( |$)/.test(command) })
  }
  return found
}

const macMainProcesses = (exe) => mainProcessesFromPs(execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }), exe)

/**
 * macOS: the main Orca already runs over a pipe, so a launcher owns it (this kit's, or another tool's).
 * Clicking the app again in the Dock must bring that Orca forward, not restart it and its agents.
 */
export function orcaOwnedByLauncher(exe) {
  return process.platform === 'darwin' && macMainProcesses(exe).some((p) => p.piped)
}

export function runningOrcaMainPids(exe) {
  if (process.platform === 'darwin') return macMainProcesses(exe).map((p) => p.pid)
  const script = `Get-CimInstance Win32_Process -Filter "Name='Orca.exe'" | Where-Object { $_.ExecutablePath -eq '${exe.replace(/'/g, "''")}' -and $_.CommandLine -notmatch '--type=' -and $_.CommandLine -notmatch 'app\\.asar' -and $_.CommandLine -notmatch '--user-data-dir' } | ForEach-Object { $_.ProcessId }`
  const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8' })
  return out.split(/\s+/).filter(Boolean).map(Number)
}

// Windows: the main's own Orca.exe children (renderer, GPU, utility), but not its terminal host
// (`daemon-entry`): that one keeps the agents and shells running across the restart.
function windowsHelperPids(exe, mainPid) {
  const script = `Get-CimInstance Win32_Process -Filter "Name='Orca.exe' and ParentProcessId=${Number(mainPid)}" | Where-Object { $_.ExecutablePath -eq '${exe.replace(/'/g, "''")}' -and $_.CommandLine -notmatch 'daemon-entry' } | ForEach-Object { $_.ProcessId }`
  const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8' })
  return out.split(/\s+/).filter(Boolean).map(Number)
}

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

/** Stops the Orca that runs without the pipe, so this one can start (Orca allows one instance). */
export function stopRunningOrca(exe, log = () => {}) {
  const pids = runningOrcaMainPids(exe)
  for (const pid of pids) {
    log('stopping running Orca main', pid)
    try {
      // macOS: SIGTERM lets Orca quit as it does on Cmd+Q; its terminal host is a separate process and stays.
      // Windows: no tree kill (/T), which would also end the terminal host and every session in it.
      if (process.platform === 'darwin') process.kill(pid, 'SIGTERM')
      else
        for (const p of [pid, ...windowsHelperPids(exe, pid)]) {
          try {
            execFileSync('taskkill.exe', ['/PID', String(p), '/F'], { stdio: 'ignore' })
          } catch {}
        }
    } catch {}
  }
  if (!pids.length) return
  const until = Date.now() + 15000
  while (runningOrcaMainPids(exe).length && Date.now() < until) sleepSync(300)
  if (process.platform !== 'darwin') return
  for (const pid of runningOrcaMainPids(exe)) {
    log('Orca did not quit within 15 s, killing', pid)
    try {
      process.kill(pid, 'SIGKILL')
    } catch {}
  }
}
