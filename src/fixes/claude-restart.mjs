// Optional fix (off by default; see docs/fixes.md): a Claude account switch never restarts panes with
// background work (Orca isClaudePaneMidTurn reads the combined pane state). Served through CDP Fetch;
// files on disk stay untouched. Any other bundle shape -> patch() returns null and nothing changes.
const OLD =
  /function ([\w$]+)\(([\w$]+),([\w$]+)\)\{let ([\w$]+)=\2\.agentStatusByPaneKey\[\3\];return \4\?\.agentType===`claude`&&\4\.state!==`done`\}/

export const claudeRestartFix = {
  id: 'claude-restart-after-switch',
  hint: 'agentStatusByPaneKey', // a cheap substring check before the regex runs on each renderer file
  label: '換帳號後重開 session',
  /** Set by patch() when only part of the fix applied; the launcher logs it. */
  partial: null,
  /** Returns the patched source, or null when this build does not contain the known code. */
  patch(source) {
    this.partial = null
    const match = OLD.exec(source)
    if (!match) return null
    const [whole, fn, s, k, e] = match
    const fixed =
      `function ${fn}(${s},${k}){let ${e}=${s}.agentStatusByPaneKey[${k}];` +
      `return ${e}?.agentType===\`claude\`&&(${e}.state===\`waiting\`||${e}.state===\`blocked\`||(${e}.mainAgent?.state??${e}.state)!==\`done\`)}`
    // Only one definition may exist; two would mean the bundle changed shape.
    if (source.indexOf(whole) !== source.lastIndexOf(whole)) return null
    const restarted = source.replace(whole, fixed)
    const kept = keepPermission(restarted)
    this.partial = kept === restarted ? '重開後保留權限模式' : null
    return kept
  }
}

// Same file: the restart reuses the pane's recorded launch args. A Claude pane often records none
// (launchConfig {agentCommand:"claude", agentArgs:""}), and with no recorded config Claude is
// given none on purpose, so the restarted `claude --resume` falls back to ~/.claude settings'
// defaultMode (e.g. "auto") instead of the permission chosen in Orca (e.g. full-access). Empty
// or missing args for Claude now take Orca's default launch args, which carry that permission.
// A recorded agentCommand also wins over every arg: the resume builder uses it verbatim and skips
// agentArgs. Claude records the bare command ("claude") with the args beside it, so even a pane
// recorded with --dangerously-skip-permissions restarted without it. A bare recorded command is
// dropped and Orca rebuilds it from the same command override plus the args.
// Optional: if the shape changed, the restart fix above still applies on its own.
const RESUME_ARGS = /agentArgs:([\w$]+)===void 0\?([\w$]+)\?([\w$]+)\(([\w$]+),([\w$]+)\.settings\):null:\1\.agentArgs,/
const RESUME_COMMAND = (config) =>
  `...${config}?.agentCommand?{agentCommand:${config}.agentCommand}:{}`
function keepPermission(source) {
  const match = RESUME_ARGS.exec(source)
  if (!match || source.indexOf(match[0]) !== source.lastIndexOf(match[0])) return source
  const [whole, config, , defaults, agent, state] = match
  const command = RESUME_COMMAND(config)
  if (source.indexOf(command) === -1 || source.indexOf(command) !== source.lastIndexOf(command)) return source
  const useDefaults = `${agent}===\`claude\`&&!${config}?.agentArgs?.trim()`
  return source
    .replace(
      whole,
      `agentArgs:${config}===void 0||${useDefaults}?${defaults}(${agent},${state}.settings):${config}.agentArgs,`
    )
    .replace(
      command,
      `...${config}?.agentCommand&&!(${agent}===\`claude\`&&!/\\s/.test(${config}.agentCommand.trim()))?{agentCommand:${config}.agentCommand}:{}`
    )
}
