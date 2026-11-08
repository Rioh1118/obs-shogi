// npm run ds:eval [-- --dry-run] [-- <claude plugin eval のオプション>]
//
// --dry-run : API を使わない。ケースの形式、索引（evals.json）との整合、files/CLAUDE.md の同期、
//             regex 採点の自己テスト（examples/good は合格・examples/bad は不合格）を確かめる。
// それ以外  : claude plugin eval でスキルあり／なしを実行する（実費がかかる）。
//             結果は evals/results/<timestamp>/（git 管理外）。比べたい結果は evals/baselines/ に写す。
import { spawnSync } from 'node:child_process';
import { ROOT } from './lib/tokens.mjs';
import { checkEvals, syncCaseFiles, selfTestGraders } from './lib/evals.mjs';

const args = process.argv.slice(2);
const dry = args.includes('--dry-run');

syncCaseFiles();
const errors = checkEvals();
const selfTest = selfTestGraders();
console.log('ケースの形式と索引:', errors.length ? '✘' : '✔');
for (const e of errors) console.log('  -', e);
console.log('regex 採点の自己テスト（good で合格 / bad で不合格）:');
for (const r of selfTest) console.log(`  ${r.ok ? '✔' : '✘'} ${r.id}  good=${r.good ? '合格' : '不合格'} bad=${r.bad ? '合格' : '不合格'}`);
const bad = errors.length > 0 || selfTest.some((r) => !r.ok);
if (dry || bad) process.exit(bad ? 1 : 0);

const passthrough = args.filter((a) => a !== '--dry-run');
const cmd = ['plugin', 'eval', '.', '--trust-plugin', '--scaffold', '--no-publish', '--allow-tools', 'Write,Edit,Bash', ...passthrough];
console.log(`\n$ claude ${cmd.join(' ')}`);
const r = spawnSync('claude', cmd, { cwd: ROOT, stdio: 'inherit' });
process.exit(r.status ?? 1);
