import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter } from '../scripts/check-skills.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const license = read('LICENSE');

test('license retains MIT terms and applies the Commons Clause restriction', () => {
  assert.match(license, /^MIT License with Commons Clause v1\.0\n/);
  const normalized = license.replace(/\s+/g, ' ');
  assert.ok(normalized.includes('License will not include, and the License does not grant to you, the right to Sell the Software.'));
  assert.ok(normalized.includes('a product or service whose value derives, entirely or substantially, from the functionality of the Software.'));
  assert.ok(normalized.includes('Any license notice or attribution required by the License must also include this Commons Clause License Condition notice.'));
  assert.ok(normalized.includes('Copyright (c) 2026 Justin Chen'));
  assert.ok(normalized.includes('THE SOFTWARE IS PROVIDED "AS IS"'));
});

test('package and plugin manifests do not advertise unmodified MIT licensing', () => {
  assert.equal(JSON.parse(read('package.json')).license, 'SEE LICENSE IN LICENSE');
  for (const file of ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json']) {
    assert.equal(JSON.parse(read(file)).license, 'MIT with Commons Clause v1.0', file);
  }
});

test('each independently installable skill carries the complete combined license', () => {
  const skills = fs.readdirSync(path.join(root, 'skills'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory());
  assert.ok(skills.length > 0);
  for (const { name } of skills) {
    const dir = `skills/${name}`;
    assert.equal(read(`${dir}/LICENSE`), license, `${dir}/LICENSE must match the root license`);
    assert.equal(parseFrontmatter(read(`${dir}/SKILL.md`)).data.license,
      'MIT with Commons Clause v1.0 (see LICENSE)', `${dir}/SKILL.md`);
  }
});
