// 生成应用图标：build/icon.svg → 多尺寸 PNG + icon.ico + 托盘 PNG
// 用法: node scripts/gen-icon.mjs
import sharp from 'sharp'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pngToIco from 'png-to-ico'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const svg = readFileSync(join(root, 'build', 'icon.svg'))
const outDir = join(root, 'build')
mkdirSync(outDir, { recursive: true })

// 1. 各尺寸 PNG（ICO 需要的 + 托盘 + 高分辨率）
const sizes = [16, 24, 32, 48, 64, 128, 256, 512]
const pngBuffers = {}
for (const s of sizes) {
  pngBuffers[s] = await sharp(svg).resize(s, s).png().toBuffer()
}
await sharp(svg).resize(256, 256).png().toFile(join(outDir, 'icon.png'))
await sharp(svg).resize(512, 512).png().toFile(join(outDir, 'icon-512.png'))
console.log('PNG written: icon.png (256), icon-512.png (512)')

// 2. ICO（Windows 托盘 + 打包）：16/24/32/48/64/128/256
const ico = await pngToIco([16, 24, 32, 48, 64, 128, 256].map((s) => pngBuffers[s]))
writeFileSync(join(outDir, 'icon.ico'), ico)
console.log('ICO written: icon.ico')

// 3. 托盘用 32px（开发期 nativeImage 直接吃）
writeFileSync(join(outDir, 'tray.png'), pngBuffers[32])
console.log('Tray PNG written: tray.png (32)')
