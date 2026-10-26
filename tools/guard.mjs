// `npm run guard`: privacy guard. Fails (exit 1) when a file in the repo, or a commit about to be
// pushed, carries something that should not be public:
//   - personal words (names, handles, project words; see WORD_HASHES below)
//   - a real Windows user folder (C:\Users\<someone>); placeholders like <you> or %USERNAME% are fine
//   - an email address other than <id>+<login>@users.noreply.github.com
//   - something shaped like a secret (API keys, tokens, private keys)
//   - a commit author email that is not a GitHub noreply address
// Text files are scanned as text. Images and other binaries are scanned for the strings hidden in
// them (PNG text chunks, compressed ones included; GIF comments; JPEG EXIF/XMP, UTF-16 too).
//
//   npm run guard                         # tracked + untracked (not ignored) files, and unpushed commits
//   node tools/guard.mjs --range A..B     # commits in A..B instead (CI passes the pushed range)
//   node tools/guard.mjs --no-commits     # files only
//
// Why hashes: this repo is public, so the list of personal words cannot be written here in plain
// text (the list itself would be the leak). Each entry is the first 16 hex characters of
// SHA-256(lowercased word). The scanner hashes every word it reads (and every substring of the
// lengths in WORD_LENGTHS, so "xyzName" is still caught) and compares. To add a word, run
//   node tools/guard.mjs --hash <word>
// and paste the two printed values into WORD_HASHES and FNV_BUCKETS; add its length to
// WORD_LENGTHS (Latin) or CJK_LENGTHS (CJK) if it is new.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const WORD_HASHES = new Set([
  // Latin words
  'f1d3dfbfd8673ff5', '3d7dd07e0152d1e5', 'fef08b4ead05d491', '4cce5106c88d9b56',
  'e741bc1d4dbb40c1', 'efb9d13466a0c832', '1c04c67737facef9',
  // CJK words (Traditional and Simplified forms)
  'a276d0aa6e43026a', 'ea6f2313866ef8f7', 'd1597c51ed6c8992', '2dff22a97a3236a6',
  '86372647ac808d55', 'a56b5ab864a6f5d0', '36a46d5d01082b5c', '2f7c3ee8c426f756',
  '6a2991e36a362071', '3ff1c5174bfa6a79',
])
const WORD_LENGTHS = [6, 7, 8, 9, 10, 11] // ascending
const CJK_LENGTHS = [2, 4] // ascending, in UTF-16 code units
// FNV-1a 32-bit of each word, & 4095: a cheap prefilter so SHA-256 runs on ~0.4% of the windows.
const FNV_BUCKETS = new Set([358, 617, 966, 976, 1059, 1319, 1395, 1645, 2193, 2422, 2430, 2647, 2819, 2869, 3399, 3768, 4079])

// Folder names after C:\Users\ that are clearly not a real person.
const PLACEHOLDER_USERS = new Set([
  'user', 'username', 'user-name', 'user_name', 'you', 'your', 'yourname', 'your-name', 'your_name',
  'me', 'name', 'someone', 'example', 'public', 'default', 'all users', 'xxx', '...', '…',
])
const EMAIL_OK = /@users\.noreply\.github\.com$/i
// Example addresses in docs (RFC 2606 domains) and bot no-reply addresses (Co-Authored-By trailers)
// are fine in text. Commit authors still have to be GitHub noreply.
const EMAIL_EXAMPLE = /@(?:[\w-]+\.)*(?:example\.(?:com|org|net)|example|test|invalid|localhost)$|^no-?reply@/i

// Built from pieces so this file does not match its own patterns.
const SECRET_PATTERNS = [
  ['private key', new RegExp('-----BEGIN [A-Z ]*' + 'PRIVATE KEY-----')],
  ['AWS access key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})\b/],
  ['OpenAI/Anthropic key', /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{32,}/],
  ['Stripe key', /\b[sr]k_live_[A-Za-z0-9]{20,}\b/],
  ['Slack token', /\bxox[abposr]-[A-Za-z0-9-]{10,}/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['Supabase token', /\bsbp_[a-f0-9]{40}\b/],
  ['npm token', /\bnpm_[A-Za-z0-9]{36}\b/],
  ['JWT', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['secret assignment', /\b(?:api[_-]?key|secret|access[_-]?token|auth[_-]?token|password|passwd)\b["']?\s*[:=]\s*["'](?=[^"'\s]*\d)(?=[^"'\s]*[A-Za-z])[^"'\s]{20,}["']/i],
]

const hash = (s) => createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 16)

// --- scanners ---------------------------------------------------------------------------------

const CJK_RUN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u{20000}-\u{2fa1f}]+/gu
const LATIN_TOKEN = /[a-z0-9]+/g

/**
 * Personal words in `text`: every window of a listed length inside a Latin token (or a joined pair
 * of tokens) or a CJK run. SHA-256 is slow per call, so a 32-bit FNV-1a computed while walking the
 * window acts as a prefilter; only windows whose FNV bucket is in FNV_BUCKETS get hashed.
 */
function findWords(text) {
  const hits = []
  const seen = new Set()
  const scan = (s, lengths) => {
    const max = lengths[lengths.length - 1]
    for (let i = 0; i < s.length; i++) {
      let h = 0x811c9dc5
      for (let j = i; j < s.length && j - i < max; j++) {
        h = Math.imul(h ^ s.charCodeAt(j), 0x01000193)
        if (!FNV_BUCKETS.has((h >>> 0) & 4095) || !lengths.includes(j - i + 1)) continue
        const w = s.slice(i, j + 1)
        if (seen.has(w)) continue
        seen.add(w)
        if (WORD_HASHES.has(hash(w))) hits.push(w)
      }
    }
  }
  const lower = text.normalize('NFC').toLowerCase()
  let prev = ''
  let lastEnd = -1
  for (const m of lower.matchAll(LATIN_TOKEN)) {
    const t = m[0]
    if (t.length >= WORD_LENGTHS[0]) scan(t, WORD_LENGTHS)
    // "First Last" or "first-last" written as two tokens: also try the pair joined.
    if (prev && m.index - lastEnd <= 1 && prev.length + t.length >= WORD_LENGTHS[0]) scan(prev + t, WORD_LENGTHS)
    prev = t
    lastEnd = m.index + t.length
  }
  for (const m of lower.matchAll(CJK_RUN)) scan(m[0], CJK_LENGTHS)
  return hits
}

const USERS_PATH = /\b[A-Za-z]:(?:\\{1,2}|\/)Users(?:\\{1,2}|\/)([^\\/\s"'`<>|:*?]+)/gi

function findIssues(text, { lineAllow = true } = {}) {
  const issues = []
  if (findWords(text).length) {
    // Find the line(s) so the report points somewhere useful, without printing the word itself.
    const lines = text.split(/\r?\n/)
    lines.forEach((l, i) => { if (findWords(l).length) issues.push({ line: i + 1, rule: 'personal-word', detail: 'a personal word (name/handle/project) from the hashed list' }) })
    if (!issues.length) issues.push({ line: 0, rule: 'personal-word', detail: 'a personal word split across lines' })
  }
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (lineAllow && /privacy-guard:\s*allow/.test(l)) continue
    for (const m of l.matchAll(USERS_PATH)) {
      const name = m[1].toLowerCase()
      if (/^[%$<{[]/.test(name) || PLACEHOLDER_USERS.has(name)) continue
      issues.push({ line: i + 1, rule: 'user-path', detail: `real-looking user folder ${m[0].slice(0, 12)}…` })
    }
    for (const m of l.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g)) {
      if (EMAIL_OK.test(m[0]) || EMAIL_EXAMPLE.test(m[0])) continue
      if (/^(?:[\w-]+\/)?[\w.-]+@\d/.test(m[0]) || /\.(?:png|jpe?g|gif|svg|webp|js|mjs|css)$/i.test(m[0])) continue // pkg@1.2.3, icon@2x.png
      issues.push({ line: i + 1, rule: 'email', detail: `email address ${m[0].replace(/^(.).*@/, '$1***@')}` })
    }
    for (const [name, re] of SECRET_PATTERNS) if (re.test(l)) issues.push({ line: i + 1, rule: 'secret', detail: name })
  }
  return issues
}

/** Strings hidden in a binary file: printable ASCII runs, UTF-16LE runs, UTF-8 CJK, and inflated PNG text chunks. */
function binaryStrings(buf) {
  const out = []
  const latin = buf.toString('latin1')
  for (const m of latin.matchAll(/[\x20-\x7e\t]{4,}/g)) out.push(m[0])
  for (const m of buf.toString('utf16le').matchAll(/[\x20-\x7e\u3400-\u9fff]{4,}/g)) out.push(m[0])
  // An odd offset for UTF-16 too (EXIF strings are not always aligned).
  if (buf.length > 1) for (const m of buf.subarray(1).toString('utf16le').matchAll(/[\x20-\x7e\u3400-\u9fff]{4,}/g)) out.push(m[0])
  for (const m of buf.toString('utf8').matchAll(CJK_RUN)) out.push(m[0])
  // PNG: tEXt is plain (already covered); zTXt and compressed iTXt need inflating.
  if (buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47) {
    let p = 8
    while (p + 12 <= buf.length) {
      const len = buf.readUInt32BE(p)
      const type = buf.toString('latin1', p + 4, p + 8)
      const data = buf.subarray(p + 8, p + 8 + len)
      try {
        if (type === 'zTXt') {
          const k = data.indexOf(0)
          out.push(data.toString('latin1', 0, k), zlib.inflateSync(data.subarray(k + 2)).toString('latin1'))
        } else if (type === 'iTXt') {
          const k = data.indexOf(0)
          const compressed = data[k + 1] === 1
          let q = k + 3
          q = data.indexOf(0, q) + 1 // language tag
          q = data.indexOf(0, q) + 1 // translated keyword
          const body = data.subarray(q)
          out.push(data.toString('utf8', 0, q), (compressed ? zlib.inflateSync(body) : body).toString('utf8'))
        }
      } catch { out.push(`[unreadable ${type} chunk]`) }
      if (type === 'IEND') break
      p += 12 + len
    }
  }
  return out.join('\n')
}

const BINARY_EXT = /\.(?:png|gif|jpe?g|webp|ico|bmp|tiff?|wav|mp3|mp4|webm|pdf|zip|woff2?|ttf|otf)$/i
const isBinary = (buf, rel) => BINARY_EXT.test(rel) || buf.subarray(0, 8000).includes(0)

// --- files ------------------------------------------------------------------------------------

const git = (...args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 << 20 })

function scanFiles() {
  const files = git('ls-files', '-z', '--cached', '--others', '--exclude-standard').split('\0').filter(Boolean)
  const problems = []
  for (const rel of [...new Set(files)]) {
    const full = path.join(REPO, rel)
    let buf
    try { buf = fs.readFileSync(full) } catch { continue } // deleted in the work tree
    // The path itself is public too.
    for (const i of findIssues(rel)) problems.push({ where: `${rel} (file name)`, ...i })
    const binary = isBinary(buf, rel)
    let text
    if (binary) text = binaryStrings(buf)
    else if (buf[0] === 0xff && buf[1] === 0xfe) text = buf.toString('utf16le')
    else text = buf.toString('utf8')
    for (const i of findIssues(text, { lineAllow: !binary })) {
      // npm writes third-party maintainers' addresses into the lockfile; those are not ours.
      if (rel === 'package-lock.json' && i.rule === 'email') continue
      problems.push({ where: binary ? `${rel} (embedded text)` : `${rel}:${i.line}`, ...i })
    }
  }
  return { count: files.length, problems }
}

// --- commits ----------------------------------------------------------------------------------

function defaultRange() {
  try { git('rev-parse', '--verify', '--quiet', '@{u}'); return '@{u}..HEAD' } catch {}
  try { git('rev-parse', '--verify', '--quiet', 'origin/main'); return 'origin/main..HEAD' } catch {}
  return null
}

function scanCommits(range) {
  const problems = []
  if (!range) return { count: 0, problems }
  const SEP = '\x1e'
  const raw = git('log', '--format=%H%x1f%an%x1f%ae%x1f%cn%x1f%B' + SEP, range)
  const commits = raw.split(SEP).map((s) => s.trim()).filter(Boolean)
  for (const c of commits) {
    const [sha, an, ae, cn, body] = c.split('\x1f')
    const where = `commit ${sha.slice(0, 7)}`
    if (!EMAIL_OK.test(ae)) problems.push({ where, rule: 'author-email', detail: `author email is not a GitHub noreply address (${ae.replace(/^(.).*@/, '$1***@')})` })
    for (const i of findIssues(`${an}\n${cn}`, { lineAllow: false })) if (i.rule === 'personal-word') problems.push({ where: `${where} (author/committer name)`, ...i })
    for (const i of findIssues(body ?? '')) problems.push({ where: `${where} message`, ...i })
  }
  return { count: commits.length, problems }
}

// --- main -------------------------------------------------------------------------------------

const args = process.argv.slice(2)
if (args[0] === '--hash') {
  for (const w of args.slice(1)) {
    const s = w.normalize('NFC').toLowerCase()
    let h = 0x811c9dc5
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193)
    console.log(`'${hash(s)}'  bucket ${(h >>> 0) & 4095}  length ${s.length}`)
  }
  process.exit(0)
}
const rangeArg = args.includes('--range') ? args[args.indexOf('--range') + 1] : undefined
const started = performance.now()
const files = scanFiles()
const commits = args.includes('--no-commits') ? { count: 0, problems: [] } : scanCommits(rangeArg ?? defaultRange())
const problems = [...files.problems, ...commits.problems]
for (const p of problems) console.log(`LEAK ${p.where}  [${p.rule}] ${p.detail}`)
const ms = Math.round(performance.now() - started)
console.log(`\nprivacy guard: ${files.count} file(s), ${commits.count} commit(s), ${problems.length} problem(s) in ${ms} ms`)
if (problems.length) console.log('Fix or remove these before pushing. A false alarm on a non-word rule can be silenced with a "privacy-guard: allow" comment on that line.')
process.exit(problems.length ? 1 : 0)
