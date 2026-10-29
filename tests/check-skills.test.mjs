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
  checkSkillIsolation,
  checkEnglish,
  checkReadmeParity,
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

test('checkSkills flags references not linked from SKILL.md', () => {
  const root = tmpRepo({
    'skills/demo/SKILL.md': skill('demo', 'See [a](references/a.md).\n'),
    'skills/demo/references/a.md': '# a',
    'skills/demo/references/orphan.md': '# orphan',
  });
  const { errors } = checkSkills(root);
  assert.deepEqual(errors, ['skills/demo/references/orphan.md: not linked from SKILL.md']);
});

test('parseFrontmatter tolerates CRLF line endings', () => {
  assert.equal(parseFrontmatter(skill('demo').replace(/\n/g, '\r\n')).data.name, 'demo');
});

test('checkSkillIsolation rejects relative links that leave a skill', () => {
  const root = tmpRepo({
    'skills/a/SKILL.md': '[own](references/x.md) [other](../b/SKILL.md) [web](https://x.y)',
    'skills/a/references/x.md': '[up](../SKILL.md) [repo](../../../README.md)',
    'skills/b/SKILL.md': '# b',
    'README.md': '# r',
  });
  const errors = checkSkillIsolation(root, walk(root));
  assert.deepEqual(errors.sort(), [
    'skills/a/SKILL.md: link ../b/SKILL.md leaves the skill directory',
    'skills/a/references/x.md: link ../../../README.md leaves the skill directory',
  ]);
});

test('checkEnglish rejects CJK text in skills and agents only', () => {
  const root = tmpRepo({
    'skills/a/SKILL.md': '# a\n\u4e2d\u6587\n',
    'agents/r.md': 'ok\n\u65e5\u672c\u8a9e\n',
    'README_ZH.md': '\u4e2d\u6587 is fine here',
  });
  const errors = checkEnglish(root, walk(root));
  assert.deepEqual(errors.sort(), [
    'agents/r.md:2: non-English text in skill content',
    'skills/a/SKILL.md:2: non-English text in skill content',
  ]);
});

test('checkReadmeParity compares headings, code blocks and link targets', () => {
  const en = '# T\n## A\n[x](a.md)\n```\ncode\n```\n';
  const same = tmpRepo({ 'README.md': en, 'README_ZH.md': '# \u6807\u9898\n## \u7532\n[\u6587](a.md)\n```\n\u4ee3\u7801\n```\n' });
  assert.deepEqual(checkReadmeParity(same), []);
  const diff = tmpRepo({ 'README.md': en, 'README_ZH.md': '# T\n[x](b.md)\n' });
  const errors = checkReadmeParity(diff).join('\n');
  assert.match(errors, /headings/);
  assert.match(errors, /fences/);
  assert.match(errors, /links/);
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
  assert.throws(() => execFileSync(process.execPath, [script, '--root'], { stdio: 'pipe' }), /Command failed/);
  const out = execFileSync(process.execPath, [script, '--root', repoRoot], { encoding: 'utf8' });
  assert.match(out, /all checks passed/);
});
