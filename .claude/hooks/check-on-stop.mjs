// When Claude ends a turn in which it changed files: run the project's checks (npm run check:
// typecheck, lint, tests). If they fail, the turn does not end: Claude is shown what failed and
// goes on to fix it. Only once in a row, so a failure it cannot fix does not loop; then the user
// is told instead. Turns that changed nothing (questions, research) end at once.
import { execSync } from 'node:child_process'
import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(process.env.CLAUDE_PROJECT_DIR ?? process.cwd())
const input = JSON.parse(readFileSync(0, 'utf8') || '{}')
const marker = join(root, '.claude', '.edited')
if (!existsSync(marker)) process.exit(0)

try {
  execSync('npm run -s check', { cwd: root, stdio: 'pipe', timeout: 9 * 60_000 })
  unlinkSync(marker)
  process.exit(0)
} catch (e) {
  const out = `${e.stdout ?? ''}${e.stderr ?? ''}`
  const lines = out.split('\n')
  const failing = lines.filter((l) => /error|fail|✗|×|warning/i.test(l)).slice(0, 40).join('\n')
  const report = (failing || lines.slice(-60).join('\n')).slice(0, 6000)
  if (input.stop_hook_active) {
    // Already sent back once and still failing: stop, and say so to the user.
    console.log(JSON.stringify({ systemMessage: `npm run check still fails after the fix attempt:\n${report}` }))
    process.exit(0)
  }
  console.log(JSON.stringify({ decision: 'block', reason: `npm run check failed after this turn's edits. Fix what failed, then finish:\n${report}` }))
  process.exit(0)
}
