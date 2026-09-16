import { spawnSync } from 'node:child_process';

const proxy = process.argv[2] === 'proxy';
const loader = proxy ? ['--import', 'tsx/esm'] : [];
const checks = `
  const assert = require('node:assert/strict');
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec('CREATE TABLE sample (id INTEGER PRIMARY KEY, value TEXT)');
  db.transaction(() => db.prepare('INSERT INTO sample(value) VALUES (?)').run('literal $key'))();
  assert.equal(db.prepare('SELECT value FROM sample').get().value, 'literal $key');
  assert.equal(db.pragma('integrity_check', {simple:true}), 'ok');
  db.close();
  ${proxy ? "require('node-pty');" : "require('@node-rs/jieba');"}
`;
for (let iteration = 0; iteration < 20; iteration++) {
  // Repeated process teardown catches the intermittent Node 24/V8 addon crash.
  const teardown = "require('better-sqlite3')(':memory:').close();" + (proxy ? "require('node-pty');" : '');
  const result = spawnSync(process.execPath, [...loader, '-e', iteration === 0 ? checks : teardown], { cwd: '/app', encoding: 'utf8', timeout: 15_000 });
  if (result.error || result.status !== 0) throw new Error(`Native smoke ${iteration + 1}/20 failed: ${result.error?.message ?? result.stderr}`);
}
console.log(`Native SQLite${proxy ? '/PTY/TypeScript' : '/jieba'} checks and 20 clean process exits passed`);
