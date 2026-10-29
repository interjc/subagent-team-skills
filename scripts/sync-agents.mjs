#!/usr/bin/env node
// Regenerate the body of every agents/team-reviewer*.md from the shared prompt
// block in skills/subagent-team/references/reviewer-prompt.md, keeping each
// file's own frontmatter.
//
//   node scripts/sync-agents.mjs [--root <dir>]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { extractReviewerPrompt, parseFrontmatter } from './check-skills.mjs';

export function syncAgents(root) {
  const prompt = extractReviewerPrompt(
    fs.readFileSync(path.join(root, 'skills/subagent-team/references/reviewer-prompt.md'), 'utf8'),
  );
  if (!prompt) throw new Error('reviewer-prompt.md: missing reviewer-prompt markers');
  const agentsDir = path.join(root, 'agents');
  const changed = [];
  for (const name of fs.readdirSync(agentsDir).filter((f) => f.startsWith('team-reviewer') && f.endsWith('.md'))) {
    const file = path.join(agentsDir, name);
    const text = fs.readFileSync(file, 'utf8');
    const fm = parseFrontmatter(text);
    if (!fm) throw new Error(`agents/${name}: missing frontmatter`);
    const next = `${text.slice(0, fm.bodyStart)}\n${prompt.trim()}\n`;
    if (next !== text) {
      fs.writeFileSync(file, next);
      changed.push(`agents/${name}`);
    }
  }
  return changed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  const i = process.argv.indexOf('--root');
  const root = path.resolve(i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
  const changed = syncAgents(root);
  console.log(changed.length ? `updated: ${changed.join(', ')}` : 'agents already in sync');
}
