const fs = require('fs');
let s = fs.readFileSync('src/app.js', 'utf8');
const anchor = /finishStream: finishStream,\r?\n\s*compose: compose,\r?\n\s*route: route\r?\n\s*\};/;
if (!anchor.test(s)) { console.error('anchor not found'); process.exit(1); }
s = s.replace(anchor, 'finishStream: finishStream,\n    compose: compose,\n    route: route,\n    openDiff: openDiff,\n    rewriteText: rewriteText,\n    renderPalette: renderPalette,\n    modalAddForeshadow: modalAddForeshadow,\n    modalAddChar: modalAddChar,\n    modalAddEntry: modalAddEntry\n  };');
fs.writeFileSync('src/app.js', s, 'utf8');
console.log('__ns patched');