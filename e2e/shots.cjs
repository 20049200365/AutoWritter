/* 前端重写验收端测：Playwright-core + 本机 Chrome，11 场景截图（M7 §9 场景清单子集） */
const { chromium } = require('playwright-core')
const path = require('path')

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const OUT = path.resolve(__dirname, '..', 'verify_shots', 'rewrite')
const BASE = 'http://127.0.0.1:8000'
const errors = []
const results = []

function shot(name) {
  return async (page) => {
    const p = path.join(OUT, name)
    await page.screenshot({ path: p })
    results.push({ name, ok: true })
    console.log('SHOT', name)
  }
}

async function step(page, label, fn) {
  try {
    await fn(page)
    console.log('PASS', label)
  } catch (e) {
    results.push({ name: label, ok: false, err: String(e.message || e).slice(0, 200) })
    console.log('FAIL', label, String(e.message || e).slice(0, 200))
    try { await page.screenshot({ path: path.join(OUT, 'ERR_' + label.replace(/\W+/g, '_') + '.png') }) } catch { }
  }
}

;(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--force-device-scale-factor=1'] })
  const page = await browser.newPage({ viewport: { width: 1560, height: 1000 } })
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)) })
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))

  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForSelector('.shelf-item, .book-card', { timeout: 15000 })

  await step(page, '01_shelf', async () => {
    await page.waitForTimeout(400)
    await shot('v01_shelf.png')(page)
  })

  await step(page, '02_text', async () => {
    await page.locator('.shelf-item').first().click()
    await page.locator('.tab', { hasText: '正文' }).first().click()
    await page.waitForTimeout(600)
    await shot('v02_text.png')(page)
  })

  await step(page, '03_chars', async () => {
    await page.locator('.tab', { hasText: '人物关系' }).first().click()
    await page.waitForTimeout(900)
    await shot('v03_chars.png')(page)
  })

  await step(page, '04_outline', async () => {
    await page.locator('.tab', { hasText: '大纲与伏笔' }).first().click()
    await page.waitForTimeout(600)
    await shot('v04_outline.png')(page)
  })

  await step(page, '05_inspect', async () => {
    await page.locator('button', { hasText: '一致性巡检' }).first().click()
    await page.waitForSelector('.inspect-item', { timeout: 8000 })
    await shot('v05_inspect.png')(page)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
  })

  await step(page, '06_world', async () => {
    await page.locator('.tab', { hasText: '世界观' }).first().click()
    await page.waitForTimeout(600)
    await shot('v06_world.png')(page)
  })

  await step(page, '07_board', async () => {
    await page.locator('.tab', { hasText: '时间线与看板' }).first().click()
    await page.waitForTimeout(600)
    await shot('v07_board.png')(page)
  })

  await step(page, '08_chat', async () => {
    await page.locator('.tab', { hasText: 'Agent 对话' }).first().click()
    await page.waitForTimeout(500)
    // 无会话则新建
    if (await page.locator('#colCtx .row').count() === 0) {
      await page.locator('#colCtx .icon-btn').first().click()
      await page.waitForTimeout(400)
    }
    await page.locator('#colCtx .row').first().click().catch(() => { })
    await page.waitForTimeout(400)
    await page.locator('.chat-input textarea').fill('你好，盘点一下这本书的家底')
    await page.locator('.btn.primary', { hasText: '落笔' }).first().click()
    // 等工具卡 + 正文（真模型流式，最多 90s）
    await page.waitForSelector('.toolcard', { timeout: 20000 }).catch(() => { })
    await page.waitForFunction(() => {
      const md = document.querySelector('.msg.ai .md-body')
      return md && md.textContent && md.textContent.length > 30 && !document.querySelector('.cursor')
    }, { timeout: 90000 }).catch(() => { })
    await page.waitForTimeout(500)
    await shot('v08_chat.png')(page)
  })

  await step(page, '09_palette', async () => {
    await page.keyboard.press('Control+k')
    await page.waitForSelector('.palette input', { timeout: 3000 })
    await page.locator('.palette input').fill('章')
    await page.waitForTimeout(500)
    await shot('v09_palette.png')(page)
    await page.keyboard.press('Escape')
  })

  await step(page, '10_generate', async () => {
    await page.locator('.tab', { hasText: '生成' }).first().click()
    await page.waitForTimeout(600)
    await shot('v10_generate.png')(page)
  })

  await step(page, '11_del_modal', async () => {
    await page.locator('.shelf-item').first().click({ button: 'right' })
    await page.waitForSelector('.modal', { timeout: 3000 })
    await shot('v11_del_modal.png')(page)
    await page.locator('.modal .btn', { hasText: '再想想' }).click()
  })

  console.log('\n===== CONSOLE ERRORS =====')
  console.log(errors.length ? errors.join('\n') : '（无）')
  console.log('\n===== RESULTS =====')
  results.forEach((r) => console.log(r.ok ? 'PASS' : 'FAIL', r.name, r.err || ''))
  await browser.close()
})().catch((e) => { console.error('FATAL', e); process.exit(1) })
