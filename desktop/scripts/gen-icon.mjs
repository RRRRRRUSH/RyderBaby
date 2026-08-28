// 用用户提供的 icon.jpg 生成应用图标：多尺寸 PNG + icon.ico + tray.png
// 用法: node scripts/gen-icon.mjs [source]
import sharp from 'sharp'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pngToIco from 'png-to-ico'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = process.argv[2] || join(root, '..', 'icon.jpg')
const outDir = join(root, 'build')
mkdirSync(outDir, { recursive: true })

// 统一尺寸并填充成正方形（原图 1263x1265 基本正方，保险起见 fit=cover）
const base = sharp(src).resize(1024, 1024, { fit: 'cover' })

// 1. 各尺寸 PNG（ICO 需要的 + 托盘 + 高分辨率）
const sizes = [16, 24, 32, 48, 64, 128, 256, 512]
const pngBuffers = {}
for (const s of sizes) {
  pngBuffers[s] = await base.clone().resize(s, s).png().toBuffer()
}
await base.clone().resize(256, 256).png().toFile(join(outDir, 'icon.png'))
await base.clone().resize(512, 512).png().toFile(join(outDir, 'icon-512.png'))
console.log('PNG written: icon.png (256), icon-512.png (512)')

// 2. ICO（Windows 托盘 + 打包）
const ico = await pngToIco([16, 24, 32, 48, 64, 128, 256].map((s) => pngBuffers[s]))
writeFileSync(join(outDir, 'icon.ico'), ico)
console.log('ICO written: icon.ico')

// 3. 托盘 32px
writeFileSync(join(outDir, 'tray.png'), pngBuffers[32])
console.log('Tray PNG written: tray.png (32)')
