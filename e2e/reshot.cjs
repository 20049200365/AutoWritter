/* 复验：书架卡片高度 + 看板进度环文字 */
const { chromium } = require('playwright-core')
const path = require('path')
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const OUT = path.resolve(__dirname, '..', 'verify_shots', 'rewrite')
;(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true })
  const page = await browser.newPage({ viewport: { width: 1560, height: 1000 } })
  await page.goto('http://127.0.0.1:8000', { waitUntil: 'networkidle' })
  await page.waitForSelector('.book-card', { timeout: 15000 })
  await page.waitForTimeout(400)
  await page.screenshot({ path: path.join(OUT, 'v01_shelf.png') })
  await page.locator('.shelf-item').first().click()
  await page.locator('.tab', { hasText: '时间线与看板' }).first().click()
  await page.waitForTimeout(700)
  await page.screenshot({ path: path.join(OUT, 'v07_board.png') })
  console.log('RESHOT OK')
  await browser.close()
})().catch((e) => { console.error('FATAL', e); process.exit(1) })
