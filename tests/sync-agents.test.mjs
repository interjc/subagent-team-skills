import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { syncAgents } from '../scripts/sync-agents.mjs';

test('syncAgents rewrites reviewer bodies from the shared prompt and keeps frontmatter', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-agents-'));
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  };
  write('skills/subagent-team/references/reviewer-prompt.md',
    'intro\n\n<!-- reviewer-prompt:begin -->\nNew body.\n<!-- reviewer-prompt:end -->\n');
  const fm = '---\nname: team-reviewer\ndescription: Reviews.\nmodel: sonnet\n---\n';
  write('agents/team-reviewer.md', `${fm}\nOld body.\n`);
  write('agents/other.md', '---\nname: other\ndescription: x\n---\n\nUntouched.\n');

  assert.deepEqual(syncAgents(root), ['agents/team-reviewer.md']);
  assert.equal(fs.readFileSync(path.join(root, 'agents/team-reviewer.md'), 'utf8'), `${fm}\nNew body.\n`);
  assert.match(fs.readFileSync(path.join(root, 'agents/other.md'), 'utf8'), /Untouched/);
  assert.deepEqual(syncAgents(root), [], 'second run is a no-op');
});
