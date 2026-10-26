// Copies bundled files into the user folder (~/.orca/themer): the classic themes on every launch, and the
// examples when you run `npm run example`.
// - A file the user has never had is copied.
// - A file the user edited is never overwritten; one they left alone follows the bundled updates.
// - A file the user deleted stays deleted.
// The last copied version of each file is kept in <root>/.bundled/<kind>/<name> to tell these apart.
import fs from 'node:fs'
import path from 'node:path'

const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file) : null)

/** sources: [{ from: dir, kind: 'themes' | 'terminal' | 'touches' | ... }] */
// restoreDeleted: bring back files the user deleted (an explicit `npm run example` does this).
export function seedBundled(root, sources, { restoreDeleted = false } = {}) {
  const copied = []
  for (const { from, kind } of sources) {
    const to = path.join(root, kind)
    fs.mkdirSync(to, { recursive: true })
    if (!fs.existsSync(from)) continue
    for (const name of fs.readdirSync(from)) {
      const source = path.join(from, name)
      if (!fs.statSync(source).isFile()) continue
      const target = path.join(to, name)
      const stampFile = path.join(root, '.bundled', kind, name)
      const bundled = fs.readFileSync(source)
      const lastBundled = read(stampFile)
      const current = read(target)
      if (current === null && lastBundled !== null && !restoreDeleted) continue // deleted by the user
      const untouched = current !== null && lastBundled !== null && current.equals(lastBundled)
      if (current === null || (untouched && !current.equals(bundled))) {
        fs.writeFileSync(target, bundled)
        copied.push(path.join(kind, name))
      }
      if (current === null || untouched) {
        fs.mkdirSync(path.dirname(stampFile), { recursive: true })
        fs.writeFileSync(stampFile, bundled)
      }
    }
  }
  return copied
}

/** The examples, by kind (examples/<kind> -> <root>/<kind>). */
export const EXAMPLE_KINDS = ['themes', 'snippets', 'terminal', 'touches', 'sounds']
export function exampleSources(repo) {
  return EXAMPLE_KINDS.map((kind) => ({ from: path.join(repo, 'examples', kind), kind }))
}
