/* tools/verify.js — 规格 §八.1 验收：抽出 script 块 → node --check → require 纯函数 → 空项目 Agent 必过测试 */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'novel-studio.html'), 'utf8');
const m = html.match(/<script>([\s\S]*)<\/script>/);   // 贪婪匹配，等价规格里的 re.S
if (!m) { console.error('FATAL: 未找到内联 script 块'); process.exit(1); }
const cjsPath = path.join(root, 'tmp-f.cjs');
fs.writeFileSync(cjsPath, m[1], 'utf8');
cp.execFileSync(process.execPath, ['--check', cjsPath], { stdio: 'inherit' });
console.log('抽出块 node --check ✓', (m[1].length / 1024).toFixed(1) + ' KB');

const M = require(cjsPath);
console.log('exports:', Object.keys(M).join(', '));
const mdOut = M.md('### t\n- a\n> q');
console.log('md() →', JSON.stringify(mdOut));
if (!/<h3>t<\/h3>/.test(mdOut) || !/<li>a<\/li>/.test(mdOut) || !/<blockquote>q<\/blockquote>/.test(mdOut)) {
  console.error('FAIL: md 输出不符合预期'); process.exit(1);
}
console.log('esc() →', M.esc('<b>&"'));
console.log('wordCount("你好world 123") →', M.wordCount('你好world 123'));

const routes = [['你好', 'greet'], ['帮我续写下一章', 'continue'], ['分析周曼这个人物', 'char'],
  ['伏笔回收情况', 'foreshadow'], ['节奏诊断', 'rhythm'], ['润色这段', 'polish'],
  ['卡文了怎么办', 'stuck'], ['给角色取名', 'naming'], ['今天天气不错', 'fallback']];
let routeFail = 0;
routes.forEach(function (r) {
  const got = M.route(r[0]);
  const ok = got === r[1];
  if (!ok) routeFail++;
  console.log((ok ? '✓' : '✗') + ' route(' + r[0] + ') → ' + got + (ok ? '' : '（期望 ' + r[1] + '）'));
});

/* 空项目必过测试：全部 intent 不得泄漏主样本专名，且走引导分支 */
const data = M.seedData();
const empty = data.projects[2];
const sampleNames = ['沈聿', '周曼', '老周', '陈默', '沈国', '雾港', '乌江', '北礁', '阿岚', '方竞行', '小泥鳅', '莫干', '听雨', '班叔', '雷峰'];
const intents = ['greet', 'continue', 'char', 'foreshadow', 'rhythm', 'polish', 'stuck', 'naming', 'fallback'];
const leaks = [];
intents.forEach(function (it) {
  const r = M.compose(empty, it, it === 'char' ? '分析人物' : '');
  const blob = r.answer + ' ' + r.think.join(' ') + ' ' + r.tools.map(function (t) { return t.result; }).join(' ');
  sampleNames.forEach(function (n) { if (blob.indexOf(n) >= 0) leaks.push(it + '→' + n); });
  console.log('空项目 ' + it + '：回复 ' + r.answer.length + ' 字，工具 ' + r.tools.length + ' 个');
});
console.log(leaks.length ? 'FAIL 专名泄漏: ' + leaks.join('; ') : '空项目无专名泄漏 ✓');

/* 主样本：回复必须引用真实数据 */
const p1 = data.projects[0];
const rc = M.compose(p1, 'continue', '续写');
const rf = M.compose(p1, 'foreshadow', '梳理伏笔');
console.log('主样本续写开头：', rc.answer.slice(0, 50).replace(/\n/g, ' '));
console.log('主样本伏笔工具：', rf.tools[0].result);
if (rc.answer.indexOf('雾港夜航') < 0 && rc.answer.indexOf('CH.') < 0) { console.error('FAIL: 续写未引用项目数据'); process.exit(1); }

if (routeFail || leaks.length) { console.error('VERIFY FAILED'); process.exit(1); }
console.log('ALL VERIFY PASSED');