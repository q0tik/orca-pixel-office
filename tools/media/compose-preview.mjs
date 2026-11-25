// The social preview (1280×640): an office frame on top, a band with the title and the slogan in our own pixel
// font (pixelfont.mjs). node tools/media/compose-preview.mjs <office-1280x432.png> <out.png>
import { chromium } from 'playwright'
import { readFileSync, writeFileSync } from 'node:fs'
const [img, out] = process.argv.slice(2)
const font = readFileSync(new URL('./pixelfont.mjs', import.meta.url), 'utf8').replace(/^export /gm, '')
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined })
const page = await browser.newPage({ viewport: { width: 1280, height: 640 } })
await page.setContent('<canvas width="1280" height="640"></canvas>')
const png = await page.evaluate(async ({ font, data }) => {
  const f = new Function(font + ';return {drawText,textWidth}')()
  const { drawText } = f
  const im = new Image(); im.src = data; await im.decode()
  const c = document.querySelector('canvas'); const ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false
  ctx.fillStyle = '#16131f'; ctx.fillRect(0, 0, 1280, 640)
  ctx.drawImage(im, 0, 0)
  ctx.fillStyle = '#2f2942'; ctx.fillRect(0, 432, 1280, 4)
  const title = 'Orca Pixel Office'
  const col = (i) => (i >= 5 && i < 10 ? '#f2a541' : '#f3e6c4')
  drawText(ctx, title, 48 + 8, 474 + 8, 8, '#2f2942')
  drawText(ctx, title, 48, 474, 8, col)
  const slogan = 'A pixel-art office where your Orca bots work'
  drawText(ctx, slogan, 48 + 3, 568 + 3, 3, '#2f2942')
  drawText(ctx, slogan, 48, 568, 3, '#a9b1d6')
  const tag = 'MIT · zero tokens'
  const tx = 1280 - 48 - f.textWidth(tag, 3)
  drawText(ctx, tag, tx, 568, 3, '#6f6a8f')
  return c.toDataURL('image/png')
}, { font, data: 'data:image/png;base64,' + readFileSync(img).toString('base64') })
writeFileSync(out, Buffer.from(png.split(',')[1], 'base64'))
await browser.close()
