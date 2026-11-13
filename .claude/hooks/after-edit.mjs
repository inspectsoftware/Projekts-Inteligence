// After Claude edits a file: lint that file at once (oxlint is fast), and note that this turn
// changed files, so the check at the end of the turn (check-on-stop.mjs) runs.
// An error comes back to Claude as the hook's output (exit 2), for it to fix straight away.
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(process.env.CLAUDE_PROJECT_DIR ?? process.cwd())
const input = JSON.parse(readFileSync(0, 'utf8') || '{}')
const file = resolve(input.tool_input?.file_path ?? '')
const norm = (p) => p.replace(/\\/g, '/').toLowerCase()
if (!norm(file).startsWith(norm(root) + '/')) process.exit(0)

writeFileSync(join(root, '.claude', '.edited'), String(Date.now()))
if (!/\.(ts|tsx|mts|mjs|js)$/.test(file)) process.exit(0)
try {
  execSync(`npx oxlint "${file}"`, { cwd: root, stdio: 'pipe' })
} catch (e) {
  process.stderr.write(`oxlint found problems in ${file}:\n${e.stdout ?? ''}${e.stderr ?? ''}`)
  process.exit(2)
}
