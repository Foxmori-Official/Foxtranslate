// Binary service marks are stored losslessly as text for the GitHub MCP upload.
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
const directory = fileURLToPath(new URL('../public/engine-icons', import.meta.url))
for (const filename of await readdir(directory)) {
  if (!filename.endsWith('.png.b64')) continue
  const encoded = (await readFile(join(directory, filename), 'utf8')).trim()
  const bytes = Buffer.from(encoded, 'base64')
  if (bytes.toString('base64') !== encoded) throw new Error('Invalid bundled image: ' + filename)
  await writeFile(join(directory, filename.slice(0, -4)), bytes)
}
