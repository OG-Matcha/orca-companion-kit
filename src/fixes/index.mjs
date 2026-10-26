// Optional runtime fixes: patched copies of Orca's own renderer scripts, served through CDP Fetch when
// Orca loads them. Nothing on disk changes. Each fix matches one exact code shape and returns null when
// a build does not contain it, so an Orca update turns a fix off instead of breaking Orca.
// Off by default; settings.json "enabledFixes": ["claude-restart-after-switch"] turns one on.
import fs from 'node:fs'
import path from 'node:path'
import { claudeRestartFix } from './claude-restart.mjs'

export const FIXES = [claudeRestartFix]

/** Returns Map(asset file name -> patched source) for the enabled fixes that match this Orca build. */
export async function prepareFixes(orcaDir, enabledIds, log = () => {}) {
  const served = new Map()
  const wanted = FIXES.filter((fix) => enabledIds.includes(fix.id))
  if (!wanted.length) return served
  const asarFile = path.join(orcaDir, 'resources', 'app.asar')
  let asar
  let files
  try {
    asar = (await import('@electron/asar')).default
    files = asar.listPackage(asarFile).map((p) => p.replace(/\\/g, '/').replace(/^\//, ''))
  } catch (error) {
    log('fixes: cannot read app.asar (did you run npm install?)', error.message)
    return served
  }
  const assets = files.filter((p) => /^out\/renderer\/assets\/[^/]+\.js$/.test(p))
  // Unpacked files sit beside the archive; packed ones need the OS separator on Windows.
  const read = (asset) => {
    const unpacked = path.join(`${asarFile}.unpacked`, ...asset.split('/'))
    if (fs.existsSync(unpacked)) return fs.readFileSync(unpacked, 'utf8')
    return asar.extractFile(asarFile, asset.split('/').join(path.sep)).toString('utf8')
  }
  for (const fix of wanted) {
    let found = false
    for (const asset of assets) {
      let source
      try {
        source = read(asset)
      } catch {
        continue
      }
      if (fix.hint && !source.includes(fix.hint)) continue
      const patched = fix.patch(source)
      if (patched) {
        served.set(path.posix.basename(asset), patched)
        // A fix may apply only in part when one of its pieces no longer matches this Orca build.
        log(`fix ${fix.id}: serving patched ${asset}${fix.partial ? ` (partial: "${fix.partial}" not found, skipped)` : ''}`)
        found = true
        break
      }
    }
    if (!found) log(`fix ${fix.id}: code not found in this Orca build, skipped`)
  }
  return served
}
