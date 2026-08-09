
/* ============================================================
 * data.js — mock 数据层 + Agent 回复模板
 * 纯数据、纯函数，不触碰 DOM。所有回复模板只从传入的 project 取专名。
 * ============================================================ */

/* ---------- 通用常量 ---------- */
var GENRES = ['悬疑', '玄幻', '科幻', '日常'];
var GENRE_COLORS = { '悬疑': '#40635c', '玄幻': '#7c5f8f', '科幻': '#55504a', '日常': '#b98a45' };
var POV_LIST = ['第一人称', '第三人称', '全知视角'];
var TONE_LIST = ['沉郁', '治愈', '热血', '古意', '孤独', '浪漫', '轻快', '克制'];
var CH_STATUS = ['构思', '大纲', '草稿', '待修', '定稿'];
var FS_STATES = ['已埋设', '部分揭示', '已回收', '悬空'];
var REL_TYPES = {
  '血缘': { color: '#a8433a', dash: '' },
  '亲和': { color: '#6f8f62', dash: '' },
  '对抗': { color: '#b98a45', dash: '7 4' },
  '秘密': { color: '#7c5f8f', dash: '2 4' },
  '师徒': { color: '#40635c', dash: '9 3' },
  '造物': { color: '#55504a', dash: '1 4' }
};
var WORLD_CATS = ['地理', '势力', '力量体系', '器物', '名词', '习俗', '档案'];
var HONEST_NOTE = '本页所有作品与数据均为虚构演示，仅存于内存，刷新即重置。';

/* ---------- 纯函数工具（供 Node 单测导出） ---------- */
function fmtCh(no) { return 'CH.' + String(no).padStart(2, '0'); }
function wordCount(s) {
  if (!s) return 0;
  var cjk = (s.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g) || []).length;
  var latin = (s.match(/[A-Za-z0-9]+/g) || []).length;
  return cjk + latin;
}
function projStats(p) {
  var plan = 0;
  p.volumes.forEach(function (v) { plan += v.items.length; });
  var words = 0;
  p.chapters.forEach(function (c) { words += wordCount(c.text); });
  var done = 0, dangling = 0;
  p.foreshadows.forEach(function (f) {
    if (f.state === '已回收') done++;
    if (f.state === '悬空') dangling++;
  });
  return {
    plan: plan, written: p.chapters.length, words: words,
    chars: p.chars.length, rels: p.relations.length,
    fsp: p.foreshadows.length, fspDone: done, fspDangling: dangling,
    entries: p.entries.length, events: p.events.length,
    sessions: p.sessions.length, gap: Math.max(0, plan - p.chapters.length)
  };
}
function lastWritten(p) {
  if (!p.chapters.length) return null;
  return p.chapters.slice().sort(function (a, b) { return b.no - a.no; })[0];
}
function protagonistOf(p) {
  var c = null;
  p.chars.forEach(function (x) { if (/主角/.test(x.role)) c = x; });
  return c || p.chars[0] || null;
}
function pro(char) { return char && char.gender === '女' ? '她' : '他'; }
function findChapter(p, no) {
  var r = null;
  p.chapters.forEach(function (c) { if (c.no === no) r = c; });
  return r;
}
function findOutline(p, no) {
  var r = null;
  p.volumes.forEach(function (v) { v.items.forEach(function (it) { if (it.no === no) r = { item: it, vol: v }; }); });
  return r;
}
function plateaus(p) {
  var items = [];
  p.volumes.forEach(function (v) { items = items.concat(v.items); });
  items.sort(function (a, b) { return a.no - b.no; });
  var out = [];
  for (var i = 0; i + 2 < items.length; i++) {
    var a = items[i], b = items[i + 1], c = items[i + 2];
    if (Math.abs(a.tension - b.tension) <= 1 && Math.abs(b.tension - c.tension) <= 1 && Math.abs(a.tension - c.tension) <= 1) {
      out.push([a.no, b.no, c.no]);
      i += 2;
    }
  }
  return out;
}

/* ---------- 续写风格库（按题材，不含任何作品专名） ---------- */
var CONT_TPL = {
  '悬疑': [
    '雾还没有散。{主角}把最后一张纸条压进桌角，指节在灯下泛着青白。窗外，渡轮的汽笛响了一声，很短，像有人把半句话咽了回去。',
    '{他她}忽然明白，这座镇上每个人都只说一半。剩下的一半，藏在潮汐里，藏在二十年没人敢翻的纸页里。{他她}合上灯，听见走廊尽头传来极轻的脚步声——停了，又退回去。',
    '「谁？」{他她}问。没有人应。只有门缝下，慢慢渗进来一线潮湿的雾。'
  ],
  '玄幻': [
    '雷声又滚过山脊。{主角}把手按在剑身上，铁胎里的震颤顺着掌心爬上来，像一句没说完的话。',
    '炉火映着{他她}的眉骨。铸剑的人听不见雷，却能听见金属里最细的那一丝颤——那是剑在认人。{他她}低声说：「再忍一夜。天亮之前，我给你一个名字。」',
    '剑身轻轻一鸣。山门外，三百年来不曾停过的雷，忽然静了。'
  ],
  '科幻': [
    '晨昏线又向极点移了一公里。{主角}把最后一封信压进舱门缝，封口的胶在低温里发出细响。',
    '这颗星球没有夜晚，也没有回信的人。{他她}沿着环形山的阴影走，呼吸在面罩上结霜。送信的人不需要地址，只需要方向。',
    '远处，废弃中继站的灯闪了一下。{他她}停下脚步——二十年了，那盏灯第一次亮。'
  ],
  '日常': [
    '傍晚的长街亮起了第一盏灯。{主角}把店门口的黑板翻过来，粉笔字被下午的雨洇开了一角。',
    '「明天见。」{他她}对街角喊了一声。没有人应，但二楼的窗帘动了动。{他她}笑了笑，拉下卷帘门。',
    '日子就是这样过的：一点点声响，一点点光，中间还能发一会儿呆。'
  ],
  '通用': [
    '天色暗下来的时候，{主角}仍坐在原处。手里的纸页被风掀起一角，又落下。',
    '{他她}想起白天那句没接住的话，忽然有了另一种答法。可惜说出口的话收不回，只有笔还可以重来。',
    '灯亮起来。{他她}摊开本子，在第一行写下：「从这里重新开始。」'
  ]
};

/* ---------- 取名素材库（按题材） ---------- */
var NAME_BANK = {
  '悬疑': {
    surname: ['沈', '周', '陈', '顾', '骆', '段'],
    given: ['听澜', '望舒', '其琛', '晚舟', '默存', '知微'],
    item: ['旧船票', '潮汐表', '灯塔日志', '第六张合影', '无名雨衣', '缺页档案'],
    place: ['北礁', '雾港', '乌江口', '西码头', '档案馆']
  },
  '玄幻': {
    surname: ['莫', '闻', '聂', '澹台', '百里', '云'],
    given: ['听雨', '断弦', '惊蛰', '无锋', '栖迟', '问雷'],
    item: ['雷纹剑范', '洗剑池', '火浣布', '听铁诀', '无名剑冢'],
    place: ['雷峰', '剑洗城', '千炉坊', '断雁崖']
  },
  '科幻': {
    surname: ['林', '江', '白', '陆', '秦', '卫'],
    given: ['拾一', '远航', '未名', '临汐', '溯光', '缄默'],
    item: ['潮汐信标', '晨昏线邮局', '休眠舱', '最后一班中继'],
    place: ['永昼城', '极点站', '环形山七号', '旧殖民署']
  },
  '日常': {
    surname: ['苏', '温', '程', '许', '黎', '方'],
    given: ['小满', '晚晴', '阿禾', '知夏', '一苇', '安歌'],
    item: ['黑板报', '旧单车', '巷子口的灯', '雨天招牌'],
    place: ['长街', '西巷', '旧车站', '河堤']
  },
  '通用': {
    surname: ['林', '沈', '顾', '周'],
    given: ['未名', '知远', '清和', '以宁'],
    item: ['旧笔记', '缺角的信'],
    place: ['老城', '南巷']
  }
};

/* ============================================================
 * Agent 回复引擎模板：全部 (project, ctx) 数据驱动
 * 返回 { think:[], tools:[{name,args,result}], answer }
 * 模板中不出现任何具体作品的专有名词，全部从 p 中读取。
 * ============================================================ */
var REPLY_MAKERS = {

  greet: function (p, ctx) {
    var st = projStats(p);
    var tools = [{ name: 'stat_summary', args: 'project=' + p.title, result: '章节 ' + st.written + '/' + st.plan + ' · 正文 ' + st.words + ' 字 · 人物 ' + st.chars + ' · 伏笔 ' + st.fsp + ' · 设定 ' + st.entries }];
    var think = ['识别为开场问候，先盘点《' + p.title + '》的家底。', '统计口径：章节、字数、人物、伏笔、设定五项。'];
    var ans;
    if (st.plan === 0 && st.chars === 0) {
      ans = '你好，我是你的创作助手。《' + p.title + '》现在还是一册空白的本子——**0 章大纲、0 个人物、0 条伏笔**。\n\n别急，按三步把它撑起来：\n\n- **第一步**：到「大纲与伏笔」建第一卷，哪怕先排 3 章节拍；\n- **第二步**：到「人物关系」登记主角，写清「想要什么」与「真正需要什么」；\n- **第三步**：埋第一条伏笔，让它在前两章露头。\n\n' + (p.brief ? '你登记的一句话简介是：\n\n> ' + p.brief + '\n\n' : '') + '先从哪一步开始？';
    } else {
      ans = '你好。《' + p.title + '》（' + p.genre + ' · ' + p.pov + '）目前在案：**大纲 ' + st.plan + ' 章，已写 ' + st.written + ' 章，正文 ' + st.words + ' 字，人物 ' + st.chars + ' 位，伏笔 ' + st.fsp + ' 条**。\n\n我可以帮你：续写、分析人物、梳理伏笔、诊断节奏、润色、卡文疏导、取名。\n\n' + (p.brief ? '> ' + p.brief + '\n\n' : '') + '直接说要做什么，或点下方的快捷指令。';
    }
    return { think: think, tools: tools, answer: ans };
  },

  continue: function (p, ctx) {
    var st = projStats(p);
    if (!st.written) {
      var hint = st.plan > 0
        ? '《' + p.title + '》还没有正文，但大纲里已经排了 ' + st.plan + ' 章。推荐先起草 **CH.01**：' + (p.volumes[0] && p.volumes[0].items[0] ? '「' + p.volumes[0].items[0].title + '」的节拍是「' + p.volumes[0].items[0].beat + '」。' : '') + '\n\n你可以在「正文」模块点「让 Agent 起草本章」，或者先告诉我开场想要的画面。'
        : '《' + p.title + '》还没有任何正文，也还没有大纲。续写无从下手——先去「大纲与伏笔」建第一卷，排出前三章的节拍，再回来找我起草。';
      return {
        think: ['检查正文存量：0 章。', '走引导分支：说明缺口与下一步。'],
        tools: [{ name: 'fetch_chapters', args: 'with_text=true', result: '已写章节 共 0 章' }],
        answer: hint
      };
    }
    var last = lastWritten(p);
    var pc = protagonistOf(p);
    var tpl = CONT_TPL[p.genre] || CONT_TPL['通用'];
    var pronoun = pc ? pro(pc) : '他';
    var heroName = pc ? pc.name : '主角';
    var draft = tpl.map(function (s) {
      return s.split('{主角}').join(heroName).split('{他她}').join(pronoun);
    }).join('\n\n');
    var press = p.genre === '悬疑' ? '冷' : p.genre === '玄幻' ? '燃' : p.genre === '科幻' ? '静' : '轻';
    // 实体感知：用户点名某章 → 取该章；该章未写 → 按节拍起草
    if (ctx.chNo) {
      var msx = findChapter(p, ctx.chNo);
      var olx = findOutline(p, ctx.chNo);
      if (msx && msx.text) {
        var tx = msx.text.replace(/\s+/g, '').slice(-60);
        return {
          think: ['用户点名 ' + fmtCh(ctx.chNo) + '，取该章结尾（而非最后写章）。', '题材「' + p.genre + '」，套用对应语气与意象；人物从 ' + heroName + ' 的视角走。'],
          tools: [{ name: 'fetch_chapter', args: 'no=' + ctx.chNo + '&tail=60', result: fmtCh(ctx.chNo) + '「' + msx.title + '」全文 ' + wordCount(msx.text) + ' 字，已取结尾 ' + tx.length + ' 字' }],
          answer: '接 ' + fmtCh(ctx.chNo) + '「' + msx.title + '」的结尾——\n\n> ……' + tx + '\n\n### 续写草稿（' + p.genre + '语气）\n\n' + draft + '\n\n这是草稿不是定稿：节奏、称谓、与前文的钩子都由你裁夺。要我把哪一段再往' + press + '里压一压？'
        };
      }
      if (olx) {
        return {
          think: ['用户点名 ' + fmtCh(ctx.chNo) + '「' + olx.item.title + '」，该章尚无正文。', '按大纲节拍起草开头；题材「' + p.genre + '」定语气。'],
          tools: [{ name: 'fetch_chapter', args: 'no=' + ctx.chNo, result: fmtCh(ctx.chNo) + ' 未写，已取大纲节拍：' + olx.item.beat }],
          answer: fmtCh(ctx.chNo) + '「' + olx.item.title + '」还没有正文，我按节拍直接起草。\n\n> 节拍：' + olx.item.beat + '\n\n### 起草开头（' + p.genre + '语气）\n\n' + draft + '\n\n节拍的骨头给了，血肉你来。想换切入点，就给我一个画面，我重起开头。'
        };
      }
    }
    var tail = last.text.replace(/\s+/g, '');
    tail = tail.slice(Math.max(0, tail.length - 60));
    return {
      think: [
        '目标：续写。取最后一章 ' + fmtCh(last.no) + '「' + last.title + '」（' + wordCount(last.text) + ' 字）的结尾。',
        '题材「' + p.genre + '」，套用对应语气与意象；人物从 ' + heroName + ' 的视角走。',
        '检查与既有伏笔的衔接，避免抢收。'
      ],
      tools: [{ name: 'fetch_chapter', args: 'no=' + last.no + '&tail=60', result: fmtCh(last.no) + '「' + last.title + '」全文 ' + wordCount(last.text) + ' 字，已取结尾 ' + tail.length + ' 字' }],
      answer: '接 ' + fmtCh(last.no) + ' 的结尾——\n\n> ……' + tail + '\n\n### 续写草稿（' + p.genre + '语气）\n\n' + draft + '\n\n这是草稿不是定稿：节奏、称谓、与前文的钩子都由你裁夺。要我把哪一段再往' + press + '里压一压？'
    };
  },

  char: function (p, ctx) {
    var st = projStats(p);
    if (ctx && ctx.char) {
      var c = ctx.char;
      var rels = [];
      p.relations.forEach(function (r) {
        if (r.a === c.id || r.b === c.id) {
          var otherId = r.a === c.id ? r.b : r.a;
          var other = null;
          p.chars.forEach(function (x) { if (x.id === otherId) other = x; });
          rels.push('- ' + (other ? other.name : '未登记角色') + '：' + r.type + '（' + r.label + '）');
        }
      });
      return {
        think: ['用户点名「' + c.name + '」，调取档案。', '按写作导向输出：形象 / 动机 / 秘密 / 弧光 / 出场。'],
        tools: [{ name: 'char_lookup', args: 'name=' + c.name, result: '命中 1 人：' + c.name + '（' + c.role + '），出场 ' + c.chapters.length + ' 章，关系 ' + rels.length + ' 条' }],
        answer: '### ' + c.name + '（' + c.role + '）\n\n' +
          '- **外在形象**：' + c.look + '\n' +
          '- **表层动机**：' + c.motive + '\n' +
          '- **深层秘密**：' + c.secret + '\n' +
          '- **人物弧光**：' + c.arc + '\n\n' +
          '**想要什么**：' + c.want + '\n**真正需要什么**：' + c.need + '\n\n' +
          '首次出场 ' + fmtCh(c.firstCh) + '，共出场 ' + c.chapters.length + ' 章。' +
          (rels.length ? '\n\n**关系网**：\n' + rels.join('\n') : '') +
          '\n\n「想要」与「需要」正在互相拉扯——写的时候让' + pro(c) + '每次伸手去够前者，都离后者更近一步。'
      };
    }
    if (!st.chars) {
      return {
        think: ['人物库为空，走引导分支。'],
        tools: [{ name: 'char_lookup', args: 'all', result: '人物库 共 0 人' }],
        answer: '《' + p.title + '》还没有登记任何人物。\n\n建议先立两个人：\n\n- **主角**：写清「想要什么」与「真正需要什么」，让两者打架；\n- **对手或镜子**：让主角的秘密在' + pro({ gender: '男' }) + '面前藏不住。\n\n到「人物关系」模块点「新增人物」即可登记。'
      };
    }
    var top = p.chars.slice(0, 3).map(function (c) {
      return '- **' + c.name + '**（' + c.role + '）：想要「' + c.want + '」，需要的却是「' + c.need + '」';
    }).join('\n');
    return {
      think: ['未点名具体人物，输出人物库速览（前 3 位）。'],
      tools: [{ name: 'char_lookup', args: 'all', result: '人物库 共 ' + st.chars + ' 人' }],
      answer: '《' + p.title + '》现有人物 ' + st.chars + ' 位，关系 ' + st.rels + ' 条。前几位的核心拉扯：\n\n' + top + '\n\n点名任何一位，我把完整档案（含深层秘密与弧光）摊开给你。'
    };
  },

  foreshadow: function (p, ctx) {
    var st = projStats(p);
    if (!st.fsp) {
      return {
        think: ['伏笔清单为空，走引导分支。'],
        tools: [{ name: 'scan_foreshadow', args: 'status=all', result: '检索伏笔清单 共 0 条' }],
        answer: '《' + p.title + '》还没有登记伏笔。**检索伏笔清单：共 0 条。**\n\n推荐先埋两条：\n\n- **一条贴着主角**：把主角的一个旧物件写进前两章，先不给解释；\n- **一条贴着世界**：让某个常识显得 slightly 不对劲（比如一个所有人回避的日子）。\n\n到「大纲与伏笔」点「新增伏笔」，不填回收章会自动标为「悬空」。'
      };
    }
    var lines = [];
    var dangling = [], longSpan = [];
    p.foreshadows.forEach(function (f) {
      var span = (f.payCh || 0) - f.plantCh;
      var path = '埋设 ' + fmtCh(f.plantCh) + ' → ' + (f.payCh ? '回收 ' + fmtCh(f.payCh) : '未规划回收');
      lines.push('- ' + f.name + '：' + f.state + '，' + path + (f.payCh ? '（跨度 ' + span + ' 章）' : ''));
      if (f.state === '悬空') dangling.push(f.name);
      if (f.payCh && span > 12) longSpan.push(f.name + '（跨度 ' + span + ' 章）');
    });
    var rate = Math.round(st.fspDone / st.fsp * 100);
    var warn = '';
    if (dangling.length) warn += '\n\n**风险提示**：「' + dangling.join('」「') + '」处于悬空状态，读者会一直惦记。';
    if (longSpan.length) warn += '\n**长跨度预警**：' + longSpan.join('、') + ' 跨度超过 12 章，中途需要补一次「提醒」，否则读者已忘。';
    return {
      think: ['扫描伏笔清单：共 ' + st.fsp + ' 条，已回收 ' + st.fspDone + ' 条。', '检查悬空项与长跨度项。'],
      tools: [{ name: 'scan_foreshadow', args: 'status=all', result: '检索伏笔清单 共 ' + st.fsp + ' 条：已埋设/部分揭示 ' + (st.fsp - st.fspDone - st.fspDangling) + ' · 已回收 ' + st.fspDone + ' · 悬空 ' + st.fspDangling }],
      answer: '《' + p.title + '》伏笔账目（回收率 ' + rate + '%）：\n\n' + lines.join('\n') + warn
    };
  },

  rhythm: function (p, ctx) {
    var st = projStats(p);
    if (!st.plan) {
      return {
        think: ['大纲为空，无从诊断节奏，走引导分支。'],
        tools: [{ name: 'tension_curve', args: 'scope=all', result: '大纲条目 共 0 章，无张力数据' }],
        answer: '《' + p.title + '》还没有大纲，节奏诊断没有抓手。\n\n先建三章也行：给每章一句节拍，顺手打个 1–10 的张力值，我就能告诉你起伏是否健康。'
      };
    }
    var plats = plateaus(p);
    var volAvg = p.volumes.map(function (v) {
      var sum = 0;
      v.items.forEach(function (it) { sum += it.tension; });
      return '- ' + v.name + '（' + fmtCh(v.items[0].no) + '–' + fmtCh(v.items[v.items.length - 1].no) + '）平均张力 ' + (sum / v.items.length).toFixed(1);
    }).join('\n');
    var platTxt = plats.length
      ? plats.map(function (t) { return '**' + fmtCh(t[0]) + '–' + fmtCh(t[2]) + '** 连续三章张力接近（节奏平台期）'; }).join('\n')
      : '没有检测到连续三章张力接近的平台期。';
    return {
      think: ['取全部大纲条目的张力序列。', '滑窗检测平台期（连续 3 章差值 ≤1）。'],
      tools: [{ name: 'tension_curve', args: 'scope=all', result: '条目 ' + st.plan + ' 章；平台期 ' + plats.length + ' 处' }],
      answer: '《' + p.title + '》节奏体检：\n\n' + volAvg + '\n\n**平台期检测**：\n' + platTxt + (plats.length ? '\n\n建议：在平台期中段插一个「小揭示」或「小损失」，把张力垫高一格再走。' : '\n\n整体起伏健康，保持。')
    };
  },

  polish: function (p, ctx) {
    var st = projStats(p);
    if (!st.written) {
      return {
        think: ['无正文，润色无对象，走引导分支。'],
        tools: [{ name: 'fetch_chapters', args: 'with_text=true', result: '已写章节 共 0 章' }],
        answer: '《' + p.title + '》还没有写出的正文，暂时没有可润色的对象。\n\n可以先起草第一章（「正文」模块 →「让 Agent 起草本章」），再选中段落让我润色、精简或改人称。'
      };
    }
    var last = lastWritten(p);
    var head = last.text.replace(/\s+/g, '').slice(0, 48);
    var sents = last.text.split(/。|！|？/).filter(function (s) { return s.length > 0; });
    var longest = '';
    sents.forEach(function (s) { if (s.length > longest.length) longest = s; });
    return {
      think: ['取 ' + fmtCh(last.no) + '「' + last.title + '」开头做样本。', '检测长句：最长句 ' + longest.length + ' 字。'],
      tools: [{ name: 'fetch_chapter', args: 'no=' + last.no + '&head=48', result: fmtCh(last.no) + ' 全文 ' + wordCount(last.text) + ' 字，已取开头 ' + head.length + ' 字' }],
      answer: '以 ' + fmtCh(last.no) + '「' + last.title + '」为例——\n\n> ' + head + '……\n\n三点具体建议：\n\n- **长句**：本章最长句有 ' + longest.length + ' 字，超过 35 字的句子建议从逗号切开，节奏会立起来；\n- **副词**：把「非常、十分、突然」一类删掉一半，让动作自己说话；\n- **对话声口**：给每个说话人留一个口癖或断句习惯，读者不看名字也知道是谁在说。\n\n在「正文」编辑态选中任意段落，我可以当场做润色 / 精简 / 扩写 / 改人称的对照。'
    };
  },

  stuck: function (p, ctx) {
    var st = projStats(p);
    if (!st.plan && !st.written) {
      return {
        think: ['项目空白，卡文其实是「未开始」，走引导分支。'],
        tools: [{ name: 'stat_summary', args: 'project=' + p.title, result: '章节 0/0 · 伏笔 0 · 人物 ' + st.chars }],
        answer: '《' + p.title + '》还没开始——这不叫卡文，叫「白纸恐惧」。\n\n解法只有一个：**先写一句烂的**。到「大纲与伏笔」给 CH.01 写一句节拍，哪怕写「这章我还不知道写什么」，也算动了笔。'
      };
    }
    var next = null;
    p.volumes.forEach(function (v) { v.items.forEach(function (it) {
      if (!next && !findChapter(p, it.no)) next = it;
    }); });
    var tip;
    if (next) {
      tip = '下一章是 **' + fmtCh(next.no) + '「' + next.title + '」**，节拍：「' + next.beat + '」。\n\n别从开头写。挑这章里你**最有画面**的一个瞬间先写三百字，开头回头再补。';
    } else if (st.fspDangling) {
      tip = '大纲章节都已动笔。那就回头收一条悬空伏笔——给「悬空」的那条写一场揭示戏，往往比往前硬推更有劲。';
    } else {
      tip = '往前没有欠账了。回头读一遍自己最满意的那章，找到当时为什么顺，把那个状态找回来。';
    }
    return {
      think: ['卡文疏导：不灌鸡汤，给具体的下一步。', '找第一个未写章节：' + (next ? fmtCh(next.no) : '无') + '。'],
      tools: [{ name: 'stat_summary', args: 'project=' + p.title, result: '已写 ' + st.written + '/' + st.plan + ' 章 · 悬空伏笔 ' + st.fspDangling + ' 条' }],
      answer: '先说结论：**卡住多半不是没得写，是想一步写对。**\n\n' + tip + '\n\n写完这三百字再来找我，我接着给你垫下一步。'
    };
  },

  naming: function (p, ctx) {
    var bank = NAME_BANK[p.genre] || NAME_BANK['通用'];
    var names = [];
    for (var i = 0; i < 6; i++) {
      names.push(bank.surname[i % bank.surname.length] + bank.given[(i + 1) % bank.given.length]);
    }
    var unnamed = [];
    p.chars.forEach(function (c) { if (/未定名|待定/.test(c.name)) unnamed.push(c); });
    var extra = '';
    if (unnamed.length) {
      extra = '\n\n另外，「' + unnamed.map(function (c) { return c.name; }).join('」「') + '」还挂着待定名。' + (p.genre === '悬疑' ? '按本作声口，可考虑：' + bank.surname[0] + bank.given[3] + '、' + bank.surname[2] + bank.given[0] + '。' : '可考虑：' + bank.surname[1 % bank.surname.length] + bank.given[2 % bank.given.length] + '、' + bank.surname[2 % bank.surname.length] + bank.given[4 % bank.given.length] + '。');
    }
    return {
      think: ['题材「' + p.genre + '」，从对应素材库组合。', '检查人物库有无待定名：' + unnamed.length + ' 处。'],
      tools: [{ name: 'name_bank', args: 'genre=' + p.genre, result: '素材库命中：姓 ' + bank.surname.length + ' · 名 ' + bank.given.length + ' · 物 ' + bank.item.length + ' · 地 ' + bank.place.length }],
      answer: '按「' + p.genre + '」的声口拟了一批：\n\n**人名**：' + names.join('、') + '\n**物名 / 线索名**：' + bank.item.join('、') + '\n**地名**：' + bank.place.join('、') + extra + '\n\n看中哪个直接拿走，也可以给我一个方向（冷一点 / 旧一点 / 像个真名），我再拟一轮。'
    };
  },

  fallback: function (p, ctx) {
    var st = projStats(p);
    if (st.plan === 0 && st.written === 0 && st.chars === 0) {
      return {
        think: ['意图不明确，且项目为空，走兜底 + 引导。'],
        tools: [{ name: 'stat_summary', args: 'project=' + p.title, result: '章节 0/0 · 字数 0 · 人物 0 · 伏笔 0' }],
        answer: '这个问题我还接不住。不过《' + p.title + '》目前是空的——**0 章大纲、0 字正文、0 个人物、0 条伏笔**。\n\n不如先做三件事之一：建第一卷大纲 / 登记主角 / 埋第一条伏笔。你也可以用快捷指令里的「续写」「人物」「伏笔」直接点菜。'
      };
    }
    var plats = plateaus(p);
    var gaps = [];
    gaps.push('**待写章节**：' + st.gap + ' 章（大纲 ' + st.plan + '，已写 ' + st.written + '）');
    gaps.push('**悬空伏笔**：' + st.fspDangling + ' 条' + (st.fspDangling ? '，建议尽快安排揭示' : ''));
    gaps.push('**节奏平台期**：' + (plats.length ? plats.map(function (t) { return fmtCh(t[0]) + '–' + fmtCh(t[2]); }).join('、') : '无'));
    gaps.push('**正文总量**：' + st.words + ' 字（目标 ' + p.targetWords.toLocaleString() + ' 字，完成 ' + Math.min(100, Math.round(st.words / p.targetWords * 100)) + '%）');
    return {
      think: ['意图未命中既定技能，走兜底：报真实缺口，把话头递回去。'],
      tools: [{ name: 'stat_summary', args: 'project=' + p.title, result: '缺口盘点 ' + gaps.length + ' 项' }],
      answer: '这个问题我暂时没有对应的技能。不过顺手报一下《' + p.title + '》的产出缺口，也许你真正想问的是其中之一：\n\n- ' + gaps.join('\n- ') + '\n\n换个说法再问我，或直接点快捷指令。'
    };
  }
};

/* ============================================================
 * seedData — 三部作品：连载中（主样本）/ 刚起步 / 仅筹备
 * ============================================================ */
function seedData() {

  /* ================= 作品一：《雾港夜航》 悬疑 · 连载中 ================= */
  var p1Chars = [
    { id: 'c1a', name: '沈聿', gender: '女', role: '主角 · 调查记者', color: '#a8433a',
      look: '瘦高，常年一件灰风衣，听人说话时眼神很冷，记性极好。',
      motive: '在二十周年之际回到雾港，替父亲沈国把「误判航向」的结论翻过来。',
      want: '一个白纸黑字的真相，让父亲的名字从事故责任栏里挪走。',
      need: '明白父亲当年的沉默是保护，学会与「不完整的答案」共处。',
      secret: '她随身带着的匿名信，其实认得出笔迹——那是父亲生前的字迹。她不敢承认。',
      arc: '从「证明父亲清白」走向「理解父亲为何沉默」。',
      firstCh: 1, chapters: [1, 2, 3, 4, 5, 6, 7, 8, 9] },
    { id: 'c1b', name: '周曼', gender: '女', role: '主要对手 · 港务主任', color: '#7c5f8f',
      look: '灰色套装，头发一丝不苟，说话永远留三分。',
      motive: '守住港务局的体面，也守住父亲的身后名。',
      want: '二十周年平稳过去，没有人再翻旧账。',
      need: '以自己的名义替父亲认罪，而不是替他守坟。',
      secret: '她知道父亲周昌贵那晚关了灯；合影里第六个人的脸，是她亲手刮掉的——那是举报人。',
      arc: '从「守墓人」走向「揭碑人」。',
      firstCh: 5, chapters: [5, 8, 12, 16] },
    { id: 'c1c', name: '老周', gender: '男', role: '关键证人 · 退休灯塔看守', color: '#40635c',
      look: '背微驼，手指粗糙，常年穿黑色胶皮围裙。',
      motive: '守着北礁灯塔过日子，谁问旧事都说忘了。',
      want: '守完最后一班灯，把欠的债悄悄还了。',
      need: '在死前说出真话，而不是把真话带进海里。',
      secret: '那晚他为儿子的医药费收钱熄灯十分钟，事后在「灯塔正常」上签了字；沈国的雨衣他收了二十年。',
      arc: '从「装忘」走向「开口」。',
      firstCh: 2, chapters: [2, 3, 9, 14, 21] },
    { id: 'c1d', name: '陈默', gender: '男', role: '盟友 · 退休刑警', color: '#b98a45',
      look: '头发花白，烟抽得凶，走路左腿微跛。',
      motive: '退休前没结掉的案子，想在死前结掉。',
      want: '把四一二事故重新立卷。',
      need: '得到遗属的原谅——他当年迫于压力改了笔录。',
      secret: '案卷缺的那一页是他藏起来的，上面是当晚灯塔值班表的原件。',
      arc: '从「藏页的人」走向「交页的人」。',
      firstCh: 1, chapters: [1, 7, 9, 15, 20] },
    { id: 'c1e', name: '沈国', gender: '男', role: '亡父 · 渡轮舵手（回忆出场）', color: '#55504a',
      look: '照片里的人：宽肩，爱笑，手背有锚链划的疤。',
      motive: '把船开稳，把人送回。',
      want: '女儿长大后不必活在雾港的闲话里。',
      need: '无——他是被追认的人，叙事由女儿完成。',
      secret: '沉船前他已发现灯塔熄灭，却把日志关键页藏起、选择沉默，为的是保住告发者的命。',
      arc: '静态人物：他是被解开的谜面。',
      firstCh: 1, chapters: [1, 2, 9] },
    { id: 'c1f', name: '阿岚', gender: '女', role: '线人 · 客栈老板娘', color: '#6f8f62',
      look: '四十上下，爱穿靛蓝布衫，泡茶手很稳。',
      motive: '守着客栈，等一个不会回来的人的消息。',
      want: '知道父亲当年到底有没有上那条船。',
      need: '与「被留下的命运」和解。',
      secret: '她是合影第六个人的女儿；母亲那张船票，是顶替别人登船的凭证。',
      arc: '从「等消息」走向「递消息」。',
      firstCh: 3, chapters: [3, 6, 9, 13] },
    { id: 'c1g', name: '方竞行', gender: '男', role: '对手阵营 · 远航航运代表', color: '#55504a',
      look: '年轻，车永远擦得很干净，笑起来没有温度。',
      motive: '替家族把二十年前的赔偿旧账彻底了结。',
      want: '远航航运上市前，档案干干净净。',
      need: '摆脱家族，用自己的名字做一件事。',
      secret: '赔偿名册有第二份，钥匙在他手里；他偷偷给沈聿递过匿名信。',
      arc: '从「清道夫」走向「递信人」。',
      firstCh: 5, chapters: [5, 10, 16, 23] },
    { id: 'c1h', name: '小泥鳅', gender: '男', role: '功能性 · 码头少年', color: '#6f8f62',
      look: '十五六岁，晒得黑，跑得比谁都快。',
      motive: '攒钱买一条能出雾港的船。',
      want: '离开这里。',
      need: '被人正眼相看一次。',
      secret: '他见过熄灯那晚的北礁——他以为那是自己的幻觉。',
      arc: '从「跑腿」走向「证人」。',
      firstCh: 6, chapters: [6, 9, 14] },
    { id: 'c1i', name: '沈聿母亲（未定名）', gender: '女', role: '暗线 · 疗养院病人', color: '#8d8574',
      look: '只在沈聿的回忆与疗养院探视中出现，安静，认不出人。',
      motive: '无——她的时间停在四一二之前。',
      want: '等丈夫开船回来。',
      need: '被女儿亲口告知真相，哪怕听不懂。',
      secret: '那张旧船票是她的登船凭证——她本要上那班船，临行发热没去成。',
      arc: '静态人物：她是沈聿的软肋与归处。',
      firstCh: 6, chapters: [6, 15, 24] }
  ];

  var p1Relations = [
    { a: 'c1a', b: 'c1e', type: '血缘', label: '父女' },
    { a: 'c1a', b: 'c1i', type: '血缘', label: '母女' },
    { a: 'c1a', b: 'c1d', type: '师徒', label: '亦师亦友' },
    { a: 'c1a', b: 'c1f', type: '亲和', label: '客栈主客' },
    { a: 'c1a', b: 'c1h', type: '亲和', label: '线人' },
    { a: 'c1a', b: 'c1b', type: '对抗', label: '调查者与守墓人' },
    { a: 'c1b', b: 'c1c', type: '血缘', label: '父女' },
    { a: 'c1b', b: 'c1g', type: '秘密', label: '利益互保' },
    { a: 'c1d', b: 'c1g', type: '对抗', label: '旧案与洗地' },
    { a: 'c1c', b: 'c1e', type: '师徒', label: '徒弟与师父' },
    { a: 'c1f', b: 'c1h', type: '亲和', label: '客栈养大的孩子' },
    { a: 'c1d', b: 'c1c', type: '秘密', label: '互相握着把柄' }
  ];

  var p1Foreshadows = [
    { id: 'f1a', name: '熄灯之夜', state: '部分揭示', importance: 3, plantCh: 1, payCh: 20, note: '核心真相：灯塔为何在 4.12 熄灭。' },
    { id: 'f1b', name: '写着「聿」字的旧雨衣', state: '部分揭示', importance: 3, plantCh: 2, payCh: 18, note: '舵手的雨衣为何挂在灯塔。' },
    { id: 'f1c', name: '合影里的第六人', state: '部分揭示', importance: 3, plantCh: 5, payCh: 19, note: '被刮掉脸的人是谁。' },
    { id: 'f1d', name: '乌江摇篮曲口哨', state: '已埋设', importance: 2, plantCh: 9, payCh: 21, note: '23:47 信道里的口哨，与老周的哼唱同源。' },
    { id: 'f1e', name: '灯塔日志缺页', state: '部分揭示', importance: 2, plantCh: 3, payCh: 20, note: '缺的一页记着当晚值班表。' },
    { id: 'f1f', name: '赔偿名册', state: '已回收', importance: 2, plantCh: 4, payCh: 10, note: '名册里多出第六个名字。' },
    { id: 'f1g', name: '母亲的旧船票', state: '悬空', importance: 1, plantCh: 6, note: '船票为何被夹进旧书，尚无回收计划。' },
    { id: 'f1h', name: '案卷缺页', state: '已埋设', importance: 2, plantCh: 7, payCh: 22, note: '陈默藏起的那一页。' },
    { id: 'f1i', name: '潮汐表差异', state: '已埋设', importance: 2, plantCh: 11, payCh: 16, note: '官方潮汐表与渔民手抄版对不上。' }
  ];

  var p1Entries = [
    { id: 'w1a', cat: '地理', name: '雾港镇', brief: '乌江入海口的小镇，一年两百天有雾，渡轮是唯一的对外通道。', detail: '镇子沿码头展开，三条街：鱼市街、灯塔街、旧衙门街。雾大时，街上的人靠声音认人。', taboo: '雾天不许提「4.12」三个字——提了，店主会收摊。违者会被整条街沉默对待。' },
    { id: 'w1b', cat: '地理', name: '乌江口', brief: '江面在此放宽入海，暗礁密布，航道只有一条。', detail: '航道贴着北礁走，退潮时礁石像一排牙。老舵手说：走乌江口，靠的是灯，不是眼。', taboo: '夜间无灯时任何船不得强行通过——4.12 之后这是铁律，违者由港务局直接吊照。' },
    { id: 'w1c', cat: '地理', name: '北礁灯塔', brief: '1954 年建的石塔，雾港唯一的高处，看守人世代居住。', detail: '塔顶透镜是老的，灯光转一圈十二秒。塔底层一间库房，常年上锁。', taboo: '库房钥匙只传看守人。外人问库房，等于问看守人家的祖坟。' },
    { id: 'w1d', cat: '势力', name: '港务局', brief: '镇上最高的楼，管航道、泊位与事故档案。', detail: '事故档案室在五楼，两人双锁。周家在此经营三代。', taboo: '档案借阅须周姓主任签字——这条不成文规矩，没人敢挑战。' },
    { id: 'w1e', cat: '势力', name: '远航航运', brief: '当年渡轮的船东，如今要上市的集团。', detail: '四一二后赔偿极快、极高、极安静，像早就备好了钱。', taboo: '集团内部禁提「四一二」，对外统一口径「自然灾害」。说漏嘴的员工会消失在下一次裁员名单里。' },
    { id: 'w1f', cat: '势力', name: '渔会', brief: '船老大的行会，掌握手抄潮汐表与海图。', detail: '渔会的账本记着每家每户在四一二里没了谁。', taboo: '手抄潮汐表不借外人——借了，等于把全镇的把柄递出去。' },
    { id: 'w1g', cat: '器物', name: '灯塔日志', brief: '每晚一页，记灯况、海况、值班人，1999 年 4 月缺一页。', detail: '日志用蓝黑墨水，缺页处裁得极齐，像用尺子比着割的。', taboo: '补写缺页者视为伪造——但真有人补过，笔迹是两种。' },
    { id: 'w1h', cat: '器物', name: '黑色旧雨衣', brief: '挂在灯塔底层，内领绣「聿」字，胶皮已发白。', detail: '那是舵手的雨衣。雾港的规矩：雨衣挂谁家，夜航的灯就为谁多亮一刻。', taboo: '雨衣不随葬、不出售——它替主人等着一个归期。' },
    { id: 'w1i', cat: '器物', name: 'VHF 录音带', brief: '1999.4.12 夜航道信道的开盘带，23:47 处有口哨声。', detail: '录音带在陈默手里保存了二十年，边缘已发脆，只能再放三次。', taboo: '复制此带需遗属会同意——否则全镇视你为掘墓者。' },
    { id: 'w1j', cat: '名词', name: '四一二', brief: '雾港对 1999 年 4 月 12 日沉船事故的讳称。', detail: '官方名「乌江渡轮事故」，民间只说「四一二」。十一个名字刻在码头碑上。', taboo: '四一二当天全镇不出海、不嫁娶、不开张；碑前不放白花，只放船模。' },
    { id: 'w1k', cat: '习俗', name: '祭海节', brief: '每年 4 月 12 日，全镇在码头放船模入海。', detail: '船模里各家装一句想带给海里的话，纸条不外传。', taboo: '捡到别人的船模不许拆——拆了，等于替别人把话说破。' },
    { id: 'w1l', cat: '档案', name: '赔偿名册', brief: '四一二后远航航运的赔付清单，官方版本存于港务局。', detail: '名册封了二十年。十一个名字之外，有人见过第十二行被墨盖住。', taboo: '名册开柜需港务主任与远航代表同时在场——单开者，当年就是因此丢的职。' }
  ];

  var p1Events = [
    { id: 'e1a', track: 'main', day: 2, era: 0, title: '乌江渡轮下水', detail: '全镇凑钱造的第一班正规渡轮。', ch: null },
    { id: 'e1b', track: 'main', day: 6, era: 0, title: '北礁航线开通', detail: '航道贴礁，靠灯塔引航。', ch: null },
    { id: 'e1c', track: 'fsp', day: 10, era: 0, title: '灯塔日志缺一页', detail: '后来才知道，缺页处记着当晚值班表。', ch: 3 },
    { id: 'e1d', track: 'shenye', day: 14, era: 0, title: '沈聿出生', detail: '沈国在船头挂了一条红布。', ch: null },
    { id: 'e1e', track: 'main', day: 20, era: 0, title: '四一二 · 渡轮沉没', detail: '大雾，触礁。十一人罹难，舵手沈国名列其三。', ch: 1 },
    { id: 'e1f', track: 'fsp', day: 21, era: 0, title: '信道录音留口哨', detail: '23:47，VHF 信道录进一段《乌江摇篮曲》。', ch: 9 },
    { id: 'e1g', track: 'zhouman', day: 22, era: 0, title: '周昌贵签「灯塔正常」', detail: '事故报告签字页，灯塔看守一栏：正常。', ch: 7 },
    { id: 'e1h', track: 'main', day: 24, era: 0, title: '远航赔偿 · 名册封存', detail: '赔得又快又安静，像早就备好了钱。', ch: 4 },
    { id: 'e1i', track: 'shenye', day: 44, era: 1, title: '沈聿读新闻系', detail: '志愿表只填了一个方向：调查报道。', ch: null },
    { id: 'e1j', track: 'zhouman', day: 48, era: 1, title: '周曼任港务主任', detail: '周家第三代掌印。', ch: 5 },
    { id: 'e1k', track: 'fsp', day: 52, era: 1, title: '船票夹进旧书', detail: '沈聿母亲把一张旧船票夹进《航路志》。', ch: 6 },
    { id: 'e1l', track: 'shenye', day: 82, era: 2, title: '沈聿收到匿名信', detail: '「四一二二十周年，回雾港来。」落款：陈默。', ch: 1 },
    { id: 'e1m', track: 'shenye', day: 84, era: 2, title: '归港 · 码头祭碑', detail: '碑上第三个名字：沈国。', ch: 1 },
    { id: 'e1n', track: 'shenye', day: 86, era: 2, title: '访北礁灯塔', detail: '她翻出雨衣内领的「聿」字。', ch: 2 },
    { id: 'e1o', track: 'shenye', day: 90, era: 2, title: '陈默交出录音带', detail: '「吹口哨的人，还活着。」', ch: 9 },
    { id: 'e1p', track: 'zhouman', day: 92, era: 2, title: '周曼夜访客桟', detail: '她问阿岚：最近谁在打听旧事。', ch: 8 }
  ];

  var p1 = {
    id: 'p1', title: '雾港夜航', genre: '悬疑', pov: '第三人称',
    brief: '1999 年沉船事故二十周年，调查记者沈聿回到雾港，发现父亲的「误判」背后藏着整整一镇的沉默。',
    targetWords: 250000, tones: ['沉郁', '克制', '治愈'], spineColor: '#40635c',
    createdAt: '2025-11-02',
    volumes: [
      { id: 'v1a', name: '卷一 · 雾起', summary: '归港叩门：雨衣、日志与合影，三处旧痕都指向同一夜。', items: [
        { no: 1, title: '归港', beat: '沈聿归港，匿名信，祭碑，黑雨衣人的远望。', tension: 5, status: '定稿' },
        { no: 2, title: '北礁灯塔', beat: '老周，雨衣内领的「聿」字，塔顶哼唱。', tension: 5, status: '定稿' },
        { no: 3, title: '灯塔日志', beat: '日志缺页；阿岚讲码头旧事。', tension: 4, status: '草稿' },
        { no: 4, title: '赔偿名册', beat: '远航的赔偿金，封了二十年的名册。', tension: 4, status: '大纲' },
        { no: 5, title: '港务主任', beat: '周曼，合影第六人被刀刮去。', tension: 6, status: '定稿' },
        { no: 6, title: '客栈夜话', beat: '阿岚提到母亲的旧船票。', tension: 4, status: '待修' },
        { no: 7, title: '旧档案', beat: '陈默的案卷缺一页。', tension: 4, status: '大纲' },
        { no: 8, title: '雾中人影', beat: '卷末：沈聿被跟踪。', tension: 4, status: '构思' }
      ]},
      { id: 'v1b', name: '卷二 · 潮落', summary: '口哨、潮汐表与名册重查；真相越近，捂它的人越近。', items: [
        { no: 9, title: '雾中汽笛', beat: '录音带，口哨，「吹口哨的人，还活着」。', tension: 7, status: '待修' },
        { no: 10, title: '名册重查', beat: '名册第十二行，第六人的名字浮出。', tension: 5, status: '定稿' },
        { no: 11, title: '潮汐表', beat: '官方与渔会手抄版对不上。', tension: 6, status: '大纲' },
        { no: 12, title: '潜入档案室', beat: '双锁档案室，差一步。', tension: 5, status: '构思' },
        { no: 13, title: '暴风雨前夜', beat: '全镇抢收，人心浮动。', tension: 5, status: '构思' },
        { no: 14, title: '风暴夜的灯塔', beat: '灯再次熄灭的恐惧重演。', tension: 5, status: '构思' },
        { no: 15, title: '母亲的船票', beat: '疗养院探视，船票来历。', tension: 6, status: '构思' },
        { no: 16, title: '对质 · 周宅', beat: '沈聿与周曼正面交锋。', tension: 7, status: '定稿' }
      ]},
      { id: 'v1c', name: '卷三 · 灯归', summary: '熄灯之夜全量还原；看守人、守墓人与后辈各自抉择。', items: [
        { no: 17, title: '父亲的航线', beat: '复原当晚航迹，灯灭十分钟。', tension: 7, status: '大纲' },
        { no: 18, title: '雨衣的归处', beat: '雨衣回到沈家，老周登门。', tension: 8, status: '大纲' },
        { no: 19, title: '第六人的名字', beat: '举报人身份揭晓，阿岚之父。', tension: 8, status: '构思' },
        { no: 20, title: '熄灯之夜', beat: '核心真相全面揭开。', tension: 9, status: '构思' },
        { no: 21, title: '老周的忏悔', beat: '十分钟，二十年的债。', tension: 8, status: '构思' },
        { no: 22, title: '周曼的抉择', beat: '守墓，还是揭碑。', tension: 8, status: '构思' },
        { no: 23, title: '开庭', beat: '远航与雾港对簿。', tension: 7, status: '构思' },
        { no: 24, title: '归航 · 点灯', beat: '灯塔重亮，船模入海。', tension: 6, status: '构思' }
      ]}
    ],
    chapters: [], chars: p1Chars, relations: p1Relations,
    foreshadows: p1Foreshadows, entries: p1Entries, events: p1Events,
    eras: [ { label: '1999', day: 0 }, { label: '2009', day: 40 }, { label: '2019', day: 80 } ],
    tracks: [
      { id: 'main', name: '主线', color: '#a8433a' },
      { id: 'shenye', name: '沈聿线', color: '#40635c' },
      { id: 'zhouman', name: '周曼线', color: '#7c5f8f' },
      { id: 'fsp', name: '伏笔埋收线', color: '#b98a45' }
    ],
    sessions: []
  };

  /* ---- 主样本正文（四章，细节互咬：雨衣 / 合影 / 口哨） ---- */
  p1.chapters.push({
    id: 'x1', no: 1, title: '归港', writtenOn: '2026-07-25',
    cast: ['c1a', 'c1d', 'c1c'],
    text: '渡轮的汽笛响了两声，雾散开一道缝。\n\n沈聿站在船头，看雾港镇从灰白里一点点浮出来。二十年，石碑上的小镇还是那么低、那么静，像乌江口从没冲走过任何东西。\n\n船靠岸前，她摸了摸口袋里那张旧照片。照片边角已经磨白。父亲站在渡轮的舵位上，敞着怀笑，手背上有一道锚链划出的疤。\n\n「你是沈国的女儿吧。」码头上，系缆的老人打量她。「像他。」\n\n沈聿没答话。她在看码头边那座碑。\n\n碑是二〇〇〇年立的，正面一行小字：乌江渡轮四一二事故纪念。往下，刻着十一个名字。第三个，沈国。\n\n「你是回来祭祖的？」老人又问。\n\n「不是。」她说。「是回来问话的。」\n\n半个月前，她收到一封匿名信。信里只有一行字：四一二二十周年，回雾港来。当年的事故报告，有问题。落款两个字：陈默。\n\n陈默。整个案卷里，唯一在父亲名字旁边画过问号的人。\n\n风起来了。有人在她身后小声地哭，海鸟绕着桅杆叫。沈聿伸手碰了碰那个名字。石面很凉。\n\n「我回来了。」她轻声说。「爸，我来问问他们，那晚到底怎么回事。」\n\n她身后，雾又合拢了。栈桥尽头，一个穿黑色雨衣的老人站了很久，转身往灯塔的方向去了。'
  });
  p1.chapters.push({
    id: 'x2', no: 2, title: '北礁灯塔', writtenOn: '2026-07-28',
    cast: ['c1a', 'c1c'],
    text: '北礁灯塔的台阶，一共一百二十八级。\n\n沈聿数到顶的时候，听见塔顶有人说话。\n\n「不用敲了，门没锁。」\n\n老周坐在灯室下面，正拿一块绒布擦透镜。他七十多了，背微驼，看见她上来也不惊讶。「沈国的女儿。」他说。「坐。」\n\n「你认得我？」\n\n「码头上都传遍了。」他把绒布搭在肩上。「二十年了，你是头一个上来问的。」\n\n塔底层很小，一张床，一口炉，墙角挂着缆绳和救生圈。衣架上还挂着一件黑色旧雨衣，很旧了，胶皮的下摆磨得发白。\n\n沈聿盯着那件雨衣，伸手翻了翻衣领。\n\n内领上绣着一个字：聿。\n\n她的手指停住了。\n\n这是父亲的雨衣。小时候父亲值夜航就穿它，这个字是她六岁那年，踩着凳子亲手绣上去的。她记得很清楚，绣完了还挨了一顿骂。\n\n「老周，」她尽量让声音平稳。「舵手的雨衣，为什么在灯塔？」\n\n老周擦透镜的手没停。「那时候夜里冷，值班的互相借着穿。」\n\n「四一二那晚，它也在这塔里？」\n\n绒布停了半拍，又继续。「年代久了。谁记得。」\n\n塔顶的风穿过灯室，发出低低的呜声。沈聿环顾这间屋子：床底一只上锁的铁箱，墙角一摞用麻绳捆好的旧本子——灯塔日志，最上面一本的封皮停在 1999 年。\n\n「日志能看吗？」\n\n「潮了，字都洇了。」老周说。「没什么可看的。」\n\n下塔的时候，她听见身后传来一段哼唱。调子很旧，只有几个音，像摇篮曲，断断续续，混在风里。\n\n她在台阶上站住了。\n\n这个调子，她听过。小时候，父亲每次出夜航之前，都哼这个。母亲说，那是乌江上的摇篮曲，舵手们都会。\n\n可是二十年没人哼过了。\n\n雾更大了。她一路走到海堤，才敢把攥紧的手从口袋里抽出来。掌心里是那张匿名信，信纸已被汗浸软。她摸出笔，在「事故报告有问题」那一行旁边，写下一句：\n\n父亲的雨衣，为什么在灯塔。'
  });
  p1.chapters.push({
    id: 'x3', no: 3, title: '灯塔日志', writtenOn: '2026-07-30',
    cast: ['c1a', 'c1c', 'c1f'],
    text: '沈聿第二次上塔，带了两包烟。\n\n老周不抽烟，还是接了，搁在炉盖上。「想看什么。」\n\n「日志。」\n\n老周这回没拿话挡她。他从墙角搬下那摞麻绳捆好的旧本子，一本一本，在床上排开。封皮潮得发皱，蓝黑墨水洇成一片淡影。\n\n一九九七，一九九八，一九九九年三月，四月。\n\n四月那本明显薄。沈聿翻开，一页一页数到十二。没有。装订处留着一道裁口，裁得很齐，像用尺子比着割的。\n\n「这页也潮了？」\n\n老周在炉边添火，没抬头。「潮了。」\n\n「是裁掉的。」\n\n炉火啪地响了一声。老周不答。\n\n沈聿把本子合上，没再逼。有些门，不能一次推到底。\n\n下塔的时候雾小了些。客栈门口，阿岚正往上挂幌子，看见她，招手让她进去吃茶。\n\n「又去看老周了。」阿岚斟茶。「全镇都知道了。」\n\n「知道什么。」\n\n「知道你在问四一二。」阿岚声音压得低，擦桌子的手却稳。「我七岁那年，我父亲说，他那晚在码头，看见灯塔的灯灭过。」\n\n沈聿端茶的手停住了。\n\n「灭多久。」\n\n「一会儿。够一条船偏航的。」阿岚把抹布放下。「后来没人敢提。我父亲提了一次，就再没让靠港。」\n\n窗外，雾贴着玻璃。有人提着一盏鱼灯过街，脚步很轻。\n\n沈聿盯着茶面上的倒影。雨衣，口哨，缺掉的那一页——三个声音，三个地方，凑的是同一个晚上。\n\n她掏出笔，在匿名信背面添了两行：日志缺页。那晚，灯灭过。'
  });
  p1.chapters.push({
    id: 'x5', no: 5, title: '港务主任', writtenOn: '2026-08-01',
    cast: ['c1a', 'c1b', 'c1g'],
    text: '港务局是镇上最高的楼，也是唯一有电梯的楼。\n\n周曼在五楼等她。灰色套装，头发一丝不苟，像这间办公室一样干净。\n\n「记者的耳朵真灵。」周曼给她倒茶，茶是今年的新绿。「二十周年，想把旧事翻出来晒的，都会到我这儿来。」\n\n「我不是来翻旧事的。」沈聿说。「我来要真相。」\n\n「真相。」周曼笑了一下，不置可否。「这两个字，在雾港比船票还贵。」\n\n沈聿没接话。她的目光落在办公桌后面的大相框上——1999 年事故善后表彰合影，三排，几十个人，站在码头老槐树前。\n\n她站起来，走过去。\n\n照片里每个人都体面地站着，只有第二排第六个人，脸被人用刀片刮掉了。刮得很干净，只剩一小片发毛的相纸底。\n\n「这位是谁？」\n\n「一位离开的同事。」周曼走过来，把相框转了过去，扣在桌上。她的动作很轻，像只是掸灰。「港务局有个传统：人走了，照片不留。」\n\n「那为什么留这张合影？」\n\n周曼看着她，看了有两秒。「沈小姐，」她说。「有些门，推开了，就关不上了。」\n\n「我今天来，就是想把门推开看看。」\n\n「那你至少该知道门后有什么。」周曼端起茶杯，又放下。「四一二之后，全镇靠着赔偿金和沉默，才把日子过下去。你要的真相，可能会让这两样东西一起没掉。」\n\n沈聿从港务局出来的时候，天已经黑透了。\n\n街对面停着一辆黑色轿车，车窗降下半截。方竞行，远航航运的新任代表，比照片上年轻。他朝她笑了笑：「沈小姐？需要搭一程吗？」\n\n「不用。」\n\n「那送你一句闲话。」方竞行的声音很轻，像雾。「镇子很小，谁家的事，大家心里都有数。你问一句话，会有三家人睡不着觉。」\n\n车窗升上去。沈聿站在原地，听见自己的心跳。\n\n三家人睡不着。她想，那正好。睡不着的人，才会开口说话。'
  });
  p1.chapters.push({
    id: 'x9', no: 9, title: '雾中汽笛', writtenOn: '2026-08-04',
    cast: ['c1a', 'c1d', 'c1f', 'c1h'],
    text: '陈默把一盘旧录音带放在桌上。\n\n带盒已经发黄，标签上是一行褪色的钢笔字：四一二夜，VHF 信道。\n\n「信道录音。」他按下播放键，磁带先是一阵沙沙的电流声。「听。」\n\n浪声。风声。两声汽笛，隔着雾，闷闷的。然后，在 23 点 47 分，有人吹起了口哨。\n\n很轻，很慢。\n\n是《乌江摇篮曲》。\n\n沈聿的手一下子攥紧了膝盖上的布。\n\n三天前，她在北礁灯塔听过这个调子。老周擦着透镜，随口哼的，断断续续，和录音里一模一样。\n\n「那时候信道是全港公开的。」陈默说。「也就是说，23 点 47 分，港里某条船上，或者灯塔上，有人在吹这支曲子。十一分钟后，渡轮触礁。」\n\n「事故报告说，舵手在大雾中误判了航向。」\n\n「报告还说，灯塔当晚运转正常。」陈默翻过一页纸，指着一行签字。「签字人：周昌贵。现任港务主任的父亲。」\n\n磁带转到头，口哨还在继续。陈默按了停止。\n\n「一个跑了三十年船的老舵手，哼在睡梦里的调子。」他慢慢说，「你觉得，他会在紧张的时候哼它吗？」\n\n「那口哨是谁吹的？」\n\n「这就是问题。」陈默把录音带推回她面前。「会吹这支曲子的，全港数得过来。舵手，和灯塔看守。」\n\n屋外，雾又起来了。客栈楼下，阿岚在收幌子，小泥鳅蹲在门槛上剥花生。\n\n「陈叔，」沈聿忽然问。「你当年为什么在我父亲名字旁边画问号？」\n\n陈默点烟的手停了停。\n\n「因为我不信。」他说。「可是后来，我把那一页从案卷里撕下来了。你猜，我是想藏起来，还是想保住它？」\n\n火柴亮了。烟雾升起来，隔在两个人中间。\n\n远处海堤的尽头，灯塔的小灯闪了两下，忽然灭了。'
  });

  /* ---- 预置会话：直接用 REPLY_MAKERS 从本项目数据生成，保证自洽 ---- */
  var zhouMan = p1Chars[1];
  var mk1 = REPLY_MAKERS.char(p1, { char: zhouMan });
  var mk2 = REPLY_MAKERS.foreshadow(p1, {});
  var mk3 = REPLY_MAKERS.rhythm(p1, {});
  function doneTools(m) {
    return m.tools.map(function (t) { return { name: t.name, args: t.args, result: t.result, state: 'done' }; });
  }
  p1.sessions = [
    { id: 's1a', title: '周曼的三层防线', updated: '2026-08-05 21:14', messages: [
      { role: 'user', text: '帮我分析周曼，她一直在掩盖什么？' },
      { role: 'ai', text: mk1.answer, think: mk1.think, tools: doneTools(mk1) }
    ]},
    { id: 's1b', title: '伏笔回收顺序', updated: '2026-08-04 22:40', messages: [
      { role: 'user', text: '把所有伏笔的埋收状态理一遍，告诉我哪些开始危险了。' },
      { role: 'ai', text: mk2.answer, think: mk2.think, tools: doneTools(mk2) }
    ]},
    { id: 's1c', title: '卷二节奏诊断', updated: '2026-08-02 20:05', messages: [
      { role: 'user', text: '诊断一下卷二的节奏，我担心中段会塌。' },
      { role: 'ai', text: mk3.answer, think: mk3.think, tools: doneTools(mk3) }
    ]}
  ];

  /* ================= 作品二：《听雷塔》 玄幻 · 刚起步 ================= */
  var p2Chars = [
    { id: 'c2a', name: '莫干', gender: '男', role: '主角 · 聋人铸剑师', color: '#7c5f8f',
      look: '三十岁上下，耳背，说话极慢，掌心全是旧疤。',
      motive: '铸一柄能听见雷的剑，证明聋人也能听见天。',
      want: '让师父的那句「铸剑聋子，最多打农具」作废。',
      need: '承认他真正想要的不是剑听见雷，而是有人听见他。',
      secret: '他能「听」见金属，是因为幼年一场高烧烧掉了耳朵，却把骨头烧成了共鸣腔。',
      arc: '从「铸剑给人看」走向「铸剑给自己听」。',
      firstCh: 1, chapters: [1, 2] },
    { id: 'c2b', name: '听雨', gender: '女', role: '造物 · 剑灵', color: '#40635c',
      look: '尚无实体，只是剑身里的一缕震颤；出鞘时像雨点落在铁上。',
      motive: '刚睁开「眼睛」，想弄明白什么是雷、什么是名字。',
      want: '听见第一声真正的雷。',
      need: '一个愿意为它停下的人。',
      secret: '剑成之夜，雷峰三百年的雷停了一瞬——不是剑吸走了雷，是剑替这座山听了一耳朵。',
      arc: '从「器物」走向「同伴」。',
      firstCh: 2, chapters: [2] },
    { id: 'c2c', name: '班叔', gender: '男', role: '阻力 · 矿监', color: '#b98a45',
      look: '矮壮，嗓门大，腰上挂一串矿洞钥匙。',
      motive: '看着莫干长大，怕这柄剑给镇上招祸。',
      want: '让莫干把剑回炉，安分打农具。',
      need: '承认自己怕的不是剑，是当年矿难里没救出来的兄弟。',
      secret: '剑成之夜他亲眼看见雷停，却对所有人说是自己眼花。',
      arc: '从「阻剑」走向「护剑」。',
      firstCh: 2, chapters: [2] }
  ];
  var p2 = {
    id: 'p2', title: '听雷塔', genre: '玄幻', pov: '第三人称',
    brief: '聋人铸剑师铸出一柄会听雷的剑，剑的第一声鸣叫，是它自己的名字。',
    targetWords: 350000, tones: ['热血', '古意'], spineColor: '#7c5f8f',
    createdAt: '2026-06-18',
    volumes: [
      { id: 'v2a', name: '卷一 · 炉火', summary: '聋人铸剑师上雷峰；剑开口命名，镇的恐惧开始。', items: [
        { no: 1, title: '剑范入炉', beat: '莫干背剑范上雷峰，炭火映眼，「铸一柄会听雷的剑」。', tension: 5, status: '定稿' },
        { no: 2, title: '剑成 · 听雨', beat: '雷峰大雷，剑在水槽里学会说话，说出自己的名字。', tension: 6, status: '定稿' },
        { no: 3, title: '洗剑节', beat: '全镇看剑，班叔当众发难。', tension: 4, status: '大纲' },
        { no: 4, title: '班叔告密', beat: '矿监上山，带来「妖剑」的流言。', tension: 6, status: '大纲' },
        { no: 5, title: '雷停之夜', beat: '雷峰无雷，剑鸣如泣。', tension: 7, status: '构思' },
        { no: 6, title: '剑鸣', beat: '听雨第一次真正听见雷。', tension: 8, status: '构思' }
      ]}
    ],
    chapters: [
      { id: 'x21', no: 1, title: '剑范入炉', writtenOn: '2026-08-02', cast: ['c2a'],
        text: '雷峰一年有三百天在打雷。\n\n莫干背着剑范上山。范很沉，表面的雷纹还是湿的。他听不见雷。从记事起，他的世界就是安静的，只有把手掌贴在铁砧上，才能通过震颤「听」见金属的脾气。\n\n师父说，铸剑聋子，最多打农具。\n\n莫干没答话。他把剑范埋进炉膛，炭火把他的眉骨映得发红。\n\n他要铸一柄会听雷的剑。\n\n山腰的雷滚过来，脚下的石头细细地颤。莫干闭上眼，用手掌接着大地的震颤，像别人用耳朵听雨。\n\n炉火升到最亮的那一夜，剑范开了口——不是真的开口，是铁胎里传出一丝极细的鸣，像婴儿第一次学话。\n\n莫干把手贴上去。震颤里，他「听」见了两个字。\n\n听雨。' },
      { id: 'x22', no: 2, title: '剑成 · 听雨', writtenOn: '2026-08-05', cast: ['c2a', 'c2b', 'c2c'],
        text: '「听雨」是剑自己挑的名字。\n\n班叔说这不祥。剑自己会起名字，是吸了山里的雷，迟早要招祸。他让莫干把剑回炉。\n\n莫干摇头。\n\n「你听不见！」班叔急了，一串钥匙拍在案上。「剑出鞘那晚，山上的雷停了！三百年，雷峰什么时候停过雷！」\n\n莫干还是摇头。他伸手摸了摸剑身，剑轻轻颤了一下，像孩子往掌心里蹭。\n\n那晚听雨悬在墙上，窗外无雷。一人一剑，在安静里对坐到天明。' }
    ],
    chars: p2Chars,
    relations: [
      { a: 'c2a', b: 'c2b', type: '造物', label: '铸者命名' },
      { a: 'c2a', b: 'c2c', type: '亲和', label: '看着长大的旧识' },
      { a: 'c2c', b: 'c2b', type: '秘密', label: '惧剑又盯剑' }
    ],
    foreshadows: [
      { id: 'f2a', name: '剑范雷纹', state: '已埋设', importance: 2, plantCh: 1, payCh: 6, note: '湿雷纹为何能记住雷声。' },
      { id: 'f2b', name: '听雨的名字', state: '悬空', importance: 3, plantCh: 2, note: '剑为何开口第一句就是名字，尚未规划回收。' }
    ],
    entries: [
      { id: 'w2a', cat: '力量体系', name: '听诀', brief: '以掌贴铁，听金属内音辨器的铸术，聋者反而最精。', detail: '听诀分三层：听炉、听范、听剑。第三层百年无人练成。', taboo: '听诀不可用于活物——据说有人试过，从此再也听不见铁。' },
      { id: 'w2b', cat: '地理', name: '雷峰', brief: '一年三百天落雷的山，山顶有前朝铸剑坊遗址。', detail: '雷峰的雷有脾气：铸剑时落雷为吉，洗剑时落雷为凶。', taboo: '雷停之夜不得开炉——三百年里每逢雷停，必有一柄剑折。' },
      { id: 'w2c', cat: '器物', name: '雷纹剑范', brief: '前朝留下的剑范，雷纹里存着旧雷的回声。', detail: '剑范每次开范都要喂一场新雷，否则铸出的剑是哑的。', taboo: '剑范不可离山。离山一夜，范中雷声尽散，等于废铁。' },
      { id: 'w2d', cat: '习俗', name: '洗剑节', brief: '每年惊蛰，全镇新剑齐聚洗剑池，由矿监主持。', detail: '洗剑池的水是雷峰泉，剑入水三息，鸣者留，哑者回炉。', taboo: '洗剑节上不许提「回炉」以外的评语——说破剑的短处，等于折铸者十年寿。' }
    ],
    events: [
      { id: 'e2a', track: 'main', day: 2, era: 0, title: '剑范入炉', detail: '莫干背范上雷峰。', ch: 1 },
      { id: 'e2b', track: 'main', day: 6, era: 0, title: '剑成 · 雷停一瞬', detail: '三百年雷峰，雷停了一瞬。', ch: 2 },
      { id: 'e2c', track: 'banshu', day: 8, era: 0, title: '班叔下山', detail: '他去镇上散布「妖剑」的消息。', ch: null },
      { id: 'e2d', track: 'fsp', day: 8, era: 0, title: '「听雨」初鸣', detail: '剑说出自己的名字。', ch: 2 }
    ],
    eras: [ { label: '炉年一', day: 0 } ],
    tracks: [
      { id: 'main', name: '主线', color: '#a8433a' },
      { id: 'banshu', name: '班叔线', color: '#b98a45' },
      { id: 'fsp', name: '伏笔埋收线', color: '#7c5f8f' }
    ],
    sessions: []
  };
  var mk4 = REPLY_MAKERS.greet(p2, {});
  p2.sessions = [
    { id: 's2a', title: '开篇这炉火', updated: '2026-08-05 19:22', messages: [
      { role: 'user', text: '你好，刚开这个坑，先告诉我这本书眼下该抓什么。' },
      { role: 'ai', text: mk4.answer, think: mk4.think, tools: doneTools(mk4) }
    ]}
  ];

  /* ================= 作品三：《潮汐信笺》 科幻 · 仅筹备（空态展示） ================= */
  var p3 = {
    id: 'p3', title: '潮汐信笺', genre: '科幻', pov: '第一人称',
    brief: '潮汐锁定星球上的最后一位邮差，在永昼与永夜之间，投递殖民时代的最后一封信。',
    targetWords: 180000, tones: ['孤独', '浪漫'], spineColor: '#55504a',
    createdAt: '2026-08-01',
    volumes: [], chapters: [], chars: [], relations: [], foreshadows: [],
    entries: [], events: [], eras: [], tracks: [], sessions: []
  };

  return { projects: [p1, p2, p3] };
}
;
/* ============================================================
 * app.js — 状态、渲染、动作分发、Agent 引擎宿主
 * 事件一律委托 + data-act 分发，不在渲染后逐个绑 onclick。
 * ============================================================ */

/* ---------- 纯函数：转义 / markdown / 剥离 ---------- */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function inlineMd(s) {
  return s
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}
function md(src) {
  if (!src) return '';
  var lines = String(src).split('\n');
  var html = '', para = [], list = [], quote = [];
  function flushP() { if (para.length) { html += '<p>' + inlineMd(esc(para.join(' '))) + '</p>'; para = []; } }
  function flushL() { if (list.length) { html += '<ul>' + list.map(function (li) { return '<li>' + inlineMd(esc(li)) + '</li>'; }).join('') + '</ul>'; list = []; } }
  function flushQ() { if (quote.length) { html += '<blockquote>' + inlineMd(esc(quote.join(' '))) + '</blockquote>'; quote = []; } }
  lines.forEach(function (raw) {
    var line = raw.trim();
    if (!line) { flushP(); flushL(); flushQ(); return; }
    var m;
    if ((m = line.match(/^####\s*(.*)/))) { flushP(); flushL(); flushQ(); html += '<h4>' + inlineMd(esc(m[1])) + '</h4>'; return; }
    if ((m = line.match(/^###\s*(.*)/))) { flushP(); flushL(); flushQ(); html += '<h3>' + inlineMd(esc(m[1])) + '</h3>'; return; }
    if ((m = line.match(/^##\s*(.*)/))) { flushP(); flushL(); flushQ(); html += '<h3>' + inlineMd(esc(m[1])) + '</h3>'; return; }
    if ((m = line.match(/^[-•]\s*(.*)/))) { flushP(); flushQ(); list.push(m[1]); return; }
    if ((m = line.match(/^>\s?(.*)/))) { flushP(); flushL(); quote.push(m[1]); return; }
    flushL(); flushQ(); para.push(line);
  });
  flushP(); flushL(); flushQ();
  return html;
}
function stripMd(s) {
  return String(s == null ? '' : s)
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/\*\*|\*|`/g, '')
    .replace(/^[-•]\s*/gm, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ---------- 意图路由（纯函数，可单测） ---------- */
var INTENT_RULES = [
  { id: 'naming', re: /取名|起名|命名|改名|叫什么名字/ },
  { id: 'stuck', re: /卡文|卡住|写不下去|没灵感|瓶颈|写不出来|断更/ },
  { id: 'polish', re: /润色|精简|扩写|改写|文笔|修改|优化|措辞/ },
  { id: 'foreshadow', re: /伏笔|埋线|回收|暗线|钩子|铺垫/ },
  { id: 'rhythm', re: /节奏|张力|结构|大纲诊断| pacing|起伏/ },
  { id: 'continue', re: /续写|接着写|往下写|下一章|后续|接下去/ },
  { id: 'char', re: /人物|角色|档案|性格|动机|声口/ },
  { id: 'greet', re: /你好|您好|在吗|你是谁|介绍|你能|会做什么|能力/ }
];
function route(text) {
  var t = String(text || '');
  for (var i = 0; i < INTENT_RULES.length; i++) {
    if (INTENT_RULES[i].re.test(t)) return INTENT_RULES[i].id;
  }
  return 'fallback';
}

/* ---------- compose：路由 + 实体感知 + 数据驱动回复（纯函数） ---------- */
function compose(project, intent, text) {
  var p = project;
  var ctx = { char: null, chNo: null };
  var t = String(text || '');
  // 实体感知：提到人物名 → 取其档案；提到章号 → 记录
  var i;
  for (i = 0; i < p.chars.length; i++) {
    var nm = p.chars[i].name.replace(/（[^）]*）/g, '');
    if (nm && t.indexOf(nm) >= 0) { ctx.char = p.chars[i]; break; }
  }
  var m = t.match(/CH\.?\s*(\d{1,2})/i) || t.match(/第\s*([0-9一二三四五六七八九十]{1,3})\s*章/);
  if (m) {
    ctx.chNo = parseInt(m[1], 10);
    if (isNaN(ctx.chNo)) {
      var map = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
      ctx.chNo = map[m[1]] || 1;
    }
  }
  var it = intent || route(t);
  // 点名人物时，兜底/问候都改走人物档案
  if (ctx.char && (it === 'fallback' || it === 'greet')) it = 'char';
  var maker = REPLY_MAKERS[it] || REPLY_MAKERS.fallback;
  var r = maker(p, ctx);
  return { intent: it, think: r.think, tools: r.tools, answer: r.answer };
}

/* ---------- 内联 SVG 图标 ---------- */
function I(name, cls) {
  var P = {
    plus: '<path d="M7 2v10M2 7h10"/>',
    trash: '<path d="M2.5 4h9M5 4V2.5h4V4M3.5 4l.6 8.5h5.8L10.5 4M5.5 6.5v3.5M8.5 6.5v3.5"/>',
    search: '<circle cx="6" cy="6" r="3.6"/><path d="M9 9l3 3"/>',
    send: '<path d="M2 7l10-4.5L8.5 12 6.8 8.4z"/><path d="M6.8 8.4L12 2.5"/>',
    chevD: '<path d="M3 5l4 4 4-4"/>',
    chevR: '<path d="M5 3l4 4-4 4"/>',
    close: '<path d="M3 3l8 8M11 3l-8 8"/>',
    edit: '<path d="M2.5 11.5l.7-2.8L9.7 2.2l2.1 2.1-6.5 6.5z"/>',
    book: '<path d="M7 2.5C5.5 1.6 3.5 1.5 2 1.8v9.7c1.5-.3 3.5-.2 5 .7 1.5-.9 3.5-1 5-.7V1.8c-1.5-.3-3.5-.2-5 .7z"/><path d="M7 2.5v9.7"/>',
    chart: '<path d="M2 12h10M3.5 9.5v-3M7 9.5V3.5M10.5 9.5v-4"/>',
    clock: '<circle cx="7" cy="7" r="5"/><path d="M7 4.2V7l2 1.6"/>',
    user: '<circle cx="7" cy="4.6" r="2.6"/><path d="M2.2 12.2c.6-2.6 2.4-3.9 4.8-3.9s4.2 1.3 4.8 3.9"/>',
    spark: '<path d="M7 1.5l1.2 3.4L11.5 6 8.2 7.2 7 10.8 5.8 7.2 2.5 6l3.3-1.1z"/><path d="M11 9.5l.6 1.7 1.7.6-1.7.6-.6 1.7-.6-1.7-1.7-.6 1.7-.6z"/>',
    stop: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/>',
    check: '<path d="M2.5 7.5l3 3 6-6.5"/>',
    alert: '<path d="M7 1.8L13 12H1z"/><path d="M7 5.5v3M7 10.4v.4"/>',
    focus: '<path d="M2 5V2h3M9 2h3v3M12 9v3H9M5 12H2V9"/>',
    undo: '<path d="M3 6h6a3 3 0 1 1 0 6H6"/><path d="M5.5 3.5L3 6l2.5 2.5"/>',
    chat: '<path d="M2 3.5h10v6H6.5L3.5 12V9.5H2z"/>',
    grid: '<rect x="2" y="2" width="4.2" height="4.2" rx="1"/><rect x="7.8" y="2" width="4.2" height="4.2" rx="1"/><rect x="2" y="7.8" width="4.2" height="4.2" rx="1"/><rect x="7.8" y="7.8" width="4.2" height="4.2" rx="1"/>',
    link: '<path d="M5.5 8.5l3-3M4 7L2.6 8.4a2.3 2.3 0 003.2 3.2L7.2 10M10 7l1.4-1.4a2.3 2.3 0 00-3.2-3.2L6.8 4"/>'
  };
  return '<svg class="ic ' + (cls || '') + '" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (P[name] || '') + '</svg>';
}

/* ---------- 全局状态（单一 state，全内存） ---------- */
var state = null;
function cur() {
  var p = null;
  state.projects.forEach(function (x) { if (x.id === state.activeId) p = x; });
  return p;
}
function freshState() {
  var data = seedData();
  var p1 = data.projects[0];
  var firstCh = p1.chapters.length ? p1.chapters[0].no : 1;
  return {
    projects: data.projects,
    activeId: p1.id,
    tab: 'shelf',
    selCh: firstCh, textMode: 'read',
    selSession: p1.sessions.length ? p1.sessions[0].id : null,
    chatQuery: '',
    selChar: p1.chars.length ? p1.chars[0].id : null,
    outlineView: 'struct',
    worldCat: '全部',
    entryOpen: null,
    boardTracks: {},
    focus: false,
    stream: null,       // { sessionId, msg, timer, phase }
    diff: null,         // 改写对照暂存
    palette: { open: false, q: '', sel: 0 },
    seq: 1000
  };
}
function uid(prefix) { state.seq += 1; return prefix + state.seq; }
function nowStr() {
  var d = new Date();
  function z(n) { return String(n).padStart(2, '0'); }
  return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()) + ' ' + z(d.getHours()) + ':' + z(d.getMinutes());
}
function todayStr() { return nowStr().slice(0, 10); }

/* ---------- 动作分发表（事件委托，渲染后无需重绑） ---------- */
var ACT = {};
function dispatch(act, el, ev) {
  var fn = ACT[act];
  if (fn) { fn(el, ev); renderAll(); }
}

/* ---------- 渲染入口 ---------- */
function renderAll() {
  if (!state) return;
  renderTopbar();
  renderShelfCol();
  renderCtxCol();
  renderMain();
}

/* ---------- 顶栏 ---------- */
var TABS = [
  { id: 'shelf', label: '书架' },
  { id: 'chat', label: 'Agent 对话' },
  { id: 'text', label: '正文' },
  { id: 'chars', label: '人物关系' },
  { id: 'outline', label: '大纲与伏笔' },
  { id: 'world', label: '世界观' },
  { id: 'board', label: '时间线与看板' }
];
function renderTopbar() {
  var p = cur();
  if (!p) {
    document.getElementById('topbar').innerHTML =
      '<div class="brand"><span class="seal">墨</span><span><b>墨案</b><span class="sub"> AI 创作工作台</span></span></div>' +
      '<div id="topProject">书架空着</div>' +
      '<nav id="tabbar"></nav>' +
      '<div id="statstrip"><button class="btn primary sm" data-act="new-project">' + I('plus') + ' 新建作品</button></div>';
    return;
  }
  var st = projStats(p);
  var tabs = TABS.map(function (t) {
    var badge = '';
    if (t.id === 'chat' && st.sessions) badge = '<span class="badge">' + st.sessions + '</span>';
    if (t.id === 'text') badge = '<span class="badge">' + st.written + '/' + st.plan + '</span>';
    if (t.id === 'outline' && st.fspDangling) badge = '<span class="badge">' + st.fspDangling + '</span>';
    return '<button class="tab' + (state.tab === t.id ? ' on' : '') + '" data-act="tab" data-tab="' + t.id + '">' + t.label + badge + '</button>';
  }).join('');
  var latest = '';
  if (p.chapters.length) {
    var maxD = '';
    p.chapters.forEach(function (c) { if (c.writtenOn > maxD) maxD = c.writtenOn; });
    latest = '<span class="sep">|</span>最近更新 <b>' + maxD.slice(5) + '</b>';
  }
  document.getElementById('topbar').innerHTML =
    '<div class="brand"><span class="seal">墨</span><span><b>墨案</b><span class="sub"> AI 创作工作台</span></span></div>' +
    '<div id="topProject"><span class="genre-dot" style="background:' + (GENRE_COLORS[p.genre] || '#55504a') + '"></span>' + esc(p.title) + '</div>' +
    '<button class="icon-btn ctx-toggle" title="展开 / 收起上下文栏" data-act="ctx-toggle">' + I('grid') + '</button>' +
    '<nav id="tabbar">' + tabs + '</nav>' +
    '<div id="statstrip">' +
      '总字数 <b>' + st.words.toLocaleString() + '</b>' +
      '<span class="sep">|</span>章节 <b>' + st.written + '/' + st.plan + '</b>' +
      '<span class="sep">|</span>伏笔回收 <b>' + st.fspDone + '/' + st.fsp + '</b>' +
      '<span class="sep">|</span>人物 <b>' + st.chars + '</b>' + latest +
    '</div>';
}

/* ---------- 左栏：书架 ---------- */
function renderShelfCol() {
  var items = state.projects.map(function (p) {
    var st = projStats(p);
    return '<button class="shelf-item' + (p.id === state.activeId ? ' on' : '') + '" data-act="open-project" data-id="' + p.id + '">' +
      '<span class="spine" style="background:' + p.spineColor + '">' + esc(p.title.charAt(0)) + '</span>' +
      '<span class="si-body"><span class="si-title">' + esc(p.title) + '</span>' +
      '<span class="si-sub">' + p.genre + ' · ' + st.words.toLocaleString() + ' 字</span></span></button>';
  }).join('');
  document.getElementById('colShelf').innerHTML =
    '<div class="shelf-head"><span class="sh-title">书 架</span>' +
    '<button class="icon-btn" title="新建作品" data-act="new-project">' + I('plus') + '</button></div>' +
    '<div class="shelf-list">' + (items || '<div class="empty" style="padding:24px 8px"><div class="glyph">架</div><p>书架空着</p></div>') + '</div>' +
    '<div class="shelf-foot">' + HONEST_NOTE + '<span class="kai">按 <b>Ctrl/⌘ K</b> 全局检索</span></div>';
}

/* ---------- 中栏：上下文栏（随模块变化） ---------- */
function renderCtxCol() {
  var p = cur();
  var el = document.getElementById('colCtx');
  if (!p) {
    el.innerHTML = '<div class="ctx-hd"><h4>上下文</h4></div>' +
      '<div class="empty"><div class="glyph">架</div><p>还没有作品。建一部，上下文栏会随模块变化。</p>' +
      '<button class="btn primary sm" data-act="new-project">' + I('plus') + ' 新建作品</button></div>';
    return;
  }
  var h = '';
  if (state.tab === 'shelf') {
    var st = projStats(p);
    h = '<div class="ctx-hd"><h4>馆藏概览</h4></div><div class="ctx-body" style="padding:0 14px 14px">' +
      '<div class="statcards" style="grid-template-columns:1fr 1fr;margin-bottom:12px">' +
        '<div class="card statcard"><span class="sc-v">' + state.projects.length + '</span><span class="sc-l">在架作品</span></div>' +
        '<div class="card statcard"><span class="sc-v">' + state.projects.reduce(function (n, x) { return n + projStats(x).words; }, 0).toLocaleString() + '</span><span class="sc-l">总字数</span></div>' +
      '</div>' +
      '<div class="notice">' + esc('纸感书房，长夜可读写。所有删除操作均可在 5 秒内撤销。') + '</div>' +
      '<div style="margin-top:14px"><button class="btn primary" data-act="new-project">' + I('plus') + ' 新建作品</button></div>' +
      '</div>';
  } else if (state.tab === 'chat') {
    var q = state.chatQuery;
    var list = p.sessions.filter(function (s) { return !q || s.title.indexOf(q) >= 0; })
      .slice().sort(function (a, b) { return a.updated < b.updated ? 1 : -1; })
      .map(function (s) {
        var lastMsg = '';
        for (var i = s.messages.length - 1; i >= 0; i--) { if (s.messages[i].role === 'ai') { lastMsg = stripMd(s.messages[i].text).slice(0, 34); break; } }
        return '<div class="row' + (s.id === state.selSession ? ' on' : '') + '" data-act="open-session" data-id="' + s.id + '">' +
          '<div class="r-main"><div class="r-t">' + esc(s.title) + '</div><div class="r-s">' + esc(s.updated.slice(5, 16)) + ' · ' + esc(lastMsg || '（暂无消息）') + '</div></div>' +
          '<button class="icon-btn row-act" title="删除会话" data-act="del-session" data-id="' + s.id + '">' + I('trash') + '</button></div>';
      }).join('');
    h = '<div class="ctx-hd"><h4>会 话</h4><button class="icon-btn" title="新建会话" data-act="new-session">' + I('plus') + '</button></div>' +
      '<div class="ctx-search">' + I('search') + '<input id="chatSearch" placeholder="搜索会话…" value="' + esc(q) + '"></div>' +
      '<div class="ctx-body">' + (list || '<div class="empty"><div class="glyph">话</div><p>' + (q ? '没有匹配的会话' : '还没有会话') + '</p>' +
        (q ? '' : '<button class="btn primary sm" data-act="new-session">开始第一段对话</button>') + '</div>') + '</div>';
  } else if (state.tab === 'text') {
    var rows = [];
    p.volumes.forEach(function (v) {
      rows.push('<div style="padding:8px 10px 3px;font-size:11px;color:var(--ink3);letter-spacing:.1em">' + esc(v.name) + '</div>');
      v.items.forEach(function (it) {
        var ms = null;
        p.chapters.forEach(function (c) { if (c.no === it.no) ms = c; });
        var wc = ms ? wordCount(ms.text) : 0;
        rows.push('<div class="row' + (state.selCh === it.no ? ' on' : '') + '" data-act="open-chapter" data-no="' + it.no + '">' +
          '<span class="ch-no">' + fmtCh(it.no) + '</span>' +
          '<div class="r-main"><div class="r-t">' + esc(it.title) + '</div><div class="r-s">' + (ms ? wc.toLocaleString() + ' 字 · ' + it.status : it.status + ' · 未写') + '</div></div>' +
          (ms ? '<button class="icon-btn row-act" title="删除稿件" data-act="del-chapter" data-no="' + it.no + '">' + I('trash') + '</button>' : '') +
          '</div>');
      });
    });
    h = '<div class="ctx-hd"><h4>章 节</h4><span class="mono dim" style="font-size:11px">' + p.chapters.length + ' 篇已写</span></div>' +
      '<div class="ctx-body">' + (rows.join('') || '<div class="empty"><div class="glyph">章</div><p>还没有章节</p><button class="btn primary sm" data-act="tab" data-tab="outline">去排大纲</button></div>') + '</div>';
  } else if (state.tab === 'chars') {
    var crows = p.chars.map(function (c) {
      return '<div class="row' + (c.id === state.selChar ? ' on' : '') + '" data-act="pick-char" data-id="' + c.id + '">' +
        '<span class="spine" style="background:' + c.color + ';width:26px;height:26px;border-radius:7px;font-size:13px">' + esc(c.name.charAt(0)) + '</span>' +
        '<div class="r-main"><div class="r-t">' + esc(c.name) + '</div><div class="r-s">' + esc(c.role) + '</div></div>' +
        '<span class="tag" style="align-self:center">' + c.chapters.length + ' 章</span></div>';
    }).join('');
    h = '<div class="ctx-hd"><h4>人物表</h4><button class="icon-btn" title="新增人物" data-act="add-char">' + I('plus') + '</button></div>' +
      '<div class="ctx-body">' + (crows || '<div class="empty"><div class="glyph">人</div><p>还没有登记人物</p><button class="btn primary sm" data-act="add-char">新增主角</button></div>') + '</div>';
  } else if (state.tab === 'outline') {
    var st = projStats(p);
    var rate = st.fsp ? Math.round(st.fspDone / st.fsp * 100) : 0;
    h = '<div class="ctx-hd"><h4>模块导航</h4></div><div class="ctx-body">' +
      '<div class="row' + (state.outlineView === 'struct' ? ' on' : '') + '" data-act="outline-view" data-v="struct"><div class="r-main"><div class="r-t">卷章结构</div><div class="r-s">' + p.volumes.length + ' 卷 · ' + st.plan + ' 章节拍</div></div>' + I('chevR') + '</div>' +
      '<div class="row' + (state.outlineView === 'fsp' ? ' on' : '') + '" data-act="outline-view" data-v="fsp"><div class="r-main"><div class="r-t">伏笔追踪</div><div class="r-s">' + st.fsp + ' 条 · 回收率 ' + rate + '%</div></div>' + I('chevR') + '</div>' +
      '<div style="padding:14px 10px">' +
      '<div class="notice">点击章行可循环切换状态：构思 → 大纲 → 草稿 → 待修 → 定稿。伏笔支持标记回收 / 撤销回收 / 新增。</div>' +
      '<div style="margin-top:12px"><button class="btn" data-act="inspect" style="width:100%;justify-content:center">' + I('search') + ' 一致性巡检</button></div>' +
      '</div></div>';
  } else if (state.tab === 'world') {
    var cats = ['全部'].concat(WORLD_CATS.filter(function (c) {
      return p.entries.some(function (e) { return e.cat === c; });
    }));
    var nav = cats.map(function (c) {
      var cnt = c === '全部' ? p.entries.length : p.entries.filter(function (e) { return e.cat === c; }).length;
      return '<div class="row' + (state.worldCat === c ? ' on' : '') + '" data-act="world-cat" data-c="' + esc(c) + '">' +
        '<div class="r-main"><div class="r-t">' + esc(c) + '</div></div><span class="cnt">' + cnt + '</span></div>';
    }).join('');
    h = '<div class="ctx-hd"><h4>分类导航</h4><button class="icon-btn" title="新增词条" data-act="add-entry">' + I('plus') + '</button></div><div class="ctx-body cat-nav">' + nav + '</div>';
  } else if (state.tab === 'board') {
    var tracks = (p.tracks || []).map(function (t) {
      var on = state.boardTracks[t.id] !== false;
      return '<div class="row" style="cursor:default"><label style="display:flex;align-items:center;gap:8px;cursor:pointer;flex:1">' +
        '<input type="checkbox" data-act="track-toggle" data-id="' + t.id + '"' + (on ? ' checked' : '') + '> ' +
        '<span class="r-t" style="font-size:13px">' + esc(t.name) + '</span></label>' +
        '<span class="tag" style="align-self:center;background:' + t.color + '22;color:' + t.color + ';border-color:' + t.color + '55">' + p.events.filter(function (e) { return e.track === t.id; }).length + '</span></div>';
    }).join('');
    h = '<div class="ctx-hd"><h4>时间线轨道</h4></div><div class="ctx-body">' +
      (tracks || '<div class="empty"><div class="glyph">轨</div><p>暂无轨道</p></div>') +
      '<div style="padding:14px 10px"><div class="notice">时间线横向滚动；点事件节点看详情并可跳转章节。看板数字全部由当前数据实时计算。</div></div></div>';
  }
  el.innerHTML = h;
}

/* ---------- 主区路由 ---------- */
function renderMain() {
  var el = document.getElementById('colMain');
  var p = cur();
  if (!p) { el.innerHTML = renderShelfMain(); afterRender(); return; }
  var h = '';
  if (state.tab === 'shelf') h = renderShelfMain(p);
  else if (state.tab === 'chat') h = renderChat(p);
  else if (state.tab === 'text') h = renderText(p);
  else if (state.tab === 'chars') h = renderChars(p);
  else if (state.tab === 'outline') h = renderOutline(p);
  else if (state.tab === 'world') h = renderWorld(p);
  else if (state.tab === 'board') h = renderBoard(p);
  el.innerHTML = h;
  afterRender();
}
function afterRender() {
  if (state.tab === 'chars') startGraph();
  if (state.tab === 'chat') {
    var sc = document.querySelector('.chat-scroll');
    if (sc && state._pinChat !== false) sc.scrollTop = sc.scrollHeight;
    if (state.pendingInput) {
      var ta = document.getElementById('chatInput');
      if (ta) {
        ta.value = state.pendingInput;
        ta.style.height = 'auto';
        ta.style.height = Math.min(150, ta.scrollHeight) + 'px';
        ta.focus();
      }
      state.pendingInput = null;
    }
  }
}

/* ---------- 模块 1 · 书架主页 ---------- */
function renderShelfMain(p) {
  var cards = state.projects.map(function (x) {
    var st = projStats(x);
    var pct = Math.min(100, Math.round(st.words / x.targetWords * 100));
    return '<div class="card book-card fade-in">' +
      '<div class="bc-top"><span class="spine" style="background:' + x.spineColor + '">' + esc(x.title.charAt(0)) + '</span>' +
      '<div style="min-width:0"><h4>' + esc(x.title) + '</h4><div class="dim" style="font-size:12px">' + x.genre + ' · ' + x.pov + ' · ' + (x.tones || []).join(' / ') + '</div></div></div>' +
      '<div class="bc-brief">' + esc(x.brief || '暂无简介') + '</div>' +
      '<div class="bc-meta"><span class="tag">' + st.written + '/' + st.plan + ' 章</span><span class="tag">' + st.words.toLocaleString() + ' 字</span><span class="tag">' + st.chars + ' 人物</span><span class="tag">' + st.fsp + ' 伏笔</span></div>' +
      '<div style="display:flex;align-items:center;gap:10px"><div class="progress"><i style="width:' + pct + '%"></i></div><span class="mono dim" style="font-size:11px">' + pct + '%</span></div>' +
      '<div class="bc-acts">' +
      '<button class="btn danger sm" data-act="del-project" data-id="' + x.id + '">' + I('trash') + ' 删除</button>' +
      '<button class="btn primary sm" data-act="open-project" data-id="' + x.id + '">' + I('book') + (x.id === state.activeId ? ' 继续写' : ' 进入') + '</button>' +
      '</div></div>';
  }).join('');
  var empty = state.projects.length ? '' :
    '<div class="empty"><div class="glyph">架</div><p>书架空了。每一部长篇都是从一行简介开始的。</p><button class="btn primary" data-act="new-project">' + I('plus') + ' 新建第一部作品</button></div>';
  return '<div class="shelf-grid" style="overflow-y:auto;flex:1">' + cards + empty + '</div>';
}

/* ---------- 模块 2 · Agent 对话 ---------- */
function currentSession() {
  var p = cur(), s = null;
  p.sessions.forEach(function (x) { if (x.id === state.selSession) s = x; });
  return s;
}
function renderMsg(m, idx) {
  if (m.role === 'user') {
    return '<div class="msg user fade-in"><span class="avatar">我</span><div class="bubble">' + md(m.text) + '</div></div>';
  }
  var live = !!m.streaming;
  var thinkHtml = '';
  if (m.think && m.think.length) {
    var open = live ? true : !!m.thinkOpen;
    thinkHtml = '<div class="think' + (open ? ' open' : '') + (live ? ' live' : '') + '">' +
      '<div class="think-hd" data-act="think-toggle">' +
      (live ? '<span class="pulse"></span>' : '') +
      '<span>' + (live ? '正在思考…' : '思考过程') + '</span>' +
      '<svg class="chev" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M3 9l4-4 4 4"/></svg>' +
      '</div>' +
      (open ? '<div class="think-body">' + m.think.map(function (t) { return '<span>· ' + esc(t) + '</span>'; }).join('') + '</div>' : '') +
      '</div>';
  }
  var toolsHtml = '';
  if (m.tools && m.tools.length) {
    toolsHtml = m.tools.map(function (t, ti) {
      var st = t.state === 'done'
        ? '<span class="tc-state done">' + I('check') + ' 完成</span>'
        : t.state === 'run'
          ? '<span class="tc-state run"><span class="spinner"></span> 调用中</span>'
          : '<span class="tc-state wait">' + I('clock') + ' 等待</span>';
      return '<div class="toolcard' + (t.state === 'done' && t.open ? ' open' : '') + '">' +
        '<div class="tc-hd" data-act="tool-toggle" data-ti="' + ti + '">' +
        '<span class="tc-name">' + esc(t.name) + '</span>' +
        '<span class="tc-args">' + esc(t.args) + '</span>' + st + '</div>' +
        '<div class="tc-result">' + esc(t.result) + '</div></div>';
    }).join('');
  }
  var shown = m.streaming ? m.text.slice(0, m.shown || 0) : m.text;
  var body = md(shown) + (m.streaming ? '<span class="cursor"></span>' : '');
  return '<div class="msg ai fade-in"><span class="avatar">墨</span><div class="bubble">' +
    '<div class="who"><b>墨案 Agent</b><span class="tag">' + esc(m.intentLabel || '数据驱动') + '</span></div>' +
    thinkHtml + toolsHtml +
    '<div class="md-body js-md">' + body + '</div>' +
    '</div></div>';
}
function renderChat(p) {
  var s = currentSession();
  if (!s) {
    var emptyMsg = p.sessions.length === 0
      ? '《' + p.title + '》还没有会话。第一段对话可以从一句「你好」开始，我会盘点这个项目的家底。'
      : '选一个会话，或者新建一个。';
    return '<div class="chat-wrap"><div class="chat-scroll"><div class="empty" style="padding-top:12vh">' +
      '<div class="glyph">话</div><p>' + esc(emptyMsg) + '</p>' +
      '<button class="btn primary" data-act="new-session">' + I('plus') + ' 开始第一段对话</button></div></div></div>';
  }
  var msgs = s.messages.map(renderMsg).join('');
  var chips = [
    { q: '接着写下一章', t: '续写下一章' },
    { q: '把所有伏笔的埋收状态理一遍', t: '梳理伏笔' },
    { q: '诊断一下大纲节奏', t: '诊断节奏' },
    { q: '分析主要人物的动机', t: '人物分析' },
    { q: '我有点卡文了', t: '卡文疏导' },
    { q: '给未定名的角色取名', t: '取名' }
  ].map(function (c) { return '<button class="chip" data-act="chip" data-q="' + esc(c.q) + '">' + esc(c.t) + '</button>'; }).join('');
  var st = projStats(p);
  var streaming = state.stream && state.stream.sessionId === s.id;
  var sendBtn = streaming
    ? '<button class="btn danger" data-act="stop-stream">' + I('stop') + ' 停止生成</button>'
    : '<button class="btn primary" data-act="send-chat">' + I('send') + ' 落笔</button>';
  var meta = [];
  if (state.selCh) meta.push('<span class="tag">当前章 ' + fmtCh(state.selCh) + '</span>');
  meta.push('<span class="tag">人物 ' + st.chars + '</span>');
  meta.push('<span class="tag">伏笔 ' + st.fsp + ' · 悬空 ' + st.fspDangling + '</span>');
  return '<div class="chat-wrap">' +
    '<div class="chat-scroll"><div class="chat-inner">' +
    (msgs || '<div class="notice kai" style="font-size:13px">新会话。问我续写、伏笔、节奏、人物，或者点下面的快捷指令——我的回答全部来自《' + esc(p.title) + '》此刻的真实数据。</div>') +
    '</div></div>' +
    '<div class="chips">' + chips + '</div>' +
    '<div class="chat-input">' +
    '<div class="ci-box"><textarea id="chatInput" rows="1" placeholder="问点什么…（' + esc(p.title) + '）"></textarea>' + sendBtn + '</div>' +
    '<div class="ci-meta"><span>Enter 发送 · Shift+Enter 换行</span><span class="grow"></span>' + meta.join('') + '</div>' +
    '</div></div>';
}

/* ---------- 对话引擎：会话管理 + 流式输出 ---------- */
function newSession(p) {
  var s = { id: uid('s'), title: '新会话', updated: nowStr(), messages: [] };
  p.sessions.unshift(s);
  state.selSession = s.id;
  return s;
}
function sendChat(text) {
  var t = String(text || '').trim();
  if (!t) return;
  finalizeAllStreams('complete');
  var p = cur();
  var s = currentSession() || newSession(p);
  s.messages.push({ role: 'user', text: t });
  if (s.title === '新会话') s.title = stripMd(t).slice(0, 22) || '新会话';
  s.updated = nowStr();
  var r = compose(p, route(t), t);
  var labelMap = { greet: '问候', continue: '续写', char: '人物', foreshadow: '伏笔', rhythm: '节奏', polish: '润色', stuck: '疏导', naming: '取名', fallback: '兜底' };
  var msg = {
    role: 'ai', intent: r.intent, intentLabel: labelMap[r.intent] || '数据驱动',
    text: r.answer, think: r.think,
    tools: r.tools.map(function (x) { return { name: x.name, args: x.args, result: x.result, state: 'wait' }; }),
    streaming: true, shown: 0, thinkOpen: true
  };
  s.messages.push(msg);
  state.stream = { sessionId: s.id, msg: msg, stage: 0 };
  renderAll();
  stepStream();
}
function stepStream() {
  var st = state.stream;
  if (!st) return;
  var msg = st.msg;
  if (st.stage === 0) {
    st.timer = setTimeout(function () { st.stage = 1; st.toolIdx = 0; stepStream(); }, 450);
  } else if (st.stage === 1) {
    if (msg.tools.length && st.toolIdx < msg.tools.length) {
      msg.tools[st.toolIdx].state = 'run';
      renderAll();
      st.timer = setTimeout(function () {
        msg.tools[st.toolIdx].state = 'done';
        st.toolIdx += 1;
        stepStream();
      }, 620);
    } else {
      st.stage = 2;
      stepStream();
    }
  } else {
    if (!st.tick) {
      st.tick = setInterval(function () {
        var m = state.stream && state.stream.msg;
        if (!m) return;
        m.shown = Math.min(m.text.length, (m.shown || 0) + 3);
        updateStreamDom(m);
        if (m.shown >= m.text.length) finishStream(false);
      }, 26);
    }
  }
}
function updateStreamDom(m) {
  var nodes = document.querySelectorAll('.chat-inner .msg.ai');
  var last = nodes[nodes.length - 1];
  if (!last) { renderAll(); return; }
  var body = last.querySelector('.js-md');
  if (body) {
    body.innerHTML = md(m.text.slice(0, m.shown || 0)) + (m.shown < m.text.length ? '<span class="cursor"></span>' : '');
  }
  var sc = document.querySelector('.chat-scroll');
  if (sc) sc.scrollTop = sc.scrollHeight;
}
function finishStream(stopped) {
  var st = state.stream;
  if (!st) return;
  clearTimeout(st.timer);
  clearInterval(st.tick);
  var msg = st.msg;
  msg.tools.forEach(function (t) { if (t.state !== 'done') t.state = 'done'; });
  msg.streaming = false;
  msg.thinkOpen = false;
  msg.shown = msg.text.length;
  if (stopped) msg.text += '\n\n*（已停止生成，以上为已产出内容。）*';
  state.stream = null;
  renderAll();
}
/* 切换模块 / 会话时：半截消息立即补全，不留残光标 */
function finalizeAllStreams() {
  if (state.stream) finishStream(false);
}

/* ---------- 模块 3 · 正文：阅读 + 编辑 ---------- */
function chapterMs(p, no) {
  var r = null;
  p.chapters.forEach(function (c) { if (c.no === no) r = c; });
  return r;
}
function renderText(p) {
  if (!p.volumes.length && !p.chapters.length) {
    return '<div class="empty" style="flex:1;justify-content:center"><div class="glyph">章</div>' +
      '<p>《' + esc(p.title) + '》还没有章节。先排大纲，或直接写下第一行。</p>' +
      '<div style="display:flex;gap:10px"><button class="btn primary" data-act="tab" data-tab="outline">去排大纲</button>' +
      '<button class="btn" data-act="write-first">直接写第一章</button></div></div>';
  }
  var no = state.selCh;
  var ms = chapterMs(p, no);
  var ol = findOutline(p, no);
  var volName = ol ? ol.vol.name : '';
  var focusBtn = state.focus
    ? '<button class="btn sm" data-act="focus-exit">退出专注</button>'
    : '<button class="btn sm ghost" data-act="focus-on">' + I('focus') + ' 专注阅读</button>';
  var top = '<div class="text-top">' +
    '<span class="vol-tag">' + esc(volName || '未分卷') + '</span>' +
    '<h2>' + fmtCh(no) + ' · ' + esc(ms ? ms.title : (ol ? ol.item.title : '无题')) + '</h2>' +
    '<div class="seg">' +
    '<button class="' + (state.textMode === 'read' ? 'on' : '') + '" data-act="text-mode" data-m="read">阅读</button>' +
    '<button class="' + (state.textMode === 'edit' ? 'on' : '') + '" data-act="text-mode" data-m="edit">编辑</button>' +
    '</div>' +
    '<div class="meta">' +
    (ms ? '<span class="mono">' + wordCount(ms.text).toLocaleString() + ' 字</span><span>·</span><span>' + esc(ms.writtenOn || '今日') + '</span>' : '<span class="tag zhe">未写</span>') +
    (ol ? '<span class="tag">' + esc(ol.item.status) + '</span>' : '') + focusBtn +
    '</div></div>';
  if (!ms) {
    var beat = ol ? ol.item.beat : '（暂无节拍）';
    return top + '<div class="empty" style="flex:1;justify-content:center"><div class="glyph">墨</div>' +
      '<p class="kai" style="font-size:14px">本章大纲节拍：' + esc(beat) + '</p>' +
      '<p>这一章还没有正文。可以让 Agent 按节拍起草，也可以自己落笔。</p>' +
      '<div style="display:flex;gap:10px">' +
      '<button class="btn primary" data-act="draft-chapter" data-no="' + no + '">' + I('spark') + ' 让 Agent 起草本章</button>' +
      '<button class="btn" data-act="write-chapter" data-no="' + no + '">' + I('edit') + ' 我自己写</button></div></div>';
  }
  if (state.textMode === 'read') {
    var list = p.chapters.slice().sort(function (a, b) { return a.no - b.no; });
    var idx = 0;
    list.forEach(function (c, i) { if (c.no === no) idx = i; });
    var prev = list[idx - 1], next = list[idx + 1];
    var paras = ms.text.split(/\n+/).filter(Boolean).map(function (t) { return '<p>' + esc(t) + '</p>'; }).join('');
    return top + '<div class="prose-scroll"><div class="prose">' + paras + '</div></div>' +
      '<div class="pager">' +
      '<button class="btn sm" data-act="goto-chapter" data-no="' + (prev ? prev.no : '') + '"' + (prev ? '' : ' disabled') + '>上一章</button>' +
      '<span class="pos">' + fmtCh(no) + ' · ' + (idx + 1) + '/' + list.length + '</span>' +
      '<button class="btn sm" data-act="goto-chapter" data-no="' + (next ? next.no : '') + '"' + (next ? '' : ' disabled') + '>下一章</button>' +
      '</div>';
  }
  // 编辑态
  var total = projStats(p).words;
  return top + '<div class="edit-wrap">' +
    '<input class="edit-title" id="editTitle" value="' + esc(ms.title) + '" placeholder="章题">' +
    '<div style="position:relative;flex:1;display:flex;min-height:0">' +
    '<textarea class="edit-area" id="editArea" spellcheck="false">' + esc(ms.text) + '</textarea>' +
    '<div class="selbar" id="selbar" style="display:none">' +
    '<button data-act="rewrite" data-op="polish">润色</button>' +
    '<button data-act="rewrite" data-op="simplify">精简</button>' +
    '<button data-act="rewrite" data-op="expand">扩写</button>' +
    '<button data-act="rewrite" data-op="pov">改人称</button>' +
    '</div></div>' +
    '<div class="edit-status">' +
    '<span id="editCount" class="mono">本章 ' + wordCount(ms.text).toLocaleString() + ' 字</span>' +
    '<span class="sep" style="color:var(--line2)">|</span>' +
    '<span>全书 ' + total.toLocaleString() + ' 字（全量实算，编辑实时累加）</span>' +
    '<span style="flex:1"></span>' +
    '<span class="dim">选中文字出现操作条</span>' +
    '<button class="btn sm ghost" data-act="focus-on">' + I('focus') + ' 专注</button>' +
    '</div></div>';
}

/* ---------- 改写引擎：真实字符串变换，必有可见变化 ---------- */
var EXPAND_BANK = {
  '悬疑': ['风从窗缝里挤进来，灯焰矮了一下。', '远处传来一两声犬吠，很快被雾吞掉。', '潮气爬上桌面，纸页的边角悄悄卷起。'],
  '玄幻': ['炉火噼啪响了一声，铁腥气浮上来。', '檐角的铜铃无风自鸣，声音很轻。', '山雾漫过门槛，像来看热闹的客。'],
  '科幻': ['舱壁的冷凝水珠缓缓滑落。', '换气扇的嗡鸣低了一度。', '舷窗外，晨昏线静静移过。'],
  '日常': ['巷口的风把招牌吹得轻轻晃。', '水壶在炉上发出将沸未沸的响。', '阳光挪过桌角，落在旧报纸上。'],
  '通用': ['光线暗了一暗，又亮回来。', '有什么声音远了，又近了。']
};
function splitSentences(s) {
  return s.match(/[^。！？]+[。！？]?/g) || [s];
}
function longestSentence(s) {
  var arr = splitSentences(s), best = '';
  arr.forEach(function (x) { if (x.length > best.length) best = x; });
  return best;
}
function commaBreak(s) {
  var best = longestSentence(s);
  var commas = [];
  for (var i = 0; i < best.length; i++) if (best.charAt(i) === '，') commas.push(i);
  if (commas.length === 0) return null;
  var mid = commas[Math.floor(commas.length / 2)];
  var fixed = best.slice(0, mid) + '。' + best.slice(mid + 1);
  return s.replace(best, fixed);
}
function rewriteText(s, op, genre, seed) {
  seed = seed || 0;
  var out = s;
  if (op === 'polish') {
    var dict = [
      ['忽然', '蓦地'], ['非常', '极'], ['看着', '望着'], ['很快', '旋即'],
      ['心里', '心底'], ['说道', '道'], ['沉默了片刻', '沉默半晌'], ['低声说', '压低嗓子'],
      ['大喊', '扬声'], ['慢慢地', '缓缓']
    ];
    dict.forEach(function (pair) { if (out.indexOf(pair[0]) >= 0) out = out.split(pair[0]).join(pair[1]); });
  } else if (op === 'simplify') {
    var sents = splitSentences(out);
    var changed = false;
    var rebuilt = sents.map(function (sen) {
      if (changed) return sen;
      var clauses = sen.split('，');
      var hit = -1;
      for (var i = 0; i < clauses.length; i++) {
        if (/像|仿佛|好像|似的|如同/.test(clauses[i])) { hit = i; break; }
      }
      if (hit >= 0 && clauses.length > 1) {
        changed = true;
        clauses.splice(hit, 1);
        return clauses.join('，');
      }
      return sen;
    });
    if (!changed) {
      var short = null, si = -1;
      sents.forEach(function (sen, i) {
        var clauses2 = sen.split('，');
        if (clauses2.length > 2) {
          clauses2.forEach(function (cl, j) {
            if (cl && (short === null || cl.length < short.length)) { short = cl; si = i; }
          });
        }
      });
      if (short !== null) {
        var parts = sents[si].split('，');
        var at = parts.indexOf(short);
        parts.splice(at, 1);
        sents[si] = parts.join('，');
        changed = true;
      }
    }
    if (changed) out = rebuilt !== sents ? rebuilt.join('') : sents.join('');
  } else if (op === 'expand') {
    var bank = EXPAND_BANK[genre] || EXPAND_BANK['通用'];
    var insert = bank[seed % bank.length];
    var at = out.indexOf('。');
    if (at >= 0) out = out.slice(0, at + 1) + insert + out.slice(at + 1);
    else out = out + '。' + insert;
  } else if (op === 'pov') {
    var A = '\u0001';
    out = out.split('他').join(A).split('她').join('他').split(A).join('她');
    if (out === s) {
      out = out.split('自己').join('他');
    }
  }
  if (out === s) {
    var broken = commaBreak(s);
    if (broken && broken !== s) out = broken;
    else {
      var bank2 = EXPAND_BANK[genre] || EXPAND_BANK['通用'];
      out = s + '。' + bank2[(seed + 1) % bank2.length];
    }
  }
  return out;
}

/* ---------- 模块 4 · 人物关系：力导向图 + 档案 ---------- */
var graph = { nodes: [], edges: [], alpha: 0, raf: 0, drag: null, w: 0, h: 0 };
function buildGraph(p) {
  var box = document.querySelector('.graphbox svg.graph');
  var w = 800, h = 520;
  if (box) { var r = box.getBoundingClientRect(); if (r.width > 50 && r.height > 50) { w = r.width; h = r.height; } }
  graph.w = w; graph.h = h;
  var n = p.chars.length;
  graph.nodes = p.chars.map(function (c, i) {
    var ang = (i / Math.max(1, n)) * Math.PI * 2 - Math.PI / 2;
    var rx = w * 0.34, ry = h * 0.34;
    return { id: c.id, c: c, x: w / 2 + Math.cos(ang) * rx, y: h / 2 + Math.sin(ang) * ry, vx: 0, vy: 0, fixed: false };
  });
  graph.edges = p.relations.map(function (r) { return { a: r.a, b: r.b, rel: r }; });
  graph.alpha = 1;
}
function nodeById(id) {
  var r = null;
  graph.nodes.forEach(function (n) { if (n.id === id) r = n; });
  return r;
}
function tickGraph() {
  var ns = graph.nodes, es = graph.edges;
  var i, j, a, b;
  // 斥力
  for (i = 0; i < ns.length; i++) {
    for (j = i + 1; j < ns.length; j++) {
      a = ns[i]; b = ns[j];
      var dx = b.x - a.x, dy = b.y - a.y;
      var d2 = dx * dx + dy * dy || 1;
      var d = Math.sqrt(d2);
      var f = 9000 / d2;
      var fx = dx / d * f, fy = dy / d * f;
      if (!a.fixed) { a.vx -= fx; a.vy -= fy; }
      if (!b.fixed) { b.vx += fx; b.vy += fy; }
    }
  }
  // 弹簧
  for (i = 0; i < es.length; i++) {
    a = nodeById(es[i].a); b = nodeById(es[i].b);
    if (!a || !b) continue;
    var ddx = b.x - a.x, ddy = b.y - a.y;
    var dd = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
    var f2 = (dd - 150) * 0.02;
    var fx2 = ddx / dd * f2, fy2 = ddy / dd * f2;
    if (!a.fixed) { a.vx += fx2; a.vy += fy2; }
    if (!b.fixed) { b.vx -= fx2; b.vy -= fy2; }
  }
  // 向心 + 阻尼 + 边界
  for (i = 0; i < ns.length; i++) {
    a = ns[i];
    if (a.fixed) { a.vx = 0; a.vy = 0; continue; }
    a.vx += (graph.w / 2 - a.x) * 0.012;
    a.vy += (graph.h / 2 - a.y) * 0.015;
    a.vx *= 0.82; a.vy *= 0.82;
    a.x += a.vx * graph.alpha;
    a.y += a.vy * graph.alpha;
    a.x = Math.max(46, Math.min(graph.w - 46, a.x));
    a.y = Math.max(40, Math.min(graph.h - 46, a.y));
  }
  graph.alpha *= 0.985;
}
function drawGraph(p) {
  var svg = document.querySelector('.graphbox svg.graph');
  if (!svg) return;
  var sel = state.selChar;
  var linked = {};
  if (sel) {
    linked[sel] = true;
    p.relations.forEach(function (r) {
      if (r.a === sel) linked[r.b] = true;
      if (r.b === sel) linked[r.a] = true;
    });
  }
  var edgeHtml = graph.edges.map(function (e) {
    var a = nodeById(e.a), b = nodeById(e.b);
    if (!a || !b) return '';
    var meta = REL_TYPES[e.rel.type] || { color: '#55504a', dash: '' };
    var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    var dim = sel && !linked[e.a] && !linked[e.b] ? ' dim' : '';
    return '<g class="edge' + dim + '"><line x1="' + a.x.toFixed(1) + '" y1="' + a.y.toFixed(1) + '" x2="' + b.x.toFixed(1) + '" y2="' + b.y.toFixed(1) + '" stroke="' + meta.color + '" stroke-width="1.6"' + (meta.dash ? ' stroke-dasharray="' + meta.dash + '"' : '') + ' opacity=".75"/>' +
      '<text x="' + mx.toFixed(1) + '" y="' + (my - 4).toFixed(1) + '" text-anchor="middle">' + esc(e.rel.label || e.rel.type) + '</text></g>';
  }).join('');
  var nodeHtml = graph.nodes.map(function (n) {
    var dim = sel && !linked[n.id] ? ' dim' : '';
    var nm = n.c.name;
    var disp = nm.length > 5 ? nm.slice(0, 5) + '…' : nm;
    var ring = n.id === sel ? ' stroke="#a8433a" stroke-width="3"' : ' stroke="#fbf8f0" stroke-width="2"';
    return '<g class="node' + dim + '" data-act="pick-char" data-id="' + n.id + '" transform="translate(' + n.x.toFixed(1) + ',' + n.y.toFixed(1) + ')">' +
      '<title>' + esc(nm) + '</title>' +
      '<circle r="24" fill="' + n.c.color + '"' + ring + '/>' +
      '<text y="5" text-anchor="middle" style="fill:#fbf8f0;stroke:none;font-family:var(--kai);font-size:15px">' + esc(nm.charAt(0)) + '</text>' +
      '<text y="42" text-anchor="middle">' + esc(disp) + '</text></g>';
  }).join('');
  svg.setAttribute('viewBox', '0 0 ' + graph.w + ' ' + graph.h);
  svg.innerHTML = '<g class="edges">' + edgeHtml + '</g><g class="nodes">' + nodeHtml + '</g>';
}
function startGraph() {
  var p = cur();
  if (!p.chars.length) { cancelAnimationFrame(graph.raf); return; }
  if (!graph.nodes.length || graph.nodes.length !== p.chars.length || graph.pid !== p.id) {
    graph.pid = p.id;
    buildGraph(p);
    bindGraphDrag();
  }
  cancelAnimationFrame(graph.raf);
  var loop = function () {
    if (state.tab !== 'chars') return;
    if (graph.alpha > 0.02 || graph.drag) {
      tickGraph();
      drawGraph(p);
    }
    graph.raf = requestAnimationFrame(loop);
  };
  graph.raf = requestAnimationFrame(loop);
}
function bindGraphDrag() {
  var svg = document.querySelector('.graphbox svg.graph');
  if (!svg || svg._bound) return;
  svg._bound = true;
  function toXY(ev) {
    var r = svg.getBoundingClientRect();
    return { x: (ev.clientX - r.left) / r.width * graph.w, y: (ev.clientY - r.top) / r.height * graph.h };
  }
  svg.addEventListener('pointerdown', function (ev) {
    var g = ev.target.closest('.node');
    if (!g) return;
    var n = nodeById(g.getAttribute('data-id'));
    if (!n) return;
    graph.drag = n;
    n.fixed = true;
    graph.alpha = Math.max(graph.alpha, 0.5);
    svg.setPointerCapture(ev.pointerId);
    ev.preventDefault();
  });
  svg.addEventListener('pointermove', function (ev) {
    if (!graph.drag) return;
    var xy = toXY(ev);
    graph.drag.x = Math.max(46, Math.min(graph.w - 46, xy.x));
    graph.drag.y = Math.max(40, Math.min(graph.h - 46, xy.y));
    graph.alpha = Math.max(graph.alpha, 0.35);
  });
  svg.addEventListener('pointerup', function () {
    if (graph.drag) graph.drag.fixed = false;
    graph.drag = null;
  });
}
function renderChars(p) {
  if (!p.chars.length) {
    return '<div class="empty" style="flex:1;justify-content:center"><div class="glyph">人</div>' +
      '<p>《' + esc(p.title) + '》还没有人物。先立主角，再立一个让主角秘密藏不住的人。</p>' +
      '<button class="btn primary" data-act="add-char">' + I('plus') + ' 新增人物</button></div>';
  }
  var c = null;
  p.chars.forEach(function (x) { if (x.id === state.selChar) c = x; });
  if (!c) c = p.chars[0];
  var relList = [];
  p.relations.forEach(function (r) {
    if (r.a !== c.id && r.b !== c.id) return;
    var otherId = r.a === c.id ? r.b : r.a;
    var other = null;
    p.chars.forEach(function (x) { if (x.id === otherId) other = x; });
    var meta = REL_TYPES[r.type] || { color: '#55504a' };
    relList.push('<div style="display:flex;gap:8px;align-items:center;font-size:12.5px">' +
      '<span class="tag" style="background:' + meta.color + '18;color:' + meta.color + ';border-color:' + meta.color + '55">' + esc(r.type) + '</span>' +
      '<b>' + esc(other ? other.name : '未登记') + '</b><span class="dim">' + esc(r.label) + '</span></div>');
  });
  var legend = Object.keys(REL_TYPES).filter(function (k) {
    return p.relations.some(function (r) { return r.type === k; });
  }).map(function (k) {
    var meta = REL_TYPES[k];
    return '<div class="lg-i"><svg viewBox="0 0 26 8"><line x1="1" y1="4" x2="25" y2="4" stroke="' + meta.color + '" stroke-width="2"' + (meta.dash ? ' stroke-dasharray="' + meta.dash + '"' : '') + '/></svg>' + esc(k) + '</div>';
  }).join('');
  return '<div class="chars-wrap">' +
    '<div class="graphbox' + (state.selChar ? ' focused' : '') + '">' +
    '<div class="legend"><div class="lg-t">关系类型</div>' + legend + '</div>' +
    '<svg class="graph"></svg></div>' +
    '<div class="profile">' +
    '<div class="pf-hd"><span class="pf-seal" style="background:' + c.color + '">' + esc(c.name.charAt(0)) + '</span>' +
    '<div><h3>' + esc(c.name) + '</h3><div class="pf-role">' + esc(c.role) + ' · ' + esc(c.gender) + '</div></div></div>' +
    '<div class="pf-field"><span class="lb">外在形象</span><span class="vl">' + esc(c.look) + '</span></div>' +
    '<div class="pf-duel">' +
    '<div class="cell"><b>想要什么</b>' + esc(c.want) + '</div>' +
    '<div class="cell"><b>真正需要什么</b>' + esc(c.need) + '</div></div>' +
    '<div class="pf-field"><span class="lb">表层动机</span><span class="vl">' + esc(c.motive) + '</span></div>' +
    '<div class="pf-field"><span class="lb">深层秘密</span><span class="vl kai">' + esc(c.secret) + '</span></div>' +
    '<div class="pf-field"><span class="lb">人物弧光</span><span class="vl">' + esc(c.arc) + '</span></div>' +
    '<div class="pf-field"><span class="lb">出场</span><span class="vl mono" style="font-size:12px">首次 ' + fmtCh(c.firstCh) + ' · 共 ' + c.chapters.length + ' 章（' + c.chapters.map(fmtCh).join(' ') + '）</span></div>' +
    '<div class="pf-field"><span class="lb">关系列表</span><div style="display:flex;flex-direction:column;gap:5px">' + (relList.join('') || '<span class="dim" style="font-size:12px">暂无关系</span>') + '</div></div>' +
    '</div></div>';
}

/* ---------- 模块 5 · 大纲与伏笔 ---------- */
function renderOutline(p) {
  if (state.outlineView === 'fsp') return renderFsp(p);
  if (!p.volumes.length) {
    return '<div class="empty" style="flex:1;justify-content:center"><div class="glyph">纲</div>' +
      '<p>还没有卷章结构。先建一卷，排出前几章的节拍，节奏诊断和看板才有数据可算。</p>' +
      '<button class="btn primary" data-act="add-volume">' + I('plus') + ' 建第一卷</button></div>';
  }
  var vols = p.volumes.map(function (v) {
    var first = v.items[0], lastItem = v.items[v.items.length - 1];
    var rows = v.items.map(function (it) {
      var ms = chapterMs(p, it.no);
      var stCls = it.status === '定稿' ? 'lv' : it.status === '待修' ? 'zhe' : it.status === '草稿' ? 'qing' : it.status === '大纲' ? 'zi' : 'tie';
      return '<div class="ch-row" data-act="cycle-status" data-no="' + it.no + '" title="点击循环切换状态">' +
        '<span class="ch-no">' + fmtCh(it.no) + '</span>' +
        '<span class="ch-title">' + esc(it.title) + '</span>' +
        '<span class="ch-beat">' + esc(it.beat) + '</span>' +
        '<div class="tension-bar" title="张力 ' + it.tension + '/10"><i style="width:' + (it.tension * 10) + '%"></i></div>' +
        '<span class="ch-tension">张 ' + it.tension + '</span>' +
        '<span class="tag ' + stCls + '">' + esc(it.status) + '</span>' +
        (ms ? '<span class="tag seal">' + wordCount(ms.text).toLocaleString() + ' 字</span>' : '<span class="tag">未写</span>') +
        '</div>';
    }).join('');
    return '<div class="card vol-card fade-in"><div class="vol-hd">' +
      '<span class="v-name">' + esc(v.name) + '</span>' +
      (first ? '<span class="v-range">' + fmtCh(first.no) + '–' + fmtCh(lastItem.no) + ' · ' + v.items.length + ' 章</span>' : '') +
      '<span class="v-sum">' + esc(v.summary || '') + '</span>' +
      '<button class="btn sm ghost" data-act="add-chapter" data-vol="' + v.id + '">' + I('plus') + ' 加章</button>' +
      '</div>' + rows + '</div>';
  }).join('');
  return '<div class="out-wrap"><div class="out-inner">' +
    '<div class="notice">章行为大纲计划（可远多于已写稿件）。点击章行循环切换状态：构思 → 大纲 → 草稿 → 待修 → 定稿。</div>' +
    vols + '</div></div>';
}
function renderFsp(p) {
  var st = projStats(p);
  var rate = st.fsp ? Math.round(st.fspDone / st.fsp * 100) : 0;
  var counts = { '已埋设': 0, '部分揭示': 0, '已回收': 0, '悬空': 0 };
  p.foreshadows.forEach(function (f) { counts[f.state] = (counts[f.state] || 0) + 1; });
  var risks = [];
  p.foreshadows.forEach(function (f) {
    if (f.state === '悬空') risks.push('「' + f.name + '」悬空未规划——读者会一直惦记，建议给出揭示或回收计划。');
    if (f.payCh && f.payCh - f.plantCh > 12) risks.push('「' + f.name + '」跨度 ' + (f.payCh - f.plantCh) + ' 章，中途需补一次提醒，否则读者已遗忘。');
  });
  var rows = p.foreshadows.map(function (f) {
    var span = f.payCh ? (f.payCh - f.plantCh) : null;
    var stCls = f.state === '已回收' ? 'lv' : f.state === '部分揭示' ? 'qing' : f.state === '悬空' ? 'zhe' : 'zi';
    var dots = '<span class="dots" title="重要度 ' + f.importance + '/3">' + [1, 2, 3].map(function (i) { return '<i class="' + (i <= f.importance ? 'f' : '') + '"></i>'; }).join('') + '</span>';
    var acts = f.state === '已回收'
      ? '<button class="btn sm" data-act="unharvest" data-id="' + f.id + '">' + I('undo') + ' 撤销回收</button>'
      : '<button class="btn sm primary" data-act="harvest" data-id="' + f.id + '">' + I('check') + ' 标记已回收</button>';
    return '<div class="fsp-row fade-in"><div class="fs-top">' +
      '<span class="fs-name">' + esc(f.name) + '</span>' + dots +
      '<span class="tag ' + stCls + '">' + esc(f.state) + '</span>' +
      (span !== null && span > 12 ? '<span class="tag zhe">跨度风险</span>' : '') +
      '<span style="flex:1"></span>' + acts + '</div>' +
      '<div class="fs-note">' + esc(f.note || '') + '</div>' +
      '<div class="fs-path">埋设 ' + fmtCh(f.plantCh) + ' → ' + (f.payCh ? '回收 ' + fmtCh(f.payCh) + ' · 跨度 ' + span + ' 章' : '<b style="color:var(--zhe)">未规划回收</b>') + '</div>' +
      '</div>';
  }).join('');
  return '<div class="out-wrap"><div class="out-inner">' +
    '<div class="statcards">' +
    '<div class="card statcard"><span class="sc-v">' + st.fsp + '</span><span class="sc-l">伏笔总数</span></div>' +
    '<div class="card statcard"><span class="sc-v">' + counts['已回收'] + '</span><span class="sc-l">已回收</span></div>' +
    '<div class="card statcard warn"><span class="sc-v">' + counts['悬空'] + '</span><span class="sc-l">悬空未规划</span></div>' +
    '<div class="card statcard"><span class="sc-v">' + rate + '%</span><span class="sc-l">回收率</span>' +
    '<div class="progress" style="margin-top:4px"><i style="width:' + rate + '%"></i></div></div>' +
    '</div>' +
    (risks.length ? risks.map(function (r) { return '<div class="riskline warn">' + I('alert') + '<span>' + esc(r) + '</span></div>'; }).join('') : '<div class="riskline info">' + I('check') + '<span>暂无风险提示。</span></div>') +
    '<div class="card" style="overflow:hidden"><div class="hd"><h3>伏笔清单</h3><span class="hint">可写：标记回收 / 撤销 / 新增</span>' +
    '<span style="flex:1"></span><button class="btn sm primary" data-act="add-foreshadow">' + I('plus') + ' 新增伏笔</button></div>' +
    (rows || '<div class="empty"><div class="glyph">伏</div><p>还没有伏笔。先埋一条贴着主角的，再埋一条贴着世界的。</p><button class="btn primary sm" data-act="add-foreshadow">埋下第一条</button></div>') +
    '</div></div></div>';
}

/* ---------- 一致性巡检：全部由真实数据计算 ---------- */
function inspectCompute(p) {
  var out = [];
  p.foreshadows.forEach(function (f) {
    if (f.state === '悬空') out.push({ lv: 'H', where: '伏笔', text: '「' + f.name + '」（' + fmtCh(f.plantCh) + ' 埋设）悬空未规划回收，读者期待无落点。' });
    if (f.payCh && f.payCh - f.plantCh > 12) out.push({ lv: 'M', where: '伏笔', text: '「' + f.name + '」跨度 ' + (f.payCh - f.plantCh) + ' 章（' + fmtCh(f.plantCh) + '→' + fmtCh(f.payCh) + '），超过 12 章遗忘线，建议中途补一次提醒。' });
    if (f.payCh && f.state !== '已回收') {
      var tgt = findOutline(p, f.payCh);
      if (tgt && tgt.item.status === '定稿') out.push({ lv: 'H', where: fmtCh(f.payCh), text: '「' + f.name + '」计划回收章 ' + fmtCh(f.payCh) + ' 已定稿，但伏笔仍未回收——定稿章里它必须有交代。' });
    }
  });
  plateaus(p).forEach(function (t) {
    out.push({ lv: 'M', where: fmtCh(t[0]) + '–' + fmtCh(t[2]), text: '连续三章张力接近，节奏进入平台期，建议中段插入小揭示或小损失。' });
  });
  p.chars.forEach(function (c) {
    if (!c.arc || /静态/.test(c.arc)) return;
    if (c.chapters.length >= 4 && !c.secret) out.push({ lv: 'L', where: '人物', text: '「' + c.name + '」出场 ' + c.chapters.length + ' 章但缺少深层秘密，人物可能过平。' });
  });
  if (!out.length) out.push({ lv: 'L', where: '全局', text: '未发现问题。数据层面的自洽性良好。' });
  var order = { H: 0, M: 1, L: 2 };
  out.sort(function (a, b) { return order[a.lv] - order[b.lv]; });
  return out;
}
function runInspect() {
  var p = cur();
  var steps = ['扫描伏笔清单…', '核对章纲状态…', '计算张力曲线…', '核对人物字段…'];
  openModalHtml('巡检', '<div id="inspectBox"><div class="notice">' + I('search') + '<span id="inspectStep">' + steps[0] + '</span></div><div class="progress" style="margin-top:10px"><i id="inspectBar" style="width:8%"></i></div></div>');
  var i = 0;
  var timer = setInterval(function () {
    i++;
    if (i < steps.length) {
      var st = document.getElementById('inspectStep');
      var bar = document.getElementById('inspectBar');
      if (st) st.textContent = steps[i];
      if (bar) bar.style.width = (8 + i * 24) + '%';
      return;
    }
    clearInterval(timer);
    var items = inspectCompute(p);
    var list = items.map(function (it) {
      return '<div class="inspect-item"><span class="lv ' + it.lv + '">' + (it.lv === 'H' ? '高' : it.lv === 'M' ? '中' : '低') + '</span>' +
        '<span class="where">' + esc(it.where) + '</span><span>' + esc(it.text) + '</span></div>';
    }).join('');
    var box = document.getElementById('inspectBox');
    if (box) box.innerHTML = '<div class="hd" style="padding:0 0 8px"><h3 style="font-size:13px">检出 ' + items.length + ' 项（全部由当前数据计算）</h3></div>' + list;
  }, 550);
}

/* ---------- 模块 6 · 世界观设定库 ---------- */
function renderWorld(p) {
  if (!p.entries.length) {
    return '<div class="empty" style="flex:1;justify-content:center"><div class="glyph">界</div>' +
      '<p>《' + esc(p.title) + '》还没有设定词条。好的设定不是百科——它规定「什么事不能做，做了会怎样」。</p>' +
      '<button class="btn primary" data-act="add-entry">' + I('plus') + ' 新增第一条设定</button></div>';
  }
  var list = p.entries.filter(function (e) { return state.worldCat === '全部' || e.cat === state.worldCat; });
  var cards = list.map(function (e) {
    return '<div class="card world-card fade-in" data-act="entry-open" data-id="' + e.id + '">' +
      '<h5><span class="tag ' + (e.cat === '力量体系' ? 'zi' : e.cat === '势力' ? 'zhe' : e.cat === '地理' ? 'qing' : e.cat === '习俗' ? 'lv' : 'tie') + '">' + esc(e.cat) + '</span>' + esc(e.name) + '</h5>' +
      '<div class="wc-brief">' + esc(e.brief) + '</div>' +
      '<div class="wc-taboo">忌：' + esc(e.taboo) + '</div></div>';
  }).join('');
  return '<div class="world-grid" style="overflow-y:auto;flex:1;align-content:flex-start">' + cards + '</div>';
}

/* ---------- 模块 7 · 时间线 + 创作看板 ---------- */
function renderBoard(p) {
  if (!p.events.length) {
    return '<div class="empty" style="flex:1;justify-content:center"><div class="glyph">时</div>' +
      '<p>还没有时间线事件，看板也没有数据可算。写了章节、埋了伏笔之后，这里会自动长出来。</p>' +
      '<button class="btn primary" data-act="tab" data-tab="outline">先去排大纲</button></div>';
  }
  var leftPad = 130, perDay = 9;
  var maxDay = 10;
  p.events.forEach(function (e) { if (e.day > maxDay) maxDay = e.day; });
  p.eras.forEach(function (e) { if (e.day > maxDay) maxDay = e.day; });
  var W = leftPad + maxDay * perDay + 40;
  var tracks = p.tracks.filter(function (t) { return state.boardTracks[t.id] !== false; });
  var headerH = 30, rowH = 48;
  var H = headerH + tracks.length * rowH + 14;
  var eraHtml = p.eras.map(function (e) {
    var x = leftPad + e.day * perDay;
    return '<div class="tl-era" style="left:' + x + 'px"><span class="lb" style="left:5px">' + esc(e.label) + '</span></div>';
  }).join('');
  var trackHtml = tracks.map(function (t, i) {
    var y = headerH + i * rowH;
    var cy = y + rowH / 2;
    var evs = p.events.filter(function (e) { return e.track === t.id; }).map(function (e) {
      var x = leftPad + e.day * perDay;
      return '<div class="tl-ev" style="left:' + x + 'px;top:' + cy + 'px;color:' + t.color + '" data-act="event-open" data-id="' + e.id + '">' +
        '<span class="tip">' + esc(e.title) + (e.ch ? ' · ' + fmtCh(e.ch) : '') + '</span></div>';
    }).join('');
    return '<div class="tl-track" style="top:' + cy + 'px"></div>' + evs;
  }).join('');
  // 轨道名用浮动列，避免遮挡（左侧留白 leftPad 后再映射坐标）
  var namesHtml = tracks.map(function (t, i) {
    return '<div style="position:absolute;left:8px;top:' + (headerH + i * rowH + rowH / 2 - 11) + 'px" class="tl-trackname">' + esc(t.name) + '</div>';
  }).join('');
  var tl = '<div class="card" style="padding:12px 14px"><div class="hd" style="padding:0 0 8px;border:none"><h3 style="font-size:13px">多轨时间线</h3><span class="hint">横向滚动 · 点节点看详情</span></div>' +
    '<div class="tl-outer"><div class="tl-canvas" style="width:' + W + 'px;height:' + H + 'px">' +
    eraHtml + namesHtml + trackHtml +
    '</div></div></div>';
  return '<div class="board-scroll">' + tl +
    '<div class="chartgrid">' +
    '<div class="card chartbox"><h5>日更字数<span class="cb-sub">近 14 天 · 空档为断更</span></h5>' + chartDaily(p) + '</div>' +
    '<div class="card chartbox"><h5>章节张力曲线<span class="cb-sub">实心点 = 已定稿</span></h5>' + chartTension(p) + '</div>' +
    '<div class="card chartbox"><h5>目标进度<span class="cb-sub">目标 ' + p.targetWords.toLocaleString() + ' 字</span></h5>' + chartRing(p) + '</div>' +
    '<div class="card chartbox"><h5>人物出场频次<span class="cb-sub">按已写章节统计</span></h5>' + chartFreq(p) + '</div>' +
    '</div></div>';
}

/* ---------- 手写 SVG 图表（坐标轴留白独立，不压数据） ---------- */
function niceMax(v) {
  if (v <= 0) return 10;
  var p = Math.pow(10, Math.floor(Math.log(v) / Math.LN10));
  var d = v / p;
  var n = d <= 1 ? 1 : d <= 2 ? 2 : d <= 5 ? 5 : 10;
  return n * p;
}
function chartDaily(p) {
  var days = [];
  var now = new Date();
  for (var i = 13; i >= 0; i--) {
    var d = new Date(now.getTime() - i * 86400000);
    var key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    var sum = 0;
    p.chapters.forEach(function (c) { if (c.writtenOn === key) sum += wordCount(c.text); });
    days.push({ key: key, label: key.slice(5), sum: sum });
  }
  var W = 380, H = 170, L = 46, R = 8, T = 10, B = 26;
  var iw = W - L - R, ih = H - T - B;
  var mx = niceMax(Math.max.apply(null, days.map(function (x) { return x.sum; })));
  var bw = iw / days.length;
  var bars = days.map(function (x, i) {
    var h = x.sum / mx * ih;
    var xx = L + i * bw + bw * 0.22;
    var lbl = (i % 2 === 0) ? '<text x="' + (L + i * bw + bw / 2).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle">' + x.label + '</text>' : '';
    var gap = x.sum === 0 ? '<circle cx="' + (L + i * bw + bw / 2).toFixed(1) + '" cy="' + (T + ih) + '" r="1.6" fill="#d3c7aa"/>' : '';
    return (x.sum > 0 ? '<rect x="' + xx.toFixed(1) + '" y="' + (T + ih - h).toFixed(1) + '" width="' + (bw * 0.56).toFixed(1) + '" height="' + h.toFixed(1) + '" rx="2" fill="#a8433a" opacity=".85"><title>' + x.label + '：' + x.sum + ' 字</title></rect>' : gap) + lbl;
  }).join('');
  var grid = [0, 0.5, 1].map(function (f) {
    var y = T + ih - ih * f;
    return '<line class="grid-l" x1="' + L + '" y1="' + y.toFixed(1) + '" x2="' + (W - R) + '" y2="' + y.toFixed(1) + '"/>' +
      '<text x="' + (L - 6) + '" y="' + (y + 3).toFixed(1) + '" text-anchor="end">' + Math.round(mx * f) + '</text>';
  }).join('');
  return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '">' + grid + bars + '<line class="axis" x1="' + L + '" y1="' + (T + ih) + '" x2="' + (W - R) + '" y2="' + (T + ih) + '"/></svg>';
}
function chartTension(p) {
  var items = [];
  p.volumes.forEach(function (v) { items = items.concat(v.items); });
  items.sort(function (a, b) { return a.no - b.no; });
  if (!items.length) return '<div class="dim" style="font-size:12px;padding:20px;text-align:center">暂无大纲数据</div>';
  var W = 380, H = 170, L = 40, R = 10, T = 12, B = 26;
  var iw = W - L - R, ih = H - T - B;
  var step = items.length > 1 ? iw / (items.length - 1) : 0;
  function X(i) { return L + i * step; }
  function Y(t) { return T + ih - (t / 10) * ih; }
  var path = items.map(function (it, i) { return (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(it.tension).toFixed(1); }).join(' ');
  var pts = items.map(function (it, i) {
    var fill = it.status === '定稿' ? '#a8433a' : '#fbf8f0';
    var lbl = (i % 4 === 0 || i === items.length - 1) ? '<text x="' + X(i).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle">' + fmtCh(it.no) + '</text>' : '';
    return '<circle cx="' + X(i).toFixed(1) + '" cy="' + Y(it.tension).toFixed(1) + '" r="3.4" fill="' + fill + '" stroke="#a8433a" stroke-width="1.6"><title>' + fmtCh(it.no) + ' ' + esc(it.title) + ' · 张力 ' + it.tension + ' · ' + esc(it.status) + '</title></circle>' + lbl;
  }).join('');
  var grid = [0, 5, 10].map(function (t) {
    return '<line class="grid-l" x1="' + L + '" y1="' + Y(t).toFixed(1) + '" x2="' + (W - R) + '" y2="' + Y(t).toFixed(1) + '"/>' +
      '<text x="' + (L - 6) + '" y="' + (Y(t) + 3).toFixed(1) + '" text-anchor="end">' + t + '</text>';
  }).join('');
  return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '">' + grid + '<path d="' + path + '" fill="none" stroke="#40635c" stroke-width="2"/>' + pts + '</svg>';
}
function chartRing(p) {
  var st = projStats(p);
  var pct = Math.min(1, st.words / p.targetWords);
  var C = 2 * Math.PI * 54;
  return '<svg class="chart" viewBox="0 0 300 150">' +
    '<g transform="translate(78,75)">' +
    '<circle r="54" fill="none" stroke="#e9dfc8" stroke-width="12"/>' +
    '<circle r="54" fill="none" stroke="#a8433a" stroke-width="12" stroke-linecap="round" stroke-dasharray="' + (C * pct).toFixed(1) + ' ' + C.toFixed(1) + '" transform="rotate(-90)"/>' +
    '<text y="6" text-anchor="middle" style="font-size:18px;fill:#2f2a22;font-weight:700">' + Math.round(pct * 100) + '%</text>' +
    '</g>' +
    '<g transform="translate(170,58)">' +
    '<text style="font-size:11px;fill:#8d8574">已写</text><text x="60" text-anchor="end" style="font-size:13px;fill:#2f2a22">' + st.words.toLocaleString() + '</text>' +
    '<text y="24" style="font-size:11px;fill:#8d8574">目标</text><text x="60" y="24" text-anchor="end" style="font-size:13px;fill:#2f2a22">' + p.targetWords.toLocaleString() + '</text>' +
    '<text y="48" style="font-size:11px;fill:#8d8574">缺口</text><text x="60" y="48" text-anchor="end" style="font-size:13px;fill:#a8433a">' + Math.max(0, p.targetWords - st.words).toLocaleString() + '</text>' +
    '</g></svg>';
}
function chartFreq(p) {
  if (!p.chars.length) return '<div class="dim" style="font-size:12px;padding:20px;text-align:center">暂无人物</div>';
  var counts = p.chars.map(function (c) {
    var n = 0;
    if (p.chapters.length) {
      p.chapters.forEach(function (ch) { if (ch.cast && ch.cast.indexOf(c.id) >= 0) n++; });
      if (!n) n = 0;
    } else n = c.chapters.length;
    return { c: c, n: n };
  }).filter(function (x) { return x.n > 0 || true; });
  counts.sort(function (a, b) { return b.n - a.n; });
  var mx = Math.max(1, counts[0] ? counts[0].n : 1);
  var rowH = 24, W = 380, L = 108, R = 34;
  var H = counts.length * rowH + 12;
  var iw = W - L - R;
  var rows = counts.map(function (x, i) {
    var y = 8 + i * rowH;
    var w = x.n / mx * iw;
    return '<text x="' + (L - 8) + '" y="' + (y + 13) + '" text-anchor="end" style="font-size:11px;fill:#5c5548">' + esc(x.c.name.replace(/（[^）]*）/g, '').slice(0, 5)) + '</text>' +
      '<rect x="' + L + '" y="' + (y + 4) + '" width="' + Math.max(2, w).toFixed(1) + '" height="12" rx="3" fill="' + x.c.color + '" opacity=".82"/>' +
      '<text x="' + (L + w + 6).toFixed(1) + '" y="' + (y + 13) + '" style="font-size:11px;fill:#5c5548">' + x.n + '</text>';
  }).join('');
  return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '">' + rows + '</svg>';
}

/* ---------- 弹层系统 ---------- */
function openModalHtml(title, inner, sub) {
  document.getElementById('modalRoot').innerHTML =
    '<div class="mask" data-act="mask-close"><div class="modal fade-in">' +
    '<div style="display:flex;align-items:flex-start;gap:10px"><div style="flex:1;min-width:0"><h3>' + esc(title) + '</h3>' +
    (sub ? '<div class="m-sub">' + sub + '</div>' : '') +
    '</div><button class="icon-btn" data-act="mask-close">' + I('close') + '</button></div>' +
    inner + '</div></div>';
}
function closeModal() {
  var r = document.getElementById('modalRoot');
  if (r) r.innerHTML = '';
}
function optionList(arr, sel) {
  return arr.map(function (x) { return '<option' + (x === sel ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('');
}

/* 新建作品 */
function modalNewProject() {
  var tones = TONE_LIST.map(function (t) { return '<button type="button" data-act="tone-pick">' + esc(t) + '</button>'; }).join('');
  openModalHtml('新建作品', 
    '<div class="f-row"><label>书名 *</label><input id="npTitle" placeholder="例如：雾港夜航"></div>' +
    '<div class="f-grid">' +
    '<div class="f-row"><label>题材</label><select id="npGenre">' + optionList(GENRES, GENRES[0]) + '</select></div>' +
    '<div class="f-row"><label>叙事人称</label><select id="npPov">' + optionList(POV_LIST, POV_LIST[1]) + '</select></div>' +
    '</div>' +
    '<div class="f-row"><label>一句话简介</label><textarea id="npBrief" rows="2" placeholder="这本书到底讲什么？一句话。"></textarea></div>' +
    '<div class="f-grid">' +
    '<div class="f-row"><label>目标字数</label><input id="npTarget" type="number" value="200000" step="10000" min="10000"></div>' +
    '<div class="f-row"><label>基调（可多选）</label><div class="tone-pick" id="npTones">' + tones + '</div></div>' +
    '</div>' +
    '<div class="m-acts"><button class="btn" data-act="mask-close">取消</button>' +
    '<button class="btn primary" data-act="create-project">' + I('plus') + ' 创建并进入</button></div>',
    '创建后会自动生成一段引导对话，引用你刚写的简介。');
}
/* 删除确认 */
function modalDelProject(p) {
  var st = projStats(p);
  openModalHtml('删除《' + p.title + '》？',
    '<div class="notice" style="margin-bottom:14px">' + I('alert') + '<span>这部作品共 <b>' + st.plan + ' 章大纲</b>、<b>' + st.written + ' 章正文（' + st.words.toLocaleString() + ' 字）</b>、<b>' + st.sessions + ' 个会话</b>、' + st.chars + ' 位人物、' + st.fsp + ' 条伏笔。</span></div>' +
    '<div class="m-acts"><button class="btn" data-act="mask-close">再想想</button>' +
    '<button class="btn danger" data-act="confirm-del-project" data-id="' + p.id + '">' + I('trash') + ' 删除（5 秒内可撤销）</button></div>',
    '删除后会从书架移除。我们不说「不可撤销」——Toast 里的撤销按钮有 5 秒寿命。');
}
/* 新增伏笔 */
function modalAddForeshadow() {
  var p = cur();
  var opts = [];
  p.volumes.forEach(function (v) { v.items.forEach(function (it) { opts.push({ no: it.no, t: it.title }); }); });
  var chSel = '<select id="fsPlant">' + opts.map(function (o) { return '<option value="' + o.no + '">' + fmtCh(o.no) + ' ' + esc(o.t) + '</option>'; }).join('') + '</select>';
  var chSel2 = '<select id="fsPay"><option value="">（不填 → 悬空）</option>' + opts.map(function (o) { return '<option value="' + o.no + '">' + fmtCh(o.no) + ' ' + esc(o.t) + '</option>'; }).join('') + '</select>';
  openModalHtml('新增伏笔',
    '<div class="f-row"><label>伏笔名称 *</label><input id="fsName" placeholder="例如：写着「聿」字的旧雨衣"></div>' +
    '<div class="f-grid">' +
    '<div class="f-row"><label>埋设于</label>' + (opts.length ? chSel : '<input id="fsPlantNum" type="number" value="1" min="1">') + '</div>' +
    '<div class="f-row"><label>计划回收章</label>' + (opts.length ? chSel2 : '<input id="fsPayNum" type="number" placeholder="留空即悬空" min="1">') + '</div>' +
    '</div>' +
    '<div class="f-grid">' +
    '<div class="f-row"><label>重要度</label><select id="fsImp"><option value="3">●●● 关键</option><option value="2" selected>●●○ 重要</option><option value="1">●○○ 点缀</option></select></div>' +
    '<div class="f-row"><label>备注</label><input id="fsNote" placeholder="这条线为什么重要"></div>' +
    '</div>' +
    '<div class="m-acts"><button class="btn" data-act="mask-close">取消</button><button class="btn primary" data-act="submit-foreshadow">埋下</button></div>',
    '不填回收章会自动标为「悬空」，进入风险提示。');
}
/* 新增人物 */
function modalAddChar() {
  openModalHtml('新增人物',
    '<div class="f-grid">' +
    '<div class="f-row"><label>姓名 *</label><input id="chName" placeholder="未定名可先写代号"></div>' +
    '<div class="f-row"><label>性别</label><select id="chGender"><option>男</option><option>女</option></select></div>' +
    '</div>' +
    '<div class="f-row"><label>角色定位</label><input id="chRole" placeholder="例如：主角 · 调查记者"></div>' +
    '<div class="f-row"><label>想要什么</label><input id="chWant" placeholder="表层欲望"></div>' +
    '<div class="f-row"><label>真正需要什么</label><input id="chNeed" placeholder="与「想要」互相拉扯的东西"></div>' +
    '<div class="f-row"><label>深层秘密（可留空）</label><input id="chSecret" placeholder="连旁白都不轻易说的东西"></div>' +
    '<div class="m-acts"><button class="btn" data-act="mask-close">取消</button><button class="btn primary" data-act="submit-char">登记</button></div>');
}
/* 新增设定 */
function modalAddEntry() {
  openModalHtml('新增设定词条',
    '<div class="f-grid">' +
    '<div class="f-row"><label>词条名 *</label><input id="enName" placeholder="例如：北礁灯塔"></div>' +
    '<div class="f-row"><label>分类</label><select id="enCat">' + optionList(WORLD_CATS, WORLD_CATS[0]) + '</select></div>' +
    '</div>' +
    '<div class="f-row"><label>一句话概要</label><textarea id="enBrief" rows="2"></textarea></div>' +
    '<div class="f-row"><label>细节</label><textarea id="enDetail" rows="3"></textarea></div>' +
    '<div class="f-row"><label>禁忌：什么事不能做，做了会怎样 *</label><textarea id="enTaboo" rows="2" placeholder="好的设定会划出边界。"></textarea></div>' +
    '<div class="m-acts"><button class="btn" data-act="mask-close">取消</button><button class="btn primary" data-act="submit-entry">入库</button></div>');
}
function modalEntry(e) {
  openModalHtml(e.name,
    '<div style="display:flex;gap:8px;margin-bottom:12px"><span class="tag">' + esc(e.cat) + '</span></div>' +
    '<div class="pf-field" style="margin-bottom:10px"><span class="lb">概要</span><span class="vl">' + esc(e.brief) + '</span></div>' +
    '<div class="pf-field" style="margin-bottom:10px"><span class="lb">细节</span><span class="vl">' + esc(e.detail || '（待补充）') + '</span></div>' +
    '<div class="wc-taboo" style="font-size:13px">忌：' + esc(e.taboo) + '</div>' +
    '<div class="m-acts"><button class="btn" data-act="mask-close">关闭</button></div>');
}
function modalEvent(p, e) {
  var era = '';
  p.eras.forEach(function (x) { if (x.day <= e.day) era = x.label; });
  openModalHtml(e.title,
    '<div style="display:flex;gap:8px;margin-bottom:10px"><span class="tag">' + esc(era || '纪年外') + '</span>' + (e.ch ? '<span class="tag seal">' + fmtCh(e.ch) + '</span>' : '') + '</div>' +
    '<p style="font-size:13.5px;line-height:1.9;margin-bottom:14px">' + esc(e.detail) + '</p>' +
    '<div class="m-acts"><button class="btn" data-act="mask-close">关闭</button>' +
    (e.ch ? '<button class="btn primary" data-act="event-jump" data-no="' + e.ch + '">跳到 ' + fmtCh(e.ch) + '</button>' : '') + '</div>');
}
function modalAddVolume() {
  var p = cur();
  openModalHtml('新建卷',
    '<div class="f-row"><label>卷名 *</label><input id="volName" value="卷' + (p.volumes.length + 1) + '" ></div>' +
    '<div class="f-row"><label>一句话概要</label><input id="volSum" placeholder="这一卷解决什么"></div>' +
    '<div class="m-acts"><button class="btn" data-act="mask-close">取消</button><button class="btn primary" data-act="submit-volume">建卷</button></div>');
}
function modalAddChapter(volId) {
  var p = cur(), maxNo = 0;
  p.volumes.forEach(function (v) { v.items.forEach(function (it) { if (it.no > maxNo) maxNo = it.no; }); });
  openModalHtml('新增章节',
    '<div class="f-grid">' +
    '<div class="f-row"><label>章号</label><input id="ncNo" type="number" value="' + (maxNo + 1) + '" min="1"></div>' +
    '<div class="f-row"><label>张力（1–10）</label><input id="ncTen" type="number" value="5" min="1" max="10"></div>' +
    '</div>' +
    '<div class="f-row"><label>章名 *</label><input id="ncTitle" placeholder="例如：归港"></div>' +
    '<div class="f-row"><label>一句话节拍</label><input id="ncBeat" placeholder="这章发生什么，一句话"></div>' +
    '<div class="m-acts"><button class="btn" data-act="mask-close">取消</button><button class="btn primary" data-act="submit-chapter" data-vol="' + volId + '">排入大纲</button></div>');
}
function openDiff() {
  var d = state.diff;
  if (!d) return;
  var opName = { polish: '润色', simplify: '精简', expand: '扩写', pov: '改人称' }[d.op] || d.op;
  openModalHtml('改写对照 · ' + opName,
    '<div class="diffcard"><div class="dc-row">' +
    '<div><div class="dc-lb">原文（' + wordCount(d.before) + ' 字）</div><div class="dc-cell">' + esc(d.before) + '</div></div>' +
    '<div><div class="dc-lb">改写后（' + wordCount(d.after) + ' 字）</div><div class="dc-cell after">' + esc(d.after) + '</div></div>' +
    '</div><div class="dc-acts">' +
    '<button class="btn" data-act="mask-close">放弃</button>' +
    '<button class="btn" data-act="diff-again">' + I('undo') + ' 再来一次</button>' +
    '<button class="btn primary" data-act="apply-diff">' + I('check') + ' 采纳替换</button>' +
    '</div></div>',
    '真实字符串变换；对任意选中文本都保证可见变化。');
}

/* ---------- Toast + 撤销 ---------- */
function toast(text, undoFn) {
  var root = document.getElementById('toastRoot');
  var el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = '<span>' + esc(text) + '</span>' + (undoFn ? '<button>撤销</button>' : '');
  root.appendChild(el);
  var timer = setTimeout(function () { if (el.parentNode) el.remove(); }, 5000);
  if (undoFn) {
    el.querySelector('button').addEventListener('click', function () {
      clearTimeout(timer);
      undoFn();
      if (el.parentNode) el.remove();
      renderAll();
      toast('已还原', null);
    });
  }
}

/* ---------- 命令面板 ---------- */
function paletteEntries() {
  var out = [];
  state.projects.forEach(function (p) {
    var st = projStats(p);
    out.push({ type: '作品', label: p.title, sub: p.genre + ' · ' + st.words.toLocaleString() + ' 字', go: function () { switchProject(p.id); state.tab = 'shelf'; } });
    p.chapters.forEach(function (c) {
      out.push({ type: '章节', label: fmtCh(c.no) + ' ' + c.title, sub: p.title, go: function () { switchProject(p.id); state.tab = 'text'; state.selCh = c.no; state.textMode = 'read'; } });
    });
    p.chars.forEach(function (c) {
      out.push({ type: '人物', label: c.name, sub: p.title + ' · ' + c.role, go: function () { switchProject(p.id); state.tab = 'chars'; state.selChar = c.id; } });
    });
    p.entries.forEach(function (e) {
      out.push({ type: '设定', label: e.name, sub: p.title + ' · ' + e.cat, go: function () { switchProject(p.id); state.tab = 'world'; state.worldCat = e.cat; modalEntry(e); } });
    });
    p.foreshadows.forEach(function (f) {
      out.push({ type: '伏笔', label: f.name, sub: p.title + ' · ' + f.state, go: function () { switchProject(p.id); state.tab = 'outline'; state.outlineView = 'fsp'; } });
    });
    p.sessions.forEach(function (s) {
      out.push({ type: '会话', label: s.title, sub: p.title, go: function () { switchProject(p.id); state.tab = 'chat'; state.selSession = s.id; } });
    });
  });
  return out;
}
function renderPalette() {
  var root = document.getElementById('paletteRoot');
  if (!state.palette.open) { root.innerHTML = ''; return; }
  var q = state.palette.q.toLowerCase();
  var list = paletteEntries().filter(function (e) {
    return !q || (e.label + ' ' + e.sub + ' ' + e.type).toLowerCase().indexOf(q) >= 0;
  }).slice(0, 40);
  state._palList = list;
  if (state.palette.sel >= list.length) state.palette.sel = 0;
  var typeCls = { '作品': 'seal', '章节': 'qing', '人物': 'zhe', '设定': 'zi', '伏笔': 'lv', '会话': 'tie' };
  var items = list.map(function (e, i) {
    return '<div class="pal-item' + (i === state.palette.sel ? ' sel' : '') + '" data-act="pal-go" data-i="' + i + '">' +
      '<span class="tag ' + (typeCls[e.type] || '') + '">' + e.type + '</span>' +
      '<span class="pi-t">' + esc(e.label) + '</span><span class="pi-s">' + esc(e.sub) + '</span></div>';
  }).join('');
  root.innerHTML = '<div class="pal-mask" data-act="pal-close"><div class="palette">' +
    '<input id="palInput" placeholder="跨作品检索：章节 / 人物 / 设定 / 伏笔 / 会话…（方向键选择，回车跳转）" value="' + esc(state.palette.q) + '">' +
    '<div class="pal-list">' + (items || '<div class="dim" style="padding:14px;text-align:center;font-size:12px">没有匹配项——换个关键词试试。</div>') + '</div>' +
    '</div></div>';
  var inp = document.getElementById('palInput');
  if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
}
function switchProject(id) {
  finalizeAllStreams();
  state.activeId = id;
  var p = cur();
  state.selSession = p.sessions.length ? p.sessions[0].id : null;
  state.selChar = p.chars.length ? p.chars[0].id : null;
  var firstCh = null;
  if (p.chapters.length) firstCh = p.chapters[0].no;
  else if (p.volumes.length && p.volumes[0].items.length) firstCh = p.volumes[0].items[0].no;
  state.selCh = firstCh || 1;
  state.textMode = 'read';
  state.outlineView = 'struct';
  state.worldCat = '全部';
}

/* ---------- 动作分发表 ---------- */
ACT['tab'] = function (el) {
  finalizeAllStreams();
  state.focus = false;
  document.body.classList.remove('focus');
  state.tab = el.getAttribute('data-tab');
};
ACT['open-project'] = function (el) { switchProject(el.getAttribute('data-id')); };
ACT['new-project'] = function () { modalNewProject(); };
ACT['tone-pick'] = function (el) { el.classList.toggle('on'); };
ACT['create-project'] = function () {
  var title = (document.getElementById('npTitle').value || '').trim();
  if (!title) { toast('书名不能为空'); return; }
  var genre = document.getElementById('npGenre').value;
  var brief = (document.getElementById('npBrief').value || '').trim();
  var target = Math.max(10000, parseInt(document.getElementById('npTarget').value, 10) || 200000);
  var pov = document.getElementById('npPov').value;
  var tones = [];
  document.querySelectorAll('#npTones button.on').forEach(function (b) { tones.push(b.textContent); });
  var p = {
    id: uid('p'), title: title, genre: genre, brief: brief, targetWords: target, pov: pov, tones: tones,
    spineColor: GENRE_COLORS[genre] || '#55504a', createdAt: todayStr(),
    volumes: [], chapters: [], chars: [], relations: [], foreshadows: [], entries: [], events: [], eras: [], tracks: [], sessions: []
  };
  var g = compose(p, 'greet', '你好');
  p.sessions.push({
    id: uid('s'), title: '开始《' + title + '》', updated: nowStr(),
    messages: [{ role: 'ai', intent: 'greet', intentLabel: '引导', text: g.answer, think: g.think,
      tools: g.tools.map(function (t) { return { name: t.name, args: t.args, result: t.result, state: 'done' }; }) }]
  });
  state.projects.push(p);
  switchProject(p.id);
  state.tab = 'chat';
  state.selSession = p.sessions[0].id;
  closeModal();
  toast('《' + title + '》已创建，引导会话已生成');
};
ACT['del-project'] = function (el) {
  var p = null;
  state.projects.forEach(function (x) { if (x.id === el.getAttribute('data-id')) p = x; });
  if (p) modalDelProject(p);
};
ACT['confirm-del-project'] = function (el) {
  var id = el.getAttribute('data-id'), idx = -1, removed = null;
  state.projects.forEach(function (x, i) { if (x.id === id) { idx = i; removed = x; } });
  if (!removed) return;
  state.projects.splice(idx, 1);
  closeModal();
  if (state.activeId === id) {
    if (state.projects.length) switchProject(state.projects[Math.min(idx, state.projects.length - 1)].id);
    else { state.tab = 'shelf'; }
  }
  toast('已删除《' + removed.title + '》', function () {
    state.projects.splice(idx, 0, removed);
    switchProject(removed.id);
  });
};
/* 会话 */
ACT['open-session'] = function (el) { finalizeAllStreams(); state.selSession = el.getAttribute('data-id'); };
ACT['new-session'] = function () { finalizeAllStreams(); newSession(cur()); };
ACT['del-session'] = function (el, ev) {
  ev.stopPropagation();
  var p = cur(), id = el.getAttribute('data-id'), idx = -1, removed = null;
  p.sessions.forEach(function (s, i) { if (s.id === id) { idx = i; removed = s; } });
  if (!removed) return;
  p.sessions.splice(idx, 1);
  if (state.selSession === id) state.selSession = p.sessions.length ? p.sessions[0].id : null;
  toast('已删除会话「' + removed.title + '」', function () { p.sessions.splice(idx, 0, removed); state.selSession = removed.id; });
};
ACT['send-chat'] = function () {
  var ta = document.getElementById('chatInput');
  if (!ta) return;
  var v = ta.value;
  ta.value = '';
  sendChat(v);
};
ACT['chip'] = function (el) { sendChat(el.getAttribute('data-q')); };
ACT['stop-stream'] = function () { finishStream(true); };
ACT['think-toggle'] = function (el) {
  var s = currentSession();
  if (!s) return;
  var msgEl = el.closest('.msg.ai');
  var inner = msgEl.parentNode;
  var aiIdx = Array.prototype.indexOf.call(inner.querySelectorAll('.msg.ai'), msgEl);
  var count = -1, msg = null;
  s.messages.forEach(function (m) { if (m.role === 'ai') { count++; if (count === aiIdx) msg = m; } });
  if (msg && !msg.streaming) msg.thinkOpen = !msg.thinkOpen;
};
ACT['tool-toggle'] = function (el) {
  var s = currentSession();
  if (!s) return;
  var msgEl = el.closest('.msg.ai');
  var aiIdx = Array.prototype.indexOf.call(msgEl.parentNode.querySelectorAll('.msg.ai'), msgEl);
  var count = -1, msg = null;
  s.messages.forEach(function (m) { if (m.role === 'ai') { count++; if (count === aiIdx) msg = m; } });
  if (!msg) return;
  var t = msg.tools[parseInt(el.getAttribute('data-ti'), 10)];
  if (t && t.state === 'done') t.open = !t.open;
};
/* 正文 */
ACT['open-chapter'] = function (el) { state.selCh = parseInt(el.getAttribute('data-no'), 10); };
ACT['goto-chapter'] = function (el) {
  var no = parseInt(el.getAttribute('data-no'), 10);
  if (!isNaN(no)) state.selCh = no;
};
ACT['text-mode'] = function (el) { state.textMode = el.getAttribute('data-m'); };
ACT['focus-on'] = function () { state.focus = true; document.body.classList.add('focus'); };
ACT['focus-exit'] = function () { state.focus = false; document.body.classList.remove('focus'); };
function draftChapter(no) {
  var p = cur();
  var ol = findOutline(p, no);
  var beat = (ol ? ol.item.beat : '（无节拍）').replace(/[。！？；]+$/, '');
  var title = ol ? ol.item.title : '第 ' + no + ' 章';
  finalizeAllStreams();
  if (!currentSession()) newSession(p);
  state.tab = 'chat';
  state.pendingInput = '请为《' + p.title + '》起草 ' + fmtCh(no) + '「' + title + '」。本章节拍：' + beat + '。请按 ' + p.genre + ' 的声口、' + p.pov + '写。';
}
ACT['draft-chapter'] = function (el) { draftChapter(parseInt(el.getAttribute('data-no'), 10)); };
ACT['write-chapter'] = function (el) {
  var p = cur(), no = parseInt(el.getAttribute('data-no'), 10);
  if (!chapterMs(p, no)) {
    var ol = findOutline(p, no);
    p.chapters.push({ id: uid('x'), no: no, title: ol ? ol.item.title : '第 ' + no + ' 章', text: '', writtenOn: todayStr(), cast: [] });
  }
  state.textMode = 'edit';
};
ACT['write-first'] = function () {
  var p = cur();
  if (!p.volumes.length) {
    p.volumes.push({ id: uid('v'), name: '卷一', summary: '', items: [{ no: 1, title: '第一章', beat: '', tension: 5, status: '构思' }] });
  }
  if (!findOutline(p, 1)) p.volumes[0].items.push({ no: 1, title: '第一章', beat: '', tension: 5, status: '构思' });
  if (!chapterMs(p, 1)) p.chapters.push({ id: uid('x'), no: 1, title: '第一章', text: '', writtenOn: todayStr(), cast: [] });
  state.tab = 'text';
  state.selCh = 1;
  state.textMode = 'edit';
};
ACT['del-chapter'] = function (el, ev) {
  ev.stopPropagation();
  var p = cur(), no = parseInt(el.getAttribute('data-no'), 10), idx = -1, removed = null;
  p.chapters.forEach(function (c, i) { if (c.no === no) { idx = i; removed = c; } });
  if (!removed) return;
  p.chapters.splice(idx, 1);
  toast('已删除 ' + fmtCh(no) + ' 的稿件（大纲保留）', function () { p.chapters.splice(idx, 0, removed); });
};
ACT['rewrite'] = function (el) {
  var ta = document.getElementById('editArea');
  if (!ta) return;
  var s0 = ta.selectionStart, s1 = ta.selectionEnd;
  if (s0 === s1) { toast('先选中一段文字'); return; }
  var before = ta.value.slice(s0, s1);
  var p = cur();
  state.diff = { op: el.getAttribute('data-op'), start: s0, end: s1, before: before, after: rewriteText(before, el.getAttribute('data-op'), p.genre, 0), seed: 0 };
  openDiff();
};
ACT['diff-again'] = function () {
  var d = state.diff;
  if (!d) return;
  d.seed += 1;
  d.after = rewriteText(d.before, d.op, cur().genre, d.seed);
  openDiff();
};
ACT['apply-diff'] = function () {
  var d = state.diff;
  var p = cur();
  var ms = chapterMs(p, state.selCh);
  if (d && ms) {
    ms.text = ms.text.slice(0, d.start) + d.after + ms.text.slice(d.end);
    state.diff = null;
    closeModal();
    toast('已采纳替换，字数已更新');
  }
};
/* 人物 / 大纲 / 伏笔 */
ACT['pick-char'] = function (el) { state.selChar = el.getAttribute('data-id'); };
ACT['add-char'] = function () { modalAddChar(); };
ACT['submit-char'] = function () {
  var name = (document.getElementById('chName').value || '').trim();
  if (!name) { toast('姓名不能为空'); return; }
  var p = cur();
  var colors = ['#a8433a', '#40635c', '#7c5f8f', '#b98a45', '#6f8f62', '#55504a'];
  var c = {
    id: uid('c'), name: name, gender: document.getElementById('chGender').value,
    role: document.getElementById('chRole').value || '待定', color: colors[p.chars.length % colors.length],
    look: '待补充', motive: '待补充',
    want: document.getElementById('chWant').value || '待定', need: document.getElementById('chNeed').value || '待定',
    secret: document.getElementById('chSecret').value || '（尚未设定）', arc: '待定', firstCh: state.selCh || 1, chapters: []
  };
  p.chars.push(c);
  state.selChar = c.id;
  closeModal();
  toast('「' + name + '」已登记');
};
ACT['cycle-status'] = function (el) {
  var p = cur(), no = parseInt(el.getAttribute('data-no'), 10);
  var hit = findOutline(p, no);
  if (!hit) return;
  var i = CH_STATUS.indexOf(hit.item.status);
  hit.item.status = CH_STATUS[(i + 1) % CH_STATUS.length];
};
ACT['outline-view'] = function (el) { state.outlineView = el.getAttribute('data-v'); };
ACT['add-volume'] = function () { modalAddVolume(); };
ACT['submit-volume'] = function () {
  var p = cur();
  var name = (document.getElementById('volName').value || '').trim() || ('卷' + (p.volumes.length + 1));
  p.volumes.push({ id: uid('v'), name: name, summary: (document.getElementById('volSum').value || '').trim(), items: [] });
  closeModal();
  toast('已建「' + name + '」，现在加章节');
};
ACT['add-chapter'] = function (el) { modalAddChapter(el.getAttribute('data-vol')); };
ACT['submit-chapter'] = function (el) {
  var p = cur(), vol = null;
  p.volumes.forEach(function (v) { if (v.id === el.getAttribute('data-vol')) vol = v; });
  if (!vol) return;
  var title = (document.getElementById('ncTitle').value || '').trim();
  if (!title) { toast('章名不能为空'); return; }
  var no = parseInt(document.getElementById('ncNo').value, 10) || (vol.items.length + 1);
  var ten = Math.max(1, Math.min(10, parseInt(document.getElementById('ncTen').value, 10) || 5));
  vol.items.push({ no: no, title: title, beat: (document.getElementById('ncBeat').value || '').trim(), tension: ten, status: '构思' });
  vol.items.sort(function (a, b) { return a.no - b.no; });
  closeModal();
  toast(fmtCh(no) + '「' + title + '」已排入大纲');
};
ACT['add-foreshadow'] = function () { modalAddForeshadow(); };
ACT['submit-foreshadow'] = function () {
  var p = cur();
  var name = (document.getElementById('fsName').value || '').trim();
  if (!name) { toast('伏笔名称不能为空'); return; }
  var plantEl = document.getElementById('fsPlant') || document.getElementById('fsPlantNum');
  var payEl = document.getElementById('fsPay') || document.getElementById('fsPayNum');
  var plant = parseInt(plantEl.value, 10) || 1;
  var pay = payEl && payEl.value ? parseInt(payEl.value, 10) : null;
  p.foreshadows.push({
    id: uid('f'), name: name, state: pay ? '已埋设' : '悬空',
    importance: parseInt(document.getElementById('fsImp').value, 10) || 2,
    plantCh: plant, payCh: pay, note: (document.getElementById('fsNote').value || '').trim()
  });
  closeModal();
  toast('「' + name + '」已埋下' + (pay ? '' : '，未规划回收，标记为悬空'));
};
ACT['harvest'] = function (el) {
  var p = cur(), f = null;
  p.foreshadows.forEach(function (x) { if (x.id === el.getAttribute('data-id')) f = x; });
  if (!f) return;
  f._prev = f.state;
  f.state = '已回收';
  toast('「' + f.name + '」已标记回收，回收率与看板已联动更新');
};
ACT['unharvest'] = function (el) {
  var p = cur(), f = null;
  p.foreshadows.forEach(function (x) { if (x.id === el.getAttribute('data-id')) f = x; });
  if (!f) return;
  f.state = f._prev && f._prev !== '已回收' ? f._prev : '已埋设';
  toast('已撤销「' + f.name + '」的回收');
};
ACT['inspect'] = function () { runInspect(); };
/* 世界观 / 看板 */
ACT['world-cat'] = function (el) { state.worldCat = el.getAttribute('data-c'); };
ACT['add-entry'] = function () { modalAddEntry(); };
ACT['submit-entry'] = function () {
  var p = cur();
  var name = (document.getElementById('enName').value || '').trim();
  var taboo = (document.getElementById('enTaboo').value || '').trim();
  if (!name || !taboo) { toast('词条名与「禁忌」必填——设定要能影响情节'); return; }
  p.entries.push({
    id: uid('w'), cat: document.getElementById('enCat').value, name: name,
    brief: (document.getElementById('enBrief').value || '').trim(),
    detail: (document.getElementById('enDetail').value || '').trim(), taboo: taboo
  });
  closeModal();
  toast('「' + name + '」已入库');
};
ACT['entry-open'] = function (el) {
  var p = cur(), e = null;
  p.entries.forEach(function (x) { if (x.id === el.getAttribute('data-id')) e = x; });
  if (e) modalEntry(e);
};
ACT['event-open'] = function (el) {
  var p = cur(), e = null;
  p.events.forEach(function (x) { if (x.id === el.getAttribute('data-id')) e = x; });
  if (e) modalEvent(p, e);
};
ACT['event-jump'] = function (el) {
  state.selCh = parseInt(el.getAttribute('data-no'), 10);
  state.tab = 'text';
  state.textMode = 'read';
  closeModal();
};
ACT['track-toggle'] = function (el) {
  state.boardTracks[el.getAttribute('data-id')] = el.checked;
};
ACT['ctx-toggle'] = function () { document.body.classList.toggle('ctx-open'); };
/* 弹层 / 面板 */
ACT['mask-close'] = function (el, ev) {
  if (ev.target === el || el.classList.contains('icon-btn')) closeModal();
};
ACT['pal-close'] = function (el, ev) { if (ev.target === el) { state.palette.open = false; renderPalette(); } };
ACT['pal-go'] = function (el) {
  var item = state._palList && state._palList[parseInt(el.getAttribute('data-i'), 10)];
  if (item) { finalizeAllStreams(); item.go(); state.palette.open = false; renderPalette(); }
};

/* ---------- 事件委托接线（仅一次） ---------- */
function bindGlobal() {
  document.addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-act]');
    if (!el) return;
    dispatch(el.getAttribute('data-act'), el, ev);
  });
  document.addEventListener('input', function (ev) {
    var t = ev.target;
    if (t.id === 'chatSearch') {
      state.chatQuery = t.value;
      renderCtxCol();
      var again = document.getElementById('chatSearch');
      if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
    } else if (t.id === 'chatInput') {
      t.style.height = 'auto';
      t.style.height = Math.min(150, t.scrollHeight) + 'px';
    } else if (t.id === 'editArea') {
      var p = cur();
      var ms = chapterMs(p, state.selCh);
      if (ms) {
        ms.text = t.value;
        var ec = document.getElementById('editCount');
        if (ec) ec.textContent = '本章 ' + wordCount(ms.text).toLocaleString() + ' 字';
        renderTopbar();
      }
      var sb = document.getElementById('selbar');
      if (sb) sb.style.display = (t.selectionStart !== t.selectionEnd) ? 'flex' : 'none';
    } else if (t.id === 'editTitle') {
      var p2 = cur();
      var ms2 = chapterMs(p2, state.selCh);
      if (ms2) ms2.title = t.value;
    } else if (t.id === 'palInput') {
      state.palette.q = t.value;
      state.palette.sel = 0;
      renderPalette();
    }
  });
  document.addEventListener('change', function (ev) {
    var t = ev.target;
    if (t.getAttribute && t.getAttribute('data-act') === 'track-toggle') {
      state.boardTracks[t.getAttribute('data-id')] = t.checked;
      renderAll();
    }
  });
  document.addEventListener('mouseup', function (ev) {
    if (ev.target.id === 'editArea') {
      var t = ev.target;
      var sb = document.getElementById('selbar');
      if (sb) { sb.style.display = (t.selectionStart !== t.selectionEnd) ? 'flex' : 'none'; }
    }
  });
  document.addEventListener('keydown', function (ev) {
    var k = ev.key;
    if ((ev.ctrlKey || ev.metaKey) && (k === 'k' || k === 'K')) {
      ev.preventDefault();
      state.palette.open = !state.palette.open;
      state.palette.q = '';
      state.palette.sel = 0;
      renderPalette();
      return;
    }
    if (k === 'Escape') {
      if (state.palette.open) { state.palette.open = false; renderPalette(); return; }
      var mr = document.getElementById('modalRoot');
      if (mr && mr.innerHTML) { closeModal(); return; }
      if (state.focus) { state.focus = false; document.body.classList.remove('focus'); renderAll(); return; }
      if (document.body.classList.contains('ctx-open')) { document.body.classList.remove('ctx-open'); return; }
      return;
    }
    if (state.palette.open) {
      var list = state._palList || [];
      if (k === 'ArrowDown') { ev.preventDefault(); state.palette.sel = Math.min(list.length - 1, state.palette.sel + 1); renderPalette(); }
      else if (k === 'ArrowUp') { ev.preventDefault(); state.palette.sel = Math.max(0, state.palette.sel - 1); renderPalette(); }
      else if (k === 'Enter') {
        ev.preventDefault();
        var item = list[state.palette.sel];
        if (item) { finalizeAllStreams(); item.go(); state.palette.open = false; renderPalette(); }
      }
      return;
    }
    var ae = document.activeElement;
    if (ae && ae.id === 'chatInput') {
      if (k === 'Enter' && !ev.shiftKey) {
        ev.preventDefault();
        var v = ae.value;
        ae.value = '';
        sendChat(v);
      } else if (k === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
        ev.preventDefault();
        var v2 = ae.value;
        ae.value = '';
        sendChat(v2);
      }
    }
  });
}

/* ---------- 启动 ---------- */
function init() {
  state = freshState();
  // 默认轨道全开
  var p1 = cur();
  p1.tracks.forEach(function (t) { state.boardTracks[t.id] = true; });
  bindGlobal();
  renderAll();
}
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}

/* 供截图驱动脚本使用（仅浏览器） */
if (typeof window !== 'undefined') {
  window.__ns = {
    get state() { return state; },
    renderAll: function () { renderAll(); },
    switchProject: switchProject,
    sendChat: sendChat,
    openModalHtml: openModalHtml,
    modalNewProject: modalNewProject,
    modalDelProject: function () { modalDelProject(cur()); },
    runInspect: runInspect,
    finishStream: finishStream,
    draftChapter: draftChapter,
    compose: compose,
    route: route,
    openDiff: openDiff,
    rewriteText: rewriteText,
    renderPalette: renderPalette,
    modalAddForeshadow: modalAddForeshadow,
    modalAddChar: modalAddChar,
    modalAddEntry: modalAddEntry
  };
}

/* ---------- Node 单测导出（必过） ---------- */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { md: md, route: route, compose: compose, seedData: seedData, esc: esc, wordCount: wordCount };
}

