// Saves the canvas of a page once the page sets its title to «done»: node shoot-canvas.mjs <url> <out.png>
import { chromium } from 'playwright'
const [url, out] = process.argv.slice(2)
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined })
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
await page.goto(url)
await page.waitForFunction(() => document.title === 'done' || document.title.startsWith('ERR'), null, { timeout: 30000 })
const title = await page.title()
if (title !== 'done') throw new Error(title)
await page.locator('canvas').screenshot({ path: out })
await browser.close()
console.log('saved', out)
