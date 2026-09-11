// Uploads the skills under skills/ to the Anthropic Skills API — a new version of the skill with
// the same name if one exists, otherwise a new skill — and prints the ids to pin.
//
//   pnpm --filter @roster/api skills:upload             every skill
//   pnpm --filter @roster/api skills:upload x402-arc    just one
//
// Agents are created pinned to a skill *version* (CLAUDE_PAYMENT_SKILL_VERSION), so an upload
// changes nothing for agents already hired — only for the next hire, once the pin is moved.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import Anthropic, { toFile } from '@anthropic-ai/sdk'
import { loadEnv } from '../src/env.js'

const env = loadEnv()
const ROOT = resolve(import.meta.dirname, '../../../skills')

/// Every file under a skill folder, dotfiles skipped.
function filesIn(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    if (entry.startsWith('.')) return []
    const path = join(dir, entry)
    return statSync(path).isDirectory() ? filesIn(path) : [path]
  })
}

/// The `name:` in SKILL.md's frontmatter — what the API derives the skill's display name from.
function nameOf(skillMd: string): string {
  const name = skillMd.match(/^---\n[\s\S]*?^name:\s*(.+?)\s*$/m)?.[1]
  if (!name) throw new Error('SKILL.md has no `name:` in its frontmatter')
  return name
}

async function main() {
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set.')
  const client = new Anthropic()
  const only = process.argv[2]

  const existing = new Map<string, string>()
  for await (const skill of client.skills.list({ source: 'custom' })) existing.set(skill.display_name, skill.id)

  let uploaded = 0
  for (const dir of readdirSync(ROOT)) {
    const folder = join(ROOT, dir)
    if (!statSync(folder).isDirectory() || (only && dir !== only)) continue

    const name = nameOf(readFileSync(join(folder, 'SKILL.md'), 'utf8'))
    // The API wants every file under one top-level folder, SKILL.md at its root.
    const files = await Promise.all(
      filesIn(folder).map((path) => toFile(readFileSync(path), `${dir}/${relative(folder, path)}`)),
    )

    const skillId = existing.get(name)
    if (skillId) {
      const version = await client.skills.versions.create(skillId, { files })
      console.log(`${name.padEnd(16)} ${skillId}  new version ${version.id}`)
    } else {
      const skill = await client.skills.create({ files, display_name: name })
      console.log(`${name.padEnd(16)} ${skill.id}  new skill, version ${skill.latest_version_id}`)
    }
    uploaded++
  }

  if (uploaded === 0) throw new Error(only ? `No skill folder named "${only}" under skills/.` : 'No skill folders under skills/.')
  console.log('\nPin a version for new hires with CLAUDE_PAYMENT_SKILL_ID and CLAUDE_PAYMENT_SKILL_VERSION.')
}

main().catch((error) => {
  console.error(`\nupload failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
