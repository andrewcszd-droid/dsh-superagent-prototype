// @vitest-environment jsdom
// The Workers tab: the mounted expert roster and the per-expert detail view.
import { expect, it } from 'vitest'
import { zh } from '../src/client/locales.ts'
import { at, click, all, find, mount, tab, text, usePanel } from './fixtures/panel.tsx'
import { promptVersion, server, ticketSummary } from './fixtures/panel-server.ts'

usePanel()

const DEFINITIONS = {
  'beijixing-product': `# 北极星（产品需求）——产品经理专家

把一句话需求梳理成完整、分层、可验证的产品需求。

## 反职责

- 不写产品代码
- 不定技术方案
- 不排交付窗口
- 不改验收标准
- 不越界做设计
- 不臆造需求

## 表达风格

结论先行，列表化。

## 工具边界

- 允许：飞书读取、GitHub 只读
- 禁止：写操作、部署与发布

## 验证回路

- 每条需求有验收标准
- 每条标注来源
- 引用原文不改写
- 第四条
- 第五条
- 第六条
- 第七条
- 第八条

## 安静义务

回路健康时保持安静。

## 领域记忆

信息源优先级：操作者原话 > 仓库核实。历史纠正记录：空（首启）。

## 某个未知小节

未知内容。
`,
  'zhiliang-research': `# 知了（调研分析）——调研专家

回答"X 是怎么做的"。
`,
  plain: '没有标题模板的原始文本，直接展示。',
}
const say = (key: string, params: Record<string, string | number> = {}) =>
  zh[key as keyof typeof zh].replace(/\{(\w+)\}/g, (_match, name: string) => String(params[name]))
const card = (name: string) => all('.dt-worker-card').find(element => element.textContent?.includes(name))!
const button = (label: string) => all('button').find(element => element.textContent?.trim() === label)!
/** Mounts three skills with a two-revision history and a scope paragraph that routes to the first. */
const mountSkills = () => {
  const config = { ...server.prompts.current.config, skills: DEFINITIONS,
    scope: '涉及「产品需求」的请求：负责的 worker 先加载团队 skill dsh-superagent-beijixing-product，按其方法论产出结构化需求文档。\n\n其他段落。' }
  server.prompts = { ...server.prompts, revision: 12, current: promptVersion(12, config), revisions: [
    { revision: 12, previousRevision: 11, savedAt: '2026-11-10T01:35:00Z', source: 'panel', changed: ['skill/beijixing-product'] },
    { revision: 4, previousRevision: 3, savedAt: '2026-11-09T10:44:00Z', source: 'panel',
      changed: ['skill/beijixing-product', 'skill/zhiliang-research'] },
    { revision: 2, previousRevision: 1, savedAt: '2026-11-09T09:43:00Z', source: 'panel', changed: ['skill/zhiliang-research'] },
  ] }
}
const open = async () => { await click(zh['tab.workers']) }

it('groups the roster by category in team-growth order with the uncategorized group folded last, and badges active experts', async () => {
  mountSkills()
  server.tickets.open = [ticketSummary({ id: 't9', title: '看板需求重设计（北极星）：新增「专家 worker」页签' })]
  await mount()
  await open()
  expect(tab(zh['tab.workers']).getAttribute('aria-selected')).toBe('true')
  expect(text()).toContain(zh.workersTeam)
  expect(document.querySelector('.dt-section-title .dt-count')?.textContent).toBe('3')
  const groups = all('.dt-worker-group')
  expect(groups).toHaveLength(3)
  expect(groups[0]!.textContent).toContain('调研分析')
  expect(groups[1]!.textContent).toContain('产品需求')
  expect(groups[2]!.textContent).toContain(zh.workersUncategorized)
  // The mounted and last-changed revisions come from the host's history, newest change last shown.
  expect(card('知了').textContent).toContain(say('workersRev', { revision: 2 }))
  expect(card('北极星').textContent).toContain(say('workersRev', { revision: 4 }))
  expect(card('北极星').textContent).toContain(zh.workersUpdated)
  expect(card('北极星').textContent).toContain(say('workersBadgeActive', { count: 1 }))
  expect(card('知了').textContent).toContain(zh.workersBadgeIdle)
  // The folded uncategorized group stays closed until its summary opens it.
  expect(all('.dt-worker-card')).toHaveLength(3)
  expect(groups[2]!.hasAttribute('open')).toBe(false)
  await click(groups[2]!.querySelector('summary')!)
  expect(groups[2]!.hasAttribute('open')).toBe(true)
  expect(card('plain')).toBeTruthy()
})

it('attributes open tickets only by the exact full-name marker in the title', async () => {
  mountSkills()
  server.tickets.open = [ticketSummary({ id: 't9', title: '看板需求重设计（北极星）：新增「专家 worker」页签' }),
    ticketSummary({ id: 't10', title: '模糊标题（北极' }), ticketSummary({ id: 't11', title: '无标注工单' })]
  await mount()
  await open()
  expect(card('北极星').textContent).toContain(say('workersBadgeActive', { count: 1 }))
  expect(card('知了').textContent).toContain(zh.workersBadgeIdle)
})

it('opens the detail with the definition columns, the verbatim routing rule, this skill\'s history, and its attributed tickets', async () => {
  mountSkills()
  server.tickets.open = [ticketSummary({ id: 't9', title: '看板需求重设计（北极星）：新增「专家 worker」页签' })]
  await mount()
  await open()
  await click(card('北极星'))
  expect(find(zh['tab.workers'], '.dt-page-head button').textContent).toBe(zh['tab.workers'])
  expect(text()).toContain('把一句话需求梳理成完整、分层、可验证的产品需求。')
  expect(text()).toContain(say('workersCountShown', { count: 6, shown: 3 }))
  expect(text()).toContain('不排交付窗口')
  expect(text()).not.toContain('不改验收标准')
  await click(say('workersExpandAll', { count: 6 }))
  expect(text()).toContain('不改验收标准')
  expect(text()).toContain('Prove It Works')
  expect(text()).toContain(say('workersCountShown', { count: 8, shown: 3 }))
  expect(text()).toContain(zh.workersToolsAllow)
  expect(text()).toContain('飞书读取')
  expect(text()).toContain('部署与发布')
  expect(text()).toContain('dsh-superagent-beijixing-product')
  expect(text()).toContain('结构化需求文档')
  expect(text()).toContain(say('workersRev', { revision: 12 }))
  expect(text()).toContain('beijixing-product')
  expect(text()).toContain('看板需求重设计（北极星）：新增「专家 worker」页签')
  expect(text()).toContain('执行中')
  expect(text()).toContain(zh.workersSince.split('{time}')[1]!.trim())
  expect(document.querySelector('.dt-chip-link')?.getAttribute('href')).toBe('https://github.com/acme/widgets/pull/42')
  expect(text()).not.toContain('修复回归')
  expect(text()).toContain(say('workersOtherSections', { count: 1, parts: '某个未知小节' }))
})

it('shows the full definition verbatim on demand', async () => {
  mountSkills()
  await mount()
  await open()
  await click(card('北极星'))
  expect(text()).not.toContain('## 安静义务')
  await click(zh.workersRawToggle)
  expect(document.querySelector('.dt-pre')?.textContent).toBe(DEFINITIONS['beijixing-product'])
})

it('falls back to the raw text for a definition without the heading template', async () => {
  mountSkills()
  await mount()
  await open()
  await click(all('.dt-worker-fold summary')[0]!)
  await click(card('plain'))
  expect(text()).toContain(zh.workersRaw)
  expect(text()).toContain('没有标题模板的原始文本')
})

it('states an empty roster explicitly and links to the Prompts settings', async () => {
  await mount()
  await open()
  expect(text()).toContain(zh.workersEmptyTitle)
  await click(zh.workersEmptySettings)
  expect(tab(zh['tab.settings']).getAttribute('aria-selected')).toBe('true')
})

it('degrades to a banner when Prompts are unreachable, and recovers on retry', async () => {
  mountSkills()
  server.down = true
  await mount()
  await open()
  expect(text()).toContain(zh.workersDegradedTitle)
  expect(text()).not.toContain(zh.workersTeam)
  server.down = false
  await click(zh.retry)
  expect(document.querySelector('.dt-section-title .dt-count')?.textContent).toBe('3')
})

it('hides the blocks whose fields the host omits instead of failing', async () => {
  const config = { ...server.prompts.current.config, skills: { 'beijixing-product': DEFINITIONS['beijixing-product']! }, scope: '' }
  server.prompts = { ...server.prompts, revision: 12, current: promptVersion(12, config), revisions: [] }
  await mount()
  await open()
  expect(card('北极星').textContent).not.toContain('rev')
  await click(card('北极星'))
  expect(text()).toContain(zh.workersDuty)
  expect(text()).not.toContain(zh.workersRouting)
  expect(text()).not.toContain(zh.workersHistory)
  expect(text()).toContain(say('workersTicketsEmpty', { name: '北极星' }))
})

it('says when a route names a key the config does not have', async () => {
  at({ page: 'workers', id: 'missing-key' })
  await mount()
  expect(text()).toContain(zh.workersMissing)
})
