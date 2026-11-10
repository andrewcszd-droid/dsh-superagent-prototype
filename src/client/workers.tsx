/** Workers tab: the mounted expert roster grouped by category, with a per-expert detail view. Read-only over GET prompts/GET tickets. */
import { useRef, useState } from 'react'
import { usePoll, type PromptsView, type TicketRow } from './api.ts'
import { Button, Icon, Pill, StateDot, Tag } from './controls.tsx'
import { attributed, BLOCK_LABEL_KEYS, buildRoster, parseHeading, parseTools, routingParagraph, skillHistory, splitSections,
  type ExpertCard, type RosterGroup, type RevisionRow, type SectionBlock } from './roster.ts'
import { usePanel } from './provider.tsx'
import { ThreadChip } from './rows.tsx'
import { ticketMark } from './marks.ts'
import { settingsRoute } from './route.ts'
import { when } from './text.ts'
import { Hint, LoadState, MarkdownLite, PageHead, Section, StatusHead, When } from './widgets.tsx'

/** Prompts and open tickets the tab reads; the prompts fetch records its last good time for the degraded banner. */
function useExperts() {
  const { call } = usePanel()
  const lastGood = useRef<string>()
  const prompts = usePoll(async () => {
    const view = await call('GET prompts')
    lastGood.current = new Date().toISOString()
    return view
  }, [])
  const tickets = usePoll(async () => (await call('GET tickets', { query: { state: 'open' } })).items, [])
  return { prompts, tickets, lastGood }
}

/** The degraded banner: what broke, when the data was last good, and a retry, per the degradation matrix. */
function Degraded({ error, lastGood, onRetry }: { error: Error; lastGood?: string; onRetry: () => void }) {
  const { t } = usePanel()
  return <div className="dt-banner" role="alert">
    <b className="dt-banner-label">{t('workersDegradedTitle')}</b>
    <Hint>{error.message}</Hint>
    {lastGood && <Hint>{t('workersDegradedStale', { time: when(lastGood, t('lang')) })}</Hint>}
    <div className="dt-banner-actions"><Button variant="outline" size="sm" icon={<Icon name="refresh" size={14} />}
      onClick={onRetry}>{t('retry')}</Button></div>
  </div>
}

/** One roster card: name, duty line, activity badge, and mount/change revisions. */
function ExpertCardView({ card }: { card: ExpertCard }) {
  const { t, navigate } = usePanel()
  return <button type="button" className="dt-worker-card" onClick={() => navigate({ page: 'workers', id: card.key })}>
    <span className="dt-worker-head"><strong className="dt-worker-name">{card.name}</strong>
      <Tag tone={card.active ? 'warning' : 'neutral'}><StateDot state={card.active ? 'warning' : 'idle'} />
        {card.active ? t('workersBadgeActive', { count: card.active }) : t('workersBadgeIdle')}</Tag></span>
    {card.duty && <span className="dt-worker-duty">{card.duty}</span>}
    <span className="dt-worker-meta">
      {card.mount !== undefined && <span className="dt-mono dt-worker-rev">{t('workersRev', { revision: card.mount.revision })}</span>}
      {card.mount?.savedAt && <span>{t('workersMounted')} <When at={card.mount.savedAt} /></span>}
      {card.updated?.savedAt && card.updated.revision !== card.mount?.revision
        && <span>· {t('workersUpdated')} <When at={card.updated.savedAt} /></span>}
    </span>
  </button>
}

/** One category block: its title with a count and the expert cards; the uncategorized group folds by default. */
function GroupView({ group }: { group: RosterGroup }) {
  const { t } = usePanel()
  const cards = group.experts.map(card => <ExpertCardView key={card.key} card={card} />)
  if (group.category !== undefined) return <div className="dt-worker-group">
    <h3 className="dt-worker-group-title">{group.category}<span className="dt-count">{group.experts.length}</span></h3>
    {cards}
  </div>
  return <details className="dt-worker-group dt-worker-fold">
    <summary className="dt-worker-group-title">{t('workersUncategorized')}<span className="dt-count">{group.experts.length}</span></summary>
    {cards}
  </details>
}

/** The tab body: a category filter, category groups of cards, an explicit empty state, or the degraded banner. */
export function WorkersPage() {
  const { t, navigate } = usePanel()
  const [filter, setFilter] = useState<string>()
  const { prompts, tickets, lastGood } = useExperts()
  const skills = prompts.data?.current.config.skills
  const groups: RosterGroup[] | undefined = skills
    ? buildRoster(skills, prompts.data?.revisions, tickets.data ?? []) : undefined
  const shown = filter === undefined ? groups : groups?.filter(group => group.category === filter)
  const total = skills ? Object.keys(skills).length : 0
  return <>
    <StatusHead hint={t('workersIntro')} />
    {prompts.error && <Degraded error={prompts.error} lastGood={lastGood.current} onRetry={() => void prompts.reload()} />}
    {!prompts.error && <Hint>{t('workersSource')}</Hint>}
    <LoadState loading={!prompts.data && !prompts.error} />
    {skills && total === 0 && <div className="dt-workers-empty">
      <span className="dt-workers-empty-icon"><Icon name="user" size={20} /></span>
      <b>{t('workersEmptyTitle')}</b>
      <Hint>{t('workersEmptyBody')}</Hint>
      <Button variant="outline" size="sm" icon={<Icon name="settings" size={14} />}
        onClick={() => navigate(settingsRoute('prompts'))}>{t('workersEmptySettings')}</Button>
    </div>}
    {groups !== undefined && total > 0 && <>
      <div className="dt-filters">
        <Pill active={filter === undefined} onClick={() => setFilter(undefined)}>{t('workersAll')} {total}</Pill>
        {groups.map(group => <Pill key={group.category ?? '__uncategorized'} active={filter === group.category}
          onClick={() => setFilter(group.category)}>
          {group.category ?? t('workersUncategorized')} {group.experts.length}</Pill>)}
      </div>
      <Section title={t('workersTeam')} count={total}>
        {tickets.error && <Hint>{t('queuePartial')}</Hint>}
        <div className="dt-workers-grid">{shown?.map(group => <GroupView key={group.category ?? '__uncategorized'} group={group} />)}</div>
      </Section>
    </>}
  </>
}

/** Bullet lines of a section body; the detail view shows the first three and expands on demand. */
const linesOf = (block: SectionBlock): string[] =>
  block.body.split('\n').map(line => line.replace(/^[-*\s]*/, '').trim()).filter(Boolean)

/** A counted bullet list that shows the first three items and expands on demand. */
function Points({ items }: { items: string[] }) {
  const { t } = usePanel()
  const [open, setOpen] = useState(false)
  const shown = open ? items : items.slice(0, 3)
  return <>
    <ul className="dt-worker-points">{shown.map((item, index) => <li key={index}>{item}</li>)}</ul>
    {items.length > 3 && <button type="button" className="dt-textlink dt-more" aria-expanded={open} onClick={() => setOpen(!open)}>
      {open ? t('collapse') : t('workersExpandAll', { count: items.length })}</button>}
  </>
}

/** A section block folded to its first three lines when long, with its count in the title; glosses add the principle name. */
function Counted({ block, gloss }: { block?: SectionBlock; gloss?: string }) {
  const { t } = usePanel()
  if (!block) return null
  const items = linesOf(block)
  const notes = [gloss, items.length > 3 ? t('workersCountShown', { count: items.length, shown: 3 }) : undefined]
    .filter(Boolean).join(' · ')
  return <section className="dt-worker-block">
    <h4 className="dt-worker-block-title">{t(BLOCK_LABEL_KEYS[block.id])}{notes && <span className="dt-worker-note">{notes}</span>}</h4>
    {items.length > 3 ? <Points items={items} /> : <div className="dt-worker-body"><MarkdownLite text={block.body} /></div>}
  </section>
}

/** A section block rendered as written, with an optional principle-name gloss in the title. */
function Plain({ block, gloss }: { block?: SectionBlock; gloss?: string }) {
  const { t } = usePanel()
  if (!block) return null
  return <section className="dt-worker-block">
    <h4 className="dt-worker-block-title">{t(BLOCK_LABEL_KEYS[block.id])}{gloss && <span className="dt-worker-note">{gloss}</span>}</h4>
    <div className="dt-worker-body"><MarkdownLite text={block.body} /></div>
  </section>
}

/** The skill's per-revision change rows, folding to the newest five with a link to the full history. */
function History({ rows }: { rows: RevisionRow[] }) {
  const { t, navigate } = usePanel()
  return <div className="dt-worker-history">
    {rows.slice(0, 5).map(row => <div key={row.revision} className="dt-worker-revrow">
      <span className="dt-mono dt-worker-rev">{t('workersRev', { revision: row.revision })}</span>
      <When at={row.savedAt} />
      <span className="dt-worker-changed">{row.changed.map(name => name.replace(/^skill\//, '')).join(t('listSeparator'))}</span>
    </div>)}
    <button type="button" className="dt-textlink dt-more" onClick={() => navigate(settingsRoute('prompts'))}>{t('workersHistoryMore')}</button>
  </div>
}

/** The detail body: three columns covering the definition (duty/boundary, method/memory) and its runtime facts. */
export function WorkerDetail({ id }: { id: string }) {
  const { t, call, navigate } = usePanel()
  const { prompts, tickets, lastGood } = useExperts()
  // The detail also lists recently ended tickets; their poll fails alone without degrading the definition columns.
  const ended = usePoll(async () => (await call('GET tickets', { query: { state: 'ended' } })).items, [])
  const [raw, setRaw] = useState(false)
  const view: PromptsView | undefined = prompts.data
  const text = view?.current.config.skills?.[id]
  if (!view) return <>
    <PageHead title={id} />
    {prompts.error ? <Degraded error={prompts.error} lastGood={lastGood.current} onRetry={() => void prompts.reload()} />
      : <LoadState loading />}
  </>
  if (text === undefined) return <>
    <PageHead title={id} />
    <Hint>{t('workersMissing')}</Hint>
  </>
  const heading = parseHeading(text)
  const { intro, blocks, unknown } = splitSections(text)
  const byId = new Map(blocks.map(block => [block.id, block]))
  const history = skillHistory(view.revisions, id)
  const recent = [...(tickets.data ?? []), ...(ended.data ?? [])]
    .sort((a, b) => (b.updatedAt ?? b.createdAt ?? '').localeCompare(a.updatedAt ?? a.createdAt ?? '')).slice(0, 10)
  const mine = attributed(recent, heading?.name)
  const routing = routingParagraph(view.current.config.scope, id)
  const toolsBlock = byId.get('tools')
  const tools = toolsBlock && parseTools(toolsBlock.body)
  // No H1 heading and no sections at all: the definition is unparseable, so it falls back to its raw text.
  const headingless = !heading && blocks.length === 0 && unknown.length === 0
  const mount = history.at(-1), updated = history[0]
  const short = (item: string) => item.replace(/（[^）]*）/g, '').trim()
  return <>
    <PageHead title={heading?.name || id}>
      {heading?.category && <Tag tone="outline">{heading.category}</Tag>}
      {heading?.duty && <Hint>{heading.duty}</Hint>}
    </PageHead>
    <div className="dt-worker-idmeta">
      <span className="dt-mono">{`${view.skillPrefix}${id}`}</span>
      {mount?.savedAt && <span>{t('workersMounted')} <span className="dt-mono dt-worker-rev">{t('workersRev',
        { revision: mount.revision })}</span> <When at={mount.savedAt} /></span>}
      {updated?.savedAt && updated.revision !== mount?.revision && <span>· {t('workersUpdated')} <span className="dt-mono dt-worker-rev">
        {t('workersRev', { revision: updated.revision })}</span> <When at={updated.savedAt} /></span>}
    </div>
    {headingless ? <>
      <Hint>{t('workersRaw')}</Hint>
      <div className="dt-worker-body"><MarkdownLite text={text} /></div>
    </> : <>
      <div className="dt-worker-detail">
        <div className="dt-worker-col">
          <p className="dt-worker-collabel">{t('workersColDuty')}</p>
          {(intro || heading?.duty) && <section className="dt-worker-block">
            <h4 className="dt-worker-block-title">{t('workersDuty')}</h4>
            <div className="dt-worker-body"><MarkdownLite text={intro || heading!.duty!} /></div>
          </section>}
          <Counted block={byId.get('anti')} />
          {tools ? <section className="dt-worker-block">
            <h4 className="dt-worker-block-title">{t('workersTools')}</h4>
            <div className="dt-worker-tools">
              <div className="dt-worker-toolrow"><span className="dt-worker-toolkey">{t('workersToolsAllow')}</span>
                <span className="dt-worker-chips">{tools.allow.map((item, index) => <span key={index} className="dt-worker-chip"
                  title={item}>{short(item)}</span>)}</span></div>
              <div className="dt-worker-toolrow"><span className="dt-worker-toolkey">{t('workersToolsDeny')}</span>
                <span className="dt-worker-chips">{tools.deny.map((item, index) => <span key={index} className="dt-worker-chip"
                  title={item}>{short(item)}</span>)}</span></div>
            </div>
          </section> : <Plain block={toolsBlock} />}
        </div>
        <div className="dt-worker-col">
          <p className="dt-worker-collabel">{t('workersColMethod')}</p>
          <Plain block={byId.get('voice')} gloss={t('workersVoiceNote')} />
          <Counted block={byId.get('verification')} gloss={t('workersVerificationNote')} />
          <Plain block={byId.get('quiet')} />
          <Plain block={byId.get('memory')} gloss={t('workersMemoryNote')} />
          <Plain block={byId.get('learning')} />
          <Plain block={byId.get('health')} />
          <Plain block={byId.get('onboarding')} />
        </div>
        <div className="dt-worker-col">
          <p className="dt-worker-collabel">{t('workersColRuntime')}</p>
          {routing && <section className="dt-worker-block">
            <h4 className="dt-worker-block-title">{t('workersRouting')}<span className="dt-worker-note">{t('workersRoutingHint')}</span></h4>
            <div className="dt-worker-quote"><MarkdownLite text={routing} /></div>
          </section>}
          {history.length > 0 && <section className="dt-worker-block">
            <h4 className="dt-worker-block-title">{t('workersHistory')}<span className="dt-worker-note">{t('workersHistoryHint')}</span></h4>
            <History rows={history} />
          </section>}
          <section className="dt-worker-block">
            <h4 className="dt-worker-block-title">{t('workersTickets')}<span className="dt-worker-note">{t('workersAttribution')}</span></h4>
            {tickets.error && <Hint>{t('queuePartial')}</Hint>}
            {mine.length
              ? <ul className="dt-worker-ticketlist">{mine.map(ticket => {
                const mark = ticketMark(t, ticket)
                return <li key={ticket.id} className="dt-worker-ticket">
                  <button type="button" className="dt-open dt-open-wrap" onClick={() => navigate({ page: 'execution', id: ticket.id })}
                    title={ticket.title}>{ticket.title}</button>
                  <span className="dt-row-meta"><Tag tone={mark.tone}>{mark.label}</Tag>
                    {ticket.threads[0] && <ThreadChip thread={ticket.threads[0]} />}
                    {ticket.createdAt && <span>{t('workersSince', { time: when(ticket.createdAt, t('lang')) })}</span>}</span>
                </li>
              })}</ul>
              : !tickets.error && <Hint>{t('workersTicketsEmpty', { name: heading?.name || id })}</Hint>}
          </section>
          {unknown.length > 0 && <Hint>{t('workersOtherSections', { count: unknown.length, parts: unknown.join(t('listSeparator')) })}</Hint>}
        </div>
      </div>
      <section className="dt-worker-block">
        <h4 className="dt-worker-block-title">{t('workersRawTitle')}</h4>
        {raw && <div className="dt-pre">{text}</div>}
        <button type="button" className="dt-textlink dt-more" aria-expanded={raw} onClick={() => setRaw(!raw)}>
          {raw ? t('collapse') : t('workersRawToggle')}</button>
      </section>
    </>}
  </>
}
