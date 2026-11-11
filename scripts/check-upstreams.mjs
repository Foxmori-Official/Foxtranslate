// Fetch metadata only. Reference source is never downloaded or executed.
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const sources = JSON.parse(await readFile(resolve(root, 'docs/upstreams.json'), 'utf8'))
const baseline = JSON.parse(await readFile(resolve(root, 'docs/upstream-baseline.json'), 'utf8'))
const output = resolve(process.env.UPSTREAM_REPORT_DIR || resolve(root, 'reports'))
const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
if (process.env.GITHUB_TOKEN) headers.Authorization = 'Bearer ' + process.env.GITHUB_TOKEN

async function request(path, optional = false) {
  const response = await fetch('https://api.github.com' + path, { headers, signal: AbortSignal.timeout(30_000) })
  if (optional && response.status === 404) return null
  if (!response.ok) throw new Error('GitHub metadata request failed (' + response.status + '): ' + path)
  return response.json()
}
function text(value) {
  return String(value || '').replace(/<!--[\s\S]*?-->/g, '').trim().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/@/g, '@\u200b')
}

const results = []
for (const source of sources) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(source.repository)) throw new Error('Invalid repository name')
  const prefix = '/repos/' + source.repository
  const repo = await request(prefix)
  const head = await request(prefix + '/commits/' + encodeURIComponent(repo.default_branch))
  const release = await request(prefix + '/releases/latest', true)
  const previous = baseline.reviewed[source.repository]?.sha || null
  if (previous && !/^[a-f0-9]{40}$/.test(previous)) throw new Error('Reviewed baseline requires a complete commit SHA')
  const compare = previous && previous !== head.sha ? await request(prefix + '/compare/' + previous + '...' + head.sha, true) : null
  results.push({
    ...source,
    url: repo.html_url,
    license: repo.license?.spdx_id || 'Check upstream LICENSE',
    defaultBranch: repo.default_branch,
    reviewedSha: previous,
    headSha: head.sha,
    changed: previous !== head.sha,
    compareUrl: compare?.html_url || repo.html_url + '/commits/' + encodeURIComponent(repo.default_branch),
    comparisonStatus: compare?.status || (previous ? 'unchanged-or-compare-unavailable' : 'unreviewed'),
    commits: (compare?.commits || [head]).slice(-15).map(item => ({ sha: item.sha, url: item.html_url, message: item.commit.message.split('\n')[0] })),
    release: release ? { tag: release.tag_name, url: release.html_url, publishedAt: release.published_at, body: release.body } : null,
  })
}
const changed = results.filter(item => item.changed)
const lines = [
  '# 参考项目更新检查',
  '',
  '检查时间 ' + new Date().toISOString(),
  '',
  '待审阅项目 ' + changed.length + ' / ' + results.length + '。初次运行的项目标记为未审阅，表示还没有人工确认的比较基线。',
  '',
  '本报告收集上游公开信息。是否采用需要按 docs/UPDATING.md 评估，更新审阅基线与合入代码分别记录。',
]
for (const item of results) {
  lines.push('', '## ' + item.name, '', '[' + item.repository + '](' + item.url + ')', '',
    '关注方向 ' + item.focus, '', '当前提交 `' + item.headSha + '` · 许可证 ' + item.license, '',
    item.reviewedSha ? '人工审阅基线 `' + item.reviewedSha + '`' : '人工审阅基线尚未建立。',
    '', '[提交与差异](' + item.compareUrl + ')')
  if (item.release) {
    const body = text(item.release.body)
    const excerpt = body.length > 4500 ? body.slice(0, 4500).split('\n').slice(0, -1).join('\n') : body
    lines.push('', '[最新 Release ' + text(item.release.tag) + '](' + item.release.url + ')', '', excerpt)
    if (body.length > 4500) lines.push('', '[阅读完整更新说明](' + item.release.url + ')')
  }
  else lines.push('', '上游没有可用的正式 Release，按默认分支提交检查。')
  for (const commit of item.commits) lines.push('- [' + commit.sha.slice(0, 7) + '](' + commit.url + ') ' + text(commit.message))
  lines.push('', '- [ ] 检查用户收益与现有能力', '- [ ] 检查源文件、许可证与归属', '- [ ] 记录采用、暂缓或不采用的决定', '- [ ] 建立回归用例并通过构建')
}
await mkdir(output, { recursive: true })
await writeFile(resolve(output, 'upstream-updates.json'), JSON.stringify({ checkedAt: new Date().toISOString(), changedCount: changed.length, results }, null, 2) + '\n')
await writeFile(resolve(output, 'upstream-updates.md'), lines.join('\n') + '\n')
console.log('Checked ' + results.length + ' references; ' + changed.length + ' await review. Reports: ' + output)
