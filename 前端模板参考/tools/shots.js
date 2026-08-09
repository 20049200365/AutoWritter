/* tools/shots.js — 逐模块驱动截图（规格 §八.2） */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const root = path.join(__dirname, '..');
const shotsDir = path.join(root, 'shots');
if (!fs.existsSync(shotsDir)) fs.mkdirSync(shotsDir);
const html = fs.readFileSync(path.join(root, 'novel-studio.html'), 'utf8');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const ERRB = '<script>\nwindow.addEventListener("error",e=>{const d=document.createElement("div");\nd.style.cssText="position:fixed;inset:0 0 auto 0;z-index:9999;background:#c00;color:#fff;font:12px monospace;padding:6px";\nd.textContent="JS ERROR: "+e.message+" @"+e.lineno;document.body.appendChild(d)});</script>';
const NOANIM = '<style>*{animation:none!important;transition:none!important}</style>';

const cases = [
  { name: '01-shelf', w: 1560, h: 1000, budget: 4000, driver: '' },
  { name: '02-chat', w: 1560, h: 1000, budget: 4000, driver: "__ns.state.tab='chat';__ns.renderAll();" },
  { name: '03-text-read', w: 1560, h: 1000, budget: 4000, driver: "__ns.state.tab='text';__ns.state.selCh=1;__ns.state.textMode='read';__ns.renderAll();" },
  { name: '04-text-edit', w: 1560, h: 1000, budget: 4000, driver: "__ns.state.tab='text';__ns.state.selCh=2;__ns.state.textMode='edit';__ns.renderAll();" },
  { name: '05-chars', w: 1560, h: 1000, budget: 4000, driver: "__ns.state.tab='chars';__ns.state.selChar='c1a';__ns.renderAll();" },
  { name: '06-outline-struct', w: 1560, h: 1000, budget: 4000, driver: "__ns.state.tab='outline';__ns.state.outlineView='struct';__ns.renderAll();" },
  { name: '07-outline-fsp', w: 1560, h: 1000, budget: 4000, driver: "__ns.state.tab='outline';__ns.state.outlineView='fsp';__ns.renderAll();" },
  { name: '08-world', w: 1560, h: 1000, budget: 4000, driver: "__ns.state.tab='world';__ns.renderAll();" },
  { name: '09-board', w: 1560, h: 1000, budget: 5000, driver: "__ns.state.tab='board';__ns.renderAll();" },
  { name: '10-new-project', w: 1560, h: 1000, budget: 4000, driver: "__ns.modalNewProject();" },
  { name: '11-del-project', w: 1560, h: 1000, budget: 4000, driver: "__ns.modalDelProject();" },
  { name: '12-streaming', w: 1560, h: 1000, budget: 2000, driver: "__ns.state.tab='chat';__ns.renderAll();__ns.sendChat('帮我续写下一章');" },
  { name: '13-rewrite-diff', w: 1560, h: 1000, budget: 4000, driver:
    "__ns.state.tab='text';__ns.state.textMode='edit';__ns.state.selCh=2;__ns.renderAll();" +
    "var __p=__ns.state.projects[0];var __ms=null;__p.chapters.forEach(function(c){if(c.no===2)__ms=c});" +
    "var __b=__ms.text.slice(0,90);" +
    "__ns.state.diff={op:'expand',start:0,end:90,before:__b,after:__ns.rewriteText(__b,'expand',__p.genre,0),seed:0};" +
    "__ns.openDiff();" },
  { name: '14-palette', w: 1560, h: 1000, budget: 4000, driver: "__ns.state.palette.open=true;__ns.state.palette.q='雨衣';__ns.renderPalette();" },
  { name: '15-empty-chat', w: 1560, h: 1000, budget: 4000, driver: "__ns.switchProject('p3');__ns.state.tab='chat';__ns.renderAll();" },
  { name: '16-inspect', w: 1560, h: 1000, budget: 6000, driver: "__ns.state.tab='outline';__ns.state.outlineView='fsp';__ns.renderAll();__ns.runInspect();" },
  { name: '17-narrow-1000', w: 1000, h: 900, budget: 4000, driver: "__ns.state.tab='text';__ns.state.selCh=1;__ns.state.textMode='read';__ns.renderAll();" },
  { name: '18-narrow-760', w: 760, h: 900, budget: 4000, driver: "__ns.state.tab='text';__ns.state.selCh=1;__ns.state.textMode='read';__ns.renderAll();" },
  { name: '19-empty-shelf', w: 1560, h: 1000, budget: 4000, driver: "__ns.state.projects.length=0;__ns.state.activeId=null;__ns.state.tab='chat';__ns.renderAll();" },
  { name: '20-draft-input', w: 1560, h: 1000, budget: 4000, driver: "__ns.state.tab='text';__ns.state.selCh=4;__ns.renderAll();__ns.draftChapter(4);__ns.renderAll();" }
];

const only = process.argv[2] ? process.argv.slice(2) : null;
function sleep(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
for (const c of cases) {
  if (only && !only.includes(c.name)) continue;
  const caseHtml = html.replace('</body>',
    ERRB + NOANIM + '<script>\nwindow.addEventListener("DOMContentLoaded",function(){\n' + c.driver + '\n});\n</script>\n</body>');
  const casePath = path.join(shotsDir, 'case-' + c.name + '.html');
  const png = path.join(shotsDir, c.name + '.png');
  fs.writeFileSync(casePath, caseHtml, 'utf8');
  const url = 'file:///' + casePath.replace(/\\/g, '/');
  if (fs.existsSync(png)) fs.unlinkSync(png);
  /* chrome 退出码在各平台不可靠：以产物为准，轮询等待 png 落盘 */
  cp.spawnSync(CHROME, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars',
    '--virtual-time-budget=' + c.budget,
    '--window-size=' + c.w + ',' + c.h,
    '--screenshot=' + png, url
  ], { stdio: 'ignore', timeout: 60000 });
  let ok = false;
  for (let i = 0; i < 40 && !ok; i++) {
    ok = fs.existsSync(png) && fs.statSync(png).size > 0;
    if (!ok) sleep(200);
  }
  if (ok) console.log('✓', c.name, fs.statSync(png).size + ' B');
  else console.error('✗', c.name, 'no png');
}