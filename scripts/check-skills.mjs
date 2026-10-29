#!/usr/bin/env node
// Repository consistency and privacy checks.
//
//   node scripts/check-skills.mjs [--root <dir>]
//
// Checks: skill frontmatter (name, description, version), SKILL.md length,
// relative Markdown links, version consistency across manifests, reviewer
// agent definitions in sync with the shared prompt, and a privacy scan for
// personal paths, emails and token-like strings. Terms listed one per line in
// an untracked `.privacy-denylist` file are also rejected, so maintainers can
// scan for private names without publishing them.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MAX_SKILL_LINES = 500;
const MAX_DESCRIPTION = 1024;
const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const TEXT_EXT = new Set(['.md', '.mjs', '.js', '.json', '.yml', '.yaml', '.txt', '.toml', '.sh']);
const SKIP_DIRS = new Set(['.git', 'node_modules']);

const PRIVACY_PATTERNS = [
  { name: 'macOS home path', re: /\/Users\/(?!<)[A-Za-z0-9._-]+\//g },
  { name: 'Linux home path', re: /\/home\/(?!user\/|<)[a-z][a-z0-9._-]*\//g },
  { name: 'Windows home path', re: /[A-Z]:\\Users\\[^\\\s]+\\/g },
  { name: 'email address', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z][A-Za-z.]+/g },
  { name: 'API key', re: /\b(sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{30,}|AIza[0-9A-Za-z_-]{30,})\b/g },
];
const EMAIL_ALLOW = [/@example\.(com|org)$/i, /^noreply@/i];

export function parseFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return null;
  const data = {};
  let parent = null;
  for (const line of m[1].split('\n')) {
    if (!line.trim()) continue;
    const nested = line.match(/^\s+([A-Za-z0-9_-]+):\s*(.*)$/);
    const top = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (top) {
      const [, key, raw] = top;
      if (raw === '') {
        data[key] = {};
        parent = key;
      } else {
        data[key] = unquote(raw);
        parent = null;
      }
    } else if (nested && parent) {
      data[parent][nested[1]] = unquote(nested[2]);
    }
  }
  return { data, bodyStart: m[0].length };
}

function unquote(v) {
  const t = v.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1);
  return t;
}

export function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

export function checkSkills(root) {
  const errors = [];
  const skillsDir = path.join(root, 'skills');
  const skills = [];
  for (const name of fs.existsSync(skillsDir) ? fs.readdirSync(skillsDir) : []) {
    const dir = path.join(skillsDir, name);
    if (!fs.statSync(dir).isDirectory()) continue;
    const file = path.join(dir, 'SKILL.md');
    if (!fs.existsSync(file)) {
      errors.push(`skills/${name}: missing SKILL.md`);
      continue;
    }
    const text = fs.readFileSync(file, 'utf8');
    const fm = parseFrontmatter(text);
    if (!fm) {
      errors.push(`skills/${name}/SKILL.md: missing YAML frontmatter`);
      continue;
    }
    const { data } = fm;
    if (data.name !== name) errors.push(`skills/${name}/SKILL.md: name "${data.name}" must equal directory name`);
    if (!NAME_RE.test(data.name || '') || (data.name || '').length > 64) {
      errors.push(`skills/${name}/SKILL.md: name must be lowercase words joined by hyphens, max 64 chars`);
    }
    const desc = data.description || '';
    if (!desc) errors.push(`skills/${name}/SKILL.md: description is required`);
    if (desc.length > MAX_DESCRIPTION) errors.push(`skills/${name}/SKILL.md: description is ${desc.length} chars (max ${MAX_DESCRIPTION})`);
    if (/[<>]/.test(desc)) errors.push(`skills/${name}/SKILL.md: description must not contain angle brackets`);
    const lines = text.split('\n').length;
    if (lines > MAX_SKILL_LINES) errors.push(`skills/${name}/SKILL.md: ${lines} lines (max ${MAX_SKILL_LINES}); move detail to references/`);
    skills.push({ name, version: data.metadata?.version });
  }
  if (skills.length === 0) errors.push('no skills found under skills/');
  return { errors, skills };
}

export function checkLinks(root, files) {
  const errors = [];
  for (const file of files.filter((f) => f.endsWith('.md'))) {
    const text = fs.readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '');
    for (const m of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const target = m[1];
      if (/^(https?:|mailto:|#)/.test(target)) continue;
      const clean = decodeURIComponent(target.split('#')[0]);
      if (!clean) continue;
      if (!fs.existsSync(path.resolve(path.dirname(file), clean))) {
        errors.push(`${path.relative(root, file)}: broken link ${target}`);
      }
    }
  }
  return errors;
}

export function checkVersions(root, skills) {
  const errors = [];
  const versions = {};
  const read = (rel) => {
    const p = path.join(root, rel);
    return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
  };
  for (const rel of ['package.json', '.claude-plugin/plugin.json', '.codex-plugin/plugin.json']) {
    const json = read(rel);
    if (json) versions[rel] = json.version;
  }
  for (const s of skills) versions[`skills/${s.name}`] = s.version;
  const distinct = new Set(Object.values(versions));
  if (distinct.size > 1) {
    errors.push(`versions differ: ${Object.entries(versions).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  }
  return errors;
}

export function extractReviewerPrompt(text) {
  const m = text.match(/<!-- reviewer-prompt:begin -->\n([\s\S]*?)\n<!-- reviewer-prompt:end -->/);
  return m ? m[1] : null;
}

export function checkAgents(root) {
  const errors = [];
  const promptFile = path.join(root, 'skills/subagent-team/references/reviewer-prompt.md');
  const agentsDir = path.join(root, 'agents');
  if (!fs.existsSync(promptFile) || !fs.existsSync(agentsDir)) return errors;
  const prompt = extractReviewerPrompt(fs.readFileSync(promptFile, 'utf8'));
  if (!prompt) return ['reviewer-prompt.md: missing reviewer-prompt markers'];
  for (const name of fs.readdirSync(agentsDir).filter((f) => f.endsWith('.md'))) {
    const text = fs.readFileSync(path.join(agentsDir, name), 'utf8');
    const fm = parseFrontmatter(text);
    if (!fm || !fm.data.name || !fm.data.description) {
      errors.push(`agents/${name}: frontmatter needs name and description`);
      continue;
    }
    if (fm.data.permissionMode) errors.push(`agents/${name}: permissionMode is ignored for plugin agents; remove it`);
    const body = text.slice(fm.bodyStart).trim();
    if (name.startsWith('team-reviewer') && body !== prompt.trim()) {
      errors.push(`agents/${name}: body differs from skills/subagent-team/references/reviewer-prompt.md`);
    }
  }
  return errors;
}

export function loadDenylist(root) {
  const p = path.join(root, '.privacy-denylist');
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
}

export function checkPrivacy(root, files, denylist = []) {
  const errors = [];
  for (const file of files) {
    const rel = path.relative(root, file);
    if (rel === '.privacy-denylist' || !TEXT_EXT.has(path.extname(file))) continue;
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      for (const { name, re } of PRIVACY_PATTERNS) {
        for (const m of line.matchAll(re)) {
          if (name === 'email address' && EMAIL_ALLOW.some((a) => a.test(m[0]))) continue;
          errors.push(`${rel}:${i + 1}: ${name}: ${m[0]}`);
        }
      }
      const lower = line.toLowerCase();
      for (const term of denylist) {
        if (lower.includes(term.toLowerCase())) errors.push(`${rel}:${i + 1}: denylisted term "${term}"`);
      }
    });
  }
  return errors;
}

export function runChecks(root) {
  const files = walk(root);
  const { errors: skillErrors, skills } = checkSkills(root);
  return [
    ...skillErrors,
    ...checkLinks(root, files),
    ...checkVersions(root, skills),
    ...checkAgents(root),
    ...checkPrivacy(root, files, loadDenylist(root)),
  ];
}

function main(argv) {
  const i = argv.indexOf('--root');
  const root = path.resolve(i >= 0 ? argv[i + 1] : path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
  const errors = runChecks(root);
  if (errors.length) {
    console.error(errors.map((e) => `✗ ${e}`).join('\n'));
    console.error(`\n${errors.length} problem(s) found.`);
    process.exit(1);
  }
  console.log('✓ all checks passed');
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main(process.argv.slice(2));
}
