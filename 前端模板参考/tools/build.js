/* tools/build.js — 读三个源文件 → node --check → 内联成 novel-studio.html */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const root = path.join(__dirname, '..');
const shellPath = path.join(root, 'src', 'shell.html');
const dataPath = path.join(root, 'src', 'data.js');
const appPath = path.join(root, 'src', 'app.js');
const outPath = path.join(root, 'novel-studio.html');

for (const f of [dataPath, appPath]) {
  cp.execFileSync(process.execPath, ['--check', f], { stdio: 'inherit' });
  console.log('node --check OK:', path.basename(f));
}
const shell = fs.readFileSync(shellPath, 'utf8');
const data = fs.readFileSync(dataPath, 'utf8');
const app = fs.readFileSync(appPath, 'utf8');

for (const [name, src] of [['data.js', data], ['app.js', app]]) {
  if (/<\/script/i.test(src)) {
    console.error('FATAL: ' + name + ' 中含有 </script>，内联会截断脚本块');
    process.exit(1);
  }
}
console.log('no </script> in JS ✓');

const inline = '<script>\n' + data + '\n;\n' + app + '\n</script>';
const pattern = /<script src="data\.js"><\/script>\s*<script src="app\.js"><\/script>/;
if (!pattern.test(shell)) { console.error('FATAL: shell.html 缺少占位 script 标签'); process.exit(1); }
const out = shell.replace(pattern, inline);
fs.writeFileSync(outPath, out, 'utf8');
console.log('built:', outPath, (out.length / 1024).toFixed(1) + ' KB');