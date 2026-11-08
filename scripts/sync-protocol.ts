// Refreshes protocol/schema.ts from the dashboard's copy, which is the source
// of truth. Needs read access to the dashboard repo, so it runs locally, not
// in CI.
//
//   node scripts/sync-protocol.ts                      # via `gh api`
//   node scripts/sync-protocol.ts --from ../seo-dashboard   # from a local checkout
//
// Repo override: SEO_DASHBOARD_REPO=<owner>/<name> (default Raccoon-Software/seo-dashboard).

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const SOURCE_PATH = 'convex/lib/siteMetrics/protocol.ts'
const TARGET = new URL('../protocol/schema.ts', import.meta.url)

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : undefined
}

let source: string
let version: string
const local = arg('from')
if (local) {
  source = readFileSync(join(local, SOURCE_PATH), 'utf8')
  version = execFileSync('git', ['-C', local, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim()
} else {
  const repo = process.env.SEO_DASHBOARD_REPO ?? 'Raccoon-Software/seo-dashboard'
  const meta = JSON.parse(execFileSync('gh', ['api', `repos/${repo}/commits/HEAD`, '--jq', '{sha: .sha}'], { encoding: 'utf8' }))
  version = String(meta.sha).slice(0, 7)
  source = execFileSync('gh', ['api', `repos/${repo}/contents/${SOURCE_PATH}?ref=${meta.sha}`, '-H', 'Accept: application/vnd.github.raw'], {
    encoding: 'utf8',
  })
}

const header = [
  `// Copied verbatim from seo-dashboard (${SOURCE_PATH} @ ${version}).`,
  '// The dashboard\'s copy is the source of truth. Do not edit here: run `bun run sync:protocol`.',
  '',
].join('\n')
const next = `${header}\n${source}`
const current = readFileSync(TARGET, 'utf8')
if (current === next) {
  console.log(`protocol/schema.ts is up to date (${version}).`)
} else {
  writeFileSync(TARGET, next)
  console.log(`protocol/schema.ts updated to ${version}. Run the tests, then commit.`)
}
