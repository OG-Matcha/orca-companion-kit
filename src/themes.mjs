// Theme and snippet files: plain CSS with a BetterDiscord-style header.
//   /**
//    * @name My Theme
//    * @author ...
//    * @description ...
//    * @touches power-mode, my-pet
//    */
import fs from 'node:fs'
import path from 'node:path'

function readMeta(css) {
  const header = /^\s*\/\*\*([\s\S]*?)\*\//.exec(css)?.[1] ?? ''
  const meta = {}
  for (const m of header.matchAll(/@(\w+)\s+([^\n]*)/g)) meta[m[1]] = m[2].trim()
  return meta
}

function readDir(dir) {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.css'))
    .sort()
    .map((name) => {
      const file = path.join(dir, name)
      const css = fs.readFileSync(file, 'utf8')
      const meta = readMeta(css)
      return {
        id: name.replace(/\.css$/, ''),
        name: meta.name || name.replace(/\.css$/, ''),
        author: meta.author || '',
        description: meta.description || '',
        touches: (meta.touches || '').split(/[\s,]+/).filter(Boolean),
        file,
        css
      }
    })
}

// A theme may ship a matching terminal palette as terminal/<theme id>.json (Orca TerminalColorOverrides).
function readTerminal(root, id) {
  const file = path.join(root, 'terminal', `${id}.json`)
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

// Personal images for a theme live in assets/<theme id>/ (never in the repo) and surface as
// --asset-<file name> custom properties, e.g. assets/my-theme/portrait.png -> var(--asset-portrait).
// Audio files surface the same way (lullaby.ogg -> --asset-lullaby) for a companion to play (api.asset).
function readAssets(root, id) {
  const dir = path.join(root, 'assets', id)
  if (!fs.existsSync(dir)) return ''
  const vars = fs
    .readdirSync(dir)
    .filter((name) => /\.(png|jpe?g|webp|gif|svg|ogg|mp3|m4a|wav)$/i.test(name))
    .map((name) => {
      const url = `file:///${path.join(dir, name).replace(/\\/g, '/')}`.replace(/"/g, '%22')
      return `--asset-${name.replace(/\.[^.]+$/, '').replace(/[^\w-]/g, '-')}: url("${url}");`
    })
  return vars.length ? `:root { ${vars.join(' ')} }` : ''
}

export function loadLibrary(root) {
  const themes = readDir(path.join(root, 'themes')).map((t) => ({
    ...t,
    terminal: readTerminal(root, t.id),
    assetsCss: readAssets(root, t.id)
  }))
  return { themes, snippets: readDir(path.join(root, 'snippets')) }
}

export function composeCss(library, settings) {
  const parts = []
  const theme = library.themes.find((t) => t.id === settings.themeId)
  if (theme) parts.push(`/* theme: ${theme.id} */\n${theme.assetsCss ?? ''}\n${theme.css}`)
  for (const s of library.snippets)
    if (settings.enabledSnippets.includes(s.id)) parts.push(`/* snippet: ${s.id} */\n${s.css}`)
  return parts.join('\n\n')
}

export function publicState(library, settings) {
  const strip = ({ css, file, terminal, assetsCss, ...rest }) => ({ ...rest, hasTerminal: Boolean(terminal) })
  return {
    themes: library.themes.map(strip),
    snippets: library.snippets.map(strip),
    themeId: settings.themeId,
    enabledSnippets: settings.enabledSnippets,
    enabledTouches: settings.enabledTouches
  }
}
