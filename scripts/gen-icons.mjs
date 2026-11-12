// Resize the independent Foxtranslate logo for the extension manifest and bundled pages.
import sharp from 'sharp'
import { fileURLToPath } from 'node:url'

const source = fileURLToPath(new URL('../public/icons/foxtranslate-logo.png', import.meta.url))
for (const size of [16, 32, 48, 128, 256, 512]) {
  const output = fileURLToPath(new URL(`../public/icons/icon${size}.png`, import.meta.url))
  await sharp(source).resize(size, size).png().toFile(output)
}
