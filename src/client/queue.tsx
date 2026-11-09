/** Pending-dispatch page: Triggers and Tickets not yet dispatched, grouped by what holds each, plus what workers raised. */
import { QUEUE_FILTERS, usePoll, type QueueFilter, type QueueView } from './api.ts'
import { Pill, Tag } from './controls.tsx'
import { decisionMark } from './marks.ts'
import { usePanel } from './provider.tsx'
import { TicketLine } from './rows.tsx'
import { actorName, readableMarkers, reasonLabel } from './text.ts'
import { ClampText, ConfirmButton, Hint, LabelValue, LoadState, Section, StatusHead, When } from './widgets.tsx'

type TriggerRowOf = QueueView['ignore'][number]
type TicketRowOf = QueueView['undelivered'][number]
type Handback = QueueView['raised']['handbacks'][number]['handback']
/** One waiting Trigger of the queue, however the host view carried it in. */
type QueueRow = Pick<TriggerRowOf, 'id' | 'at' | 'actor' | 'text' | 'preview' | 'threads' | 'disposition'> & { handback?: Handback }
/** The kind's trigger rows, or undefined when the host answers without it (an older bundle): that filter reads as partial data. */
const triggersOf = (view: QueueView, kind: QueueFilter): QueueRow[] | undefined => {
  const value = kind === 'queued' ? view.queued : kind === 'filtered' ? view.filtered
    : kind === 'ignore' ? view.ignore : kind === 'unavailable' ? view.unavailable : undefined
  return Array.isArray(value) ? value : undefined
}
const countOf = (view: QueueView | undefined, kind: QueueFilter): number => {
  if (!view) return 0
  if (kind === 'undelivered') return Array.isArray(view.undelivered) ? view.undelivered.length : 0
  if (kind === 'evaluating') return Array.isArray(view.evaluating)
    ? view.evaluating.reduce((sum, group) => sum + group.items.length, 0) : 0
  return triggersOf(view, kind)?.length ?? 0
}
/** One waiting Trigger: who raised what, why it waits, and where it lives, with the actions its kind allows. */
function QueueTrigger({ row, kind, onChanged }: {
  row: QueueRow; kind: QueueFilter; onChanged: () => Promise<void>
}) {
  const { t, call, navigate } = usePanel()
  const held = kind === 'queued' || kind === 'evaluating'
  const decision = row.disposition.decision
  const thread = row.threads[0]
  const ticketId = decision?.ticketId
  const dismissId = kind === 'unavailable' ? decision?.id : undefined
  const reason = row.disposition.filtered ? reasonLabel(t, row.disposition.filtered)
    : decision && (decision.outcome === 'unavailable' || decision.outcome === 'ignore') ? reasonLabel(t, decision.reason) : undefined
  const { tone, label } = decision ? decisionMark(t, decision.outcome)
    : { tone: 'neutral' as const, label: t(`queueFilter.${kind}`) }
  return <li className="dt-row dt-link">
    <div className="dt-row-main">
      <div className="dt-row-meta dt-ticket-meta">
        <button type="button" className="dt-open dt-open-wrap" onClick={() => navigate(thread
          ? { page: 'trigger', id: thread, query: { trigger: row.id } } : { page: 'queue', query: { filter: kind } })}>
          {thread ?? row.id}</button>
        <strong>{actorName(t, row.actor)}</strong>
        <When at={row.at} />
        <Tag tone={tone}>{label}</Tag>
        {ticketId && <button type="button" className="dt-textlink" onClick={() => navigate({ page: 'execution',
          id: ticketId })}>{t('openTicket')}</button>}
      </div>
      <ClampText text={readableMarkers(t, row.text || row.preview)} />
      {reason && <Hint>{reason}</Hint>}
      {row.handback && <Hint>{t('handedBack', { ticket: row.handback.title, reason: row.handback.reason })}</Hint>}
      {!held && <div className="dt-row-meta dt-row-buttons">
        <ConfirmButton variant="outline" icon="refresh" label={t('requeue')} title={t('requeue')} message={t('queueRequeueConfirm')}
          onConfirm={async () => { await call('POST triggers/:id/requeue', { id: row.id }) }} />
        {dismissId && <ConfirmButton variant="outline" icon="dismiss" label={t('dismiss')}
          title={t('dismiss')} message={t('queueDismissConfirm')}
          onConfirm={async () => { await call('POST decisions/:id/dismiss', { id: dismissId }) }} />}
      </div>}
    </div>
  </li>
}
/** The body of one filter: its Trigger kinds as rows, `evaluating` by its holding Thread, `undelivered` as Tickets. */
function QueueList({ view, kind, onChanged }: { view: QueueView; kind: QueueFilter; onChanged: () => Promise<void> }) {
  const { t } = usePanel()
  if (kind === 'undelivered') {
    const tickets = Array.isArray(view.undelivered) ? view.undelivered as TicketRowOf[] : undefined
    if (!tickets) return <Hint>{t('queuePartial')}</Hint>
    if (!tickets.length) return <Hint>{t('queueNone')}</Hint>
    return <ul className="dt-list dt-cards">{tickets.map(ticket => <TicketLine key={ticket.id} ticket={ticket}
      onChanged={onChanged} />)}</ul>
  }
  if (kind === 'evaluating') {
    const groups = Array.isArray(view.evaluating) ? view.evaluating : undefined
    if (!groups) return <Hint>{t('queuePartial')}</Hint>
    if (!groups.length) return <Hint>{t('queueNone')}</Hint>
    return <ul className="dt-list">{groups.flatMap(group => group.items.map(row => <QueueTrigger key={row.id} row={row}
      kind={kind} onChanged={onChanged} />))}</ul>
  }
  const rows = triggersOf(view, kind)
  if (!rows) return <Hint>{t('queuePartial')}</Hint>
  if (!rows.length) return <Hint>{t('queueNone')}</Hint>
  return <ul className="dt-list">{rows.map(row => <QueueTrigger key={row.id} row={row} kind={kind} onChanged={onChanged} />)}</ul>
}
/** The Tickets waiting for a person and the Triggers workers handed back, below the dispatch filters. */
function Raised({ view, onChanged }: { view: QueueView; onChanged: () => Promise<void> }) {
  const { t } = usePanel()
  const person = Array.isArray(view.raised?.person) ? view.raised.person as TicketRowOf[] : []
  const handbacks = Array.isArray(view.raised?.handbacks) ? view.raised.handbacks as QueueRow[] : []
  if (!person.length && !handbacks.length) return <Hint>{t('none')}</Hint>
  return <>
    {handbacks.length > 0 && <ul className="dt-list">{handbacks.map(row => <QueueTrigger key={row.id} row={row} kind="queued"
      onChanged={onChanged} />)}</ul>}
    {person.length > 0 && <ul className="dt-list dt-cards">{person.map(ticket => ticket.stage === 'person'
      ? <TicketLine key={ticket.id} ticket={ticket} question onChanged={onChanged} /> : <TicketLine key={ticket.id} ticket={ticket} />)}</ul>}
  </>
}
export function QueuePage({ filter: current }: { filter: QueueFilter }) {
  const { t, call, navigate } = usePanel()
  const { data, error, reload } = usePoll(() => call('GET queue'), [])
  const go = (next: QueueFilter) => navigate({ page: 'queue', query: next === 'queued' ? {} : { filter: next } }, true)
  return <>
    <StatusHead hint={t('queueIntro')} />
    {data?.policyVersion && <div className="dt-row-meta"><LabelValue label={t('policyVersion')}
      value={<span className="dt-mono">{data.policyVersion}</span>} /></div>}
    <div className="dt-filters">
      {QUEUE_FILTERS.map(kind => <Pill key={kind} active={current === kind} onClick={() => go(kind)}>
        {t(`queueFilter.${kind}`)} {countOf(data, kind)}</Pill>)}
    </div>
    <LoadState error={error} loading={!data} />
    {data && <QueueList view={data} kind={current} onChanged={reload} />}
    {data?.raised && <Section title={t('queueRaised')} hint={t('queueRaisedHint')}
      count={(Array.isArray(data.raised.person) ? data.raised.person.length : 0)
        + (Array.isArray(data.raised.handbacks) ? data.raised.handbacks.length : 0)}>
      <Raised view={data} onChanged={reload} />
    </Section>}
  </>
}
