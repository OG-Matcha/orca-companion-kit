// `npm run example`: copies the examples (theme, terminal palette, snippet, the Puff companion) into your
// user folder, ~/.orca/themer (or $ORCA_THEMER_ROOT). A file you have edited there is never overwritten.
// Then press Ctrl+Alt+T in Orca and pick 「棉花夜空 Cotton Sky」.
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { exampleSources, seedBundled } from '../src/seed.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ROOT = process.env.ORCA_THEMER_ROOT || path.join(os.homedir(), '.orca', 'themer')
const copied = seedBundled(ROOT, exampleSources(REPO), { restoreDeleted: true })
console.log(copied.length ? `copied into ${ROOT}:\n  ${copied.join('\n  ')}` : `nothing new: ${ROOT} already has the examples (edited files are left alone)`)
console.log('In Orca: Ctrl+Alt+T -> 棉花夜空 Cotton Sky')
