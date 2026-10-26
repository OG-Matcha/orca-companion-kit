// Builds the script injected into every Orca window: page-runtime.js, then the repo's touches, then the
// user's touches from <root>/touches. Each group is sorted by file name, so the order never depends on
// the file system. A user's touches live outside the repo, so `git pull` never touches them.
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const jsFiles = (dir) =>
  fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((name) => name.endsWith('.js'))
        .sort()
        .map((name) => path.join(dir, name))
    : []

/** Touch files in load order: repo touches first, then user touches, each sorted by name. */
export function touchFiles(repoTouchesDir, userTouchesDir) {
  return [...jsFiles(repoTouchesDir), ...jsFiles(userTouchesDir)]
}

/** Returns null when the source parses, otherwise the syntax error message. Nothing is run. */
export function syntaxError(source, filename = 'touch.js') {
  try {
    new vm.Script(source, { filename })
    return null
  } catch (error) {
    return error.message
  }
}

/**
 * Concatenates the runtime and the touches. A touch with a syntax error is left out (one broken file must
 * not take the others down, since everything runs as one script); each touch also runs inside its own
 * try block, so a runtime error at load stays local too. `skipped` lists what was left out and why.
 */
export function buildRuntimeSource({ runtimeFile, repoTouchesDir, userTouchesDir }) {
  const parts = [fs.readFileSync(runtimeFile, 'utf8')]
  const skipped = []
  const loaded = []
  for (const file of touchFiles(repoTouchesDir, userTouchesDir)) {
    const source = fs.readFileSync(file, 'utf8')
    const error = syntaxError(source, file)
    if (error) {
      skipped.push({ file, error })
      continue
    }
    loaded.push(file)
    const name = JSON.stringify(path.basename(file))
    parts.push(`try {\n${source}\n} catch (error) {\n  console.warn('[orca-themer] touch file failed', ${name}, error)\n}`)
  }
  return { source: parts.join('\n;\n'), loaded, skipped }
}
