/**
 * Pure helpers for the Workers tab: parse an expert skill definition into the roster card fields and the detail
 * blocks, and derive per-expert revision history, routing rule, and attributed tickets. Read-only over the
 * management API answers; unknown formats degrade (a definition without the heading template falls back to its raw
 * text) and never throw.
 */
import type { PromptsView, TicketRow } from './api.ts'

/** The definition's first H1 line: `# 名字（用途分类）——一句话职责`; the category may be missing. */
export interface ExpertHeading { name?: string; category?: string; duty?: string }

/** Semantic detail blocks the panel knows; anything else folds into an "other sections" list. */
export type BlockId = 'anti' | 'voice' | 'tools' | 'verification' | 'quiet' | 'memory' | 'learning' | 'health' | 'onboarding'
export interface SectionBlock { id: BlockId; title: string; body: string }

/** One revision that touched a skill, newest first as the host answers. */
export interface RevisionRow { revision: number; savedAt?: string; source?: string; changed: string[] }

export interface ExpertCard {
  key: string; name: string; category?: string; duty?: string
  /** First revision that mounted this skill and the newest one that changed it; undefined when the host's history page does not reach that far. */
  mount?: RevisionRow; updated?: RevisionRow
  /** Open tickets whose title carries the expert's name marker. */
  active: number
}
export interface RosterGroup { category?: string; experts: ExpertCard[] }

export const BLOCK_LABEL_KEYS = { anti: 'workersAnti', voice: 'workersVoice', tools: 'workersTools', verification: 'workersVerification',
  quiet: 'workersQuiet', memory: 'workersMemory', learning: 'workersLearning', health: 'workersHealth', onboarding: 'workersOnboarding' } as const

/** The known `## ` section titles and their semantic blocks;「工具白名单」「交付标准」「方法论记忆」are accepted variants. */
const HEADINGS: Record<string, BlockId> = { 反职责: 'anti', 表达风格: 'voice', 工具边界: 'tools', 工具白名单: 'tools',
  验证回路: 'verification', 交付标准: 'verification', 安静义务: 'quiet', 领域记忆: 'memory', 方法论记忆: 'memory',
  组织学习: 'learning', 健康检查: 'health', 首次启用: 'onboarding' }

/** Parses the definition's first H1 heading (`# `, not a deeper level); `undefined` when the text has none. */
export function parseHeading(text: string): ExpertHeading | undefined {
  const line = text.split('\n').map(item => item.trim()).find(item => /^#(?!#)/.test(item))
  if (!line) return undefined
  const body = line.replace(/^#\s*/, '')
  const dash = body.indexOf('——')
  const [title, duty] = dash < 0 ? [body, undefined] : [body.slice(0, dash).trim(), body.slice(dash + 2).trim()]
  const open = title.indexOf('（'), close = title.indexOf('）')
  return open > 0 && close > open
    ? { name: title.slice(0, open).trim(), category: title.slice(open + 1, close).trim() || undefined, duty: duty || undefined }
    : { name: title.trim(), duty: duty || undefined }
}

/** Splits the definition into its intro paragraph and `## ` sections, classifying known headings; unknown ones fold. */
export function splitSections(text: string): { intro: string; blocks: SectionBlock[]; unknown: string[] } {
  const lines = text.split('\n')
  const at = lines.findIndex(line => /^##(?!#)/.test(line))
  const head = (at < 0 ? lines : lines.slice(0, at)).filter(line => !line.startsWith('#'))
  const intro = head.join('\n').trim()
  const blocks: SectionBlock[] = []
  const unknown: string[] = []
  for (let index = at; index >= 0 && index < lines.length;) {
    const title = lines[index]!.replace(/^##\s*/, '').trim()
    const body: string[] = []
    let end = index + 1
    while (end < lines.length && !/^##(?!#)/.test(lines[end]!)) body.push(lines[end]!), end++
    const normalized = title.split('（')[0]!.trim()
    const id = HEADINGS[normalized] ?? (normalized.startsWith('例行') ? 'learning' : undefined)
    const content = body.join('\n').trim()
    if (id && content) blocks.push({ id, title, body: content })
    else if (!id && content) unknown.push(title)
    index = end
  }
  return { intro, blocks, unknown }
}

/** Parses 允许/不允许/禁止 lines into chip groups; `undefined` when the section does not follow that shape. */
export function parseTools(body: string): { allow: string[]; deny: string[] } | undefined {
  const allow: string[] = [], deny: string[] = []
  for (const raw of body.split('\n')) {
    const match = raw.replace(/^[-*\s]*/, '').match(/^(允许|不允许|禁止)\s*[：:]\s*(.+?)\s*$/)
    if (!match) continue
    const items = match[2]!.split(/[、，;；]/).map(item => item.replace(/[。．]\s*$/, '').trim()).filter(Boolean)
    for (const item of items) (match[1] === '允许' ? allow : deny).push(item)
  }
  return allow.length || deny.length ? { allow, deny } : undefined
}

/** The revisions whose change list touches `skill/<key>`, newest first as the host answers them. */
export function skillHistory(revisions: PromptsView['revisions'] | undefined, key: string): RevisionRow[] {
  const marker = `skill/${key}`
  return (revisions ?? []).filter(item => Array.isArray(item.changed) && item.changed.includes(marker))
    .map(({ revision, savedAt, source, changed }) => ({ revision, savedAt, source, changed: [...changed] }))
}

/** Tickets whose title carries the expert's full name marker 「（名字）」; no fuzzy or alias matching. */
export function attributed(tickets: readonly TicketRow[], name: string | undefined): TicketRow[] {
  if (!name) return []
  const marker = `（${name}）`
  return tickets.filter(ticket => typeof ticket.title === 'string' && ticket.title.includes(marker))
}

/** The scope paragraph that routes to this skill, verbatim; `undefined` when the scope does not mention it. */
export function routingParagraph(scope: unknown, key: string): string | undefined {
  if (typeof scope !== 'string') return undefined
  return scope.split(/\n{2,}/).map(paragraph => paragraph.trim()).filter(Boolean)
    .find(paragraph => paragraph.includes(`dsh-superagent-${key}`))
}

/** Builds the roster: one card per mounted skill, grouped by the heading's category, uncategorized last. */
export function buildRoster(skills: PromptsView['current']['config']['skills'], revisions: PromptsView['revisions'] | undefined,
  open: readonly TicketRow[]): RosterGroup[] {
  const cards = Object.entries(skills ?? {}).map(([key, text]) => {
    const heading = parseHeading(String(text ?? ''))
    const history = skillHistory(revisions, key)
    return { key, name: heading?.name || key, category: heading?.category, duty: heading?.duty,
      mount: history.at(-1), updated: history[0], active: attributed(open, heading?.name).length }
  })
  const groups = new Map<string, RosterGroup>()
  for (const card of cards) {
    const label = card.category ?? ''
    const group = groups.get(label) ?? { category: card.category, experts: [] }
    group.experts.push(card)
    groups.set(label, group)
  }
  // Team-growth order: the earliest mount among the group's members, then the name; the uncategorized group sits last.
  const mountOf = (group: RosterGroup) => Math.min(...group.experts.map(card => card.mount?.revision ?? Number.MAX_SAFE_INTEGER))
  return [...groups.values()].sort((a, b) => {
    const uncategorized = Number(a.category === undefined) - Number(b.category === undefined)
    return uncategorized || mountOf(a) - mountOf(b) || (a.category ?? '').localeCompare(b.category ?? '')
  }).map(group => ({ category: group.category, experts: [...group.experts].sort((a, b) => a.name.localeCompare(b.name)) }))
}
