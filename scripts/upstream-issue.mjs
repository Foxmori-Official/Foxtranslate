import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
const marker = '<!-- foxtranslate-upstream-review -->'
const title = '参考项目更新待审阅'
const report = JSON.parse(await readFile('reports/upstream-updates.json', 'utf8'))
const issues = JSON.parse(execFileSync('gh', ['issue', 'list', '--state', 'all', '--search', title + ' in:title', '--limit', '100', '--json', 'number,body,state'], { encoding: 'utf8' }))
const issue = issues.find(item => item.body?.includes(marker))
if (!report.changedCount) {
  if (issue?.state === 'OPEN') execFileSync('gh', ['issue', 'close', String(issue.number), '--reason', 'completed'], { stdio: 'inherit' })
  console.log('All reference commits have been reviewed.')
  process.exit(0)
}
if (issue?.state === 'CLOSED') execFileSync('gh', ['issue', 'reopen', String(issue.number)], { stdio: 'inherit' })
const body = marker + '\n' + await readFile('reports/upstream-updates.md', 'utf8')
const args = issue ? ['issue', 'edit', String(issue.number), '--body-file', '-'] : ['issue', 'create', '--title', title, '--body-file', '-']
execFileSync('gh', args, { input: body, stdio: ['pipe', 'inherit', 'inherit'] })
