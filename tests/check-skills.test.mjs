import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  parseFrontmatter,
  checkSkills,
  checkLinks,
  checkVersions,
  checkAgents,
  checkPrivacy,
  runChecks,
  walk,
} from '../scripts/check-skills.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function tmpRepo(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'check-skills-'));
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
  return root;
}

const skill = (name, extra = '') =>
  `---\nname: ${name}\ndescription: Does a thing. Use when things happen.\nmetadata:\n  version: "1.0.0"\n---\n\n# ${name}\n${extra}`;

test('parseFrontmatter reads top-level and nested keys', () => {
  const fm = parseFrontmatter(skill('demo'));
  assert.equal(fm.data.name, 'demo');
  assert.equal(fm.data.metadata.version, '1.0.0');
  assert.equal(parseFrontmatter('# no frontmatter'), null);
});

test('checkSkills accepts a valid skill and rejects bad ones', () => {
  const root = tmpRepo({
    'skills/good/SKILL.md': skill('good'),
    'skills/Bad_Name/SKILL.md': skill('Bad_Name'),
    'skills/mismatch/SKILL.md': skill('other'),
    'skills/nofm/SKILL.md': '# nothing',
    'skills/long/SKILL.md': skill('long', 'x\n'.repeat(600)),
    'skills/angle/SKILL.md': skill('angle').replace('Does a thing.', 'Does <xml>.'),
  });
  const { errors, skills } = checkSkills(root);
  const joined = errors.join('\n');
  assert.ok(!joined.includes('skills/good/'), joined);
  assert.match(joined, /Bad_Name.*lowercase/);
  assert.match(joined, /mismatch.*must equal directory name/);
  assert.match(joined, /nofm.*frontmatter/);
  assert.match(joined, /long.*lines/);
  assert.match(joined, /angle.*angle brackets/);
  assert.ok(skills.some((s) => s.name === 'good' && s.version === '1.0.0'));
});

test('checkLinks flags broken relative links and ignores URLs, anchors and code blocks', () => {
  const root = tmpRepo({
    'a.md': '[ok](b.md) [web](https://x.y) [anchor](#top) [broken](missing.md)\n```\n[in code](nope.md)\n```\n',
    'b.md': '[back](a.md#section)',
  });
  const errors = checkLinks(root, walk(root));
  assert.deepEqual(errors, ['a.md: broken link missing.md']);
});

test('checkVersions requires one version everywhere', () => {
  const root = tmpRepo({
    'package.json': '{"version":"1.0.0"}',
    '.claude-plugin/plugin.json': '{"version":"1.0.1"}',
  });
  const errors = checkVersions(root, [{ name: 'good', version: '1.0.0' }]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /claude-plugin\/plugin.json=1.0.1/);
  assert.deepEqual(checkVersions(root, []).length, 1);
});

test('checkAgents requires reviewer bodies to match the shared prompt', () => {
  const prompt = 'You are a reviewer.\n\nDo not edit.';
  const md = `# Reviewer\n\n<!-- reviewer-prompt:begin -->\n${prompt}\n<!-- reviewer-prompt:end -->\n`;
  const agent = (body, extra = '') => `---\nname: team-reviewer\ndescription: Reviews.\n${extra}---\n\n${body}\n`;
  const ok = tmpRepo({
    'skills/subagent-team/references/reviewer-prompt.md': md,
    'agents/team-reviewer.md': agent(prompt),
  });
  assert.deepEqual(checkAgents(ok), []);
  const bad = tmpRepo({
    'skills/subagent-team/references/reviewer-prompt.md': md,
    'agents/team-reviewer.md': agent('Something else', 'permissionMode: default\n'),
  });
  const errors = checkAgents(bad).join('\n');
  assert.match(errors, /permissionMode/);
  assert.match(errors, /body differs/);
});

test('checkPrivacy catches personal paths, emails, keys and denylisted terms', () => {
  const root = tmpRepo({
    'doc.md': [
      'Repository: /' + 'Users/alice/dev/app',
      'Linux: /' + 'home/bob/src',
      'Sandbox path /home/user/repo is fine',
      'Placeholder /Users/<name>/x is fine',
      'mail me at alice' + '@company.io',
      'noreply@example.com is fine',
      'token sk-' + 'abcdefghijklmnopqrstuvwxyz123456',
      'Working on SecretProject today',
    ].join('\n'), // literals split so this file passes its own scan
    '.privacy-denylist': '# private names\nsecretproject\n',
  });
  const errors = checkPrivacy(root, walk(root), ['secretproject']);
  const joined = errors.join('\n');
  assert.match(joined, /doc.md:1: macOS home path/);
  assert.match(joined, /doc.md:2: Linux home path/);
  assert.match(joined, /doc.md:5: email address/);
  assert.match(joined, /doc.md:7: API key/);
  assert.match(joined, /doc.md:8: denylisted term/);
  assert.equal(errors.length, 5, joined);
});

test('the repository itself passes all checks', () => {
  assert.deepEqual(runChecks(repoRoot), []);
});

test('CLI exits non-zero on problems', () => {
  const root = tmpRepo({ 'skills/x/SKILL.md': '# missing frontmatter' });
  const script = path.join(repoRoot, 'scripts/check-skills.mjs');
  assert.throws(() => execFileSync(process.execPath, [script, '--root', root], { stdio: 'pipe' }), /Command failed/);
  const out = execFileSync(process.execPath, [script, '--root', repoRoot], { encoding: 'utf8' });
  assert.match(out, /all checks passed/);
});
