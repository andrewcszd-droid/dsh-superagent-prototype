/** Queue view: everything not yet dispatched — queued for an Eval, under an Eval, filtered by its Source, ignored, an
 * unavailable Eval, and a Ticket with undelivered Inputs — plus what workers raised: Tickets waiting for a person and
 * handed-back Triggers. Each category reuses the same helpers as the Trigger, Eval, Overview, and Execution views, so its
 * rows and counts reconcile with those pages. */
import { ticketStage, threadKey, type Decision, type Thread, type Trigger } from '../../core/index.ts'
import type { Store } from '../store.ts'
import { awaitingEval, dayAgo, ownersOf, snapshot, threadSummary, triggerView, type ViewHost } from './records.ts'
import { unjudged } from './overview.ts'
import { ticketRow } from './tickets.ts'

export type QueueOwners = { store: Store; owners: ReturnType<typeof ownersOf> }
/** Ignore Decisions that still hold their Thread: not dismissed, the Thread's latest, and none of their own Triggers back in the domain. */
function ignored(store: Store, queue: QueueOwners): { thread: Thread; decision: Decision }[] {
  return store.read.decisionsOfKinds(['ignore'], 100).flatMap(decision => {
    if (decision.dismissed) return []
    const thread = store.threads.get(decision.threadKey)
    // Only the Decision's own Triggers re-entering the domain make it stale; others of the Thread may still wait for an Eval.
    if (!thread || thread.evaluating?.triggerIds.some(id => decision.triggerIds.includes(id))
      || decision.triggerIds.some(id => thread.pending.includes(id))) return []
    if (store.decisions.byThread(thread.key).at(-1)?.id !== decision.id) return []
    return [{ thread, decision }]
  })
}
/**
 * Builds the operator's dispatch queue. `Evaluate again` applies to a Trigger that no Eval holds, which no category here
 * but `queued` and `evaluating` is; `unavailable` keeps the Overview's 24-hour window, so the two pages show the same list.
 */
export function queueView(host: ViewHost, policyVersionValue: string) {
  const view = snapshot(host)
  const { store } = view
  const queue = { store, owners: ownersOf(store) }
  const byId = (id: string) => store.triggers.get(id)
  // One row with its Thread's summary, so the panel can title it with a readable name and link to the original thread;
  // the summary is absent when the Thread no longer exists, and the client falls back to the raw key.
  const row = (item: Trigger, thread?: Thread) => {
    const found = thread ?? store.threads.get(item.threads[0] ? threadKey(item.threads[0]) : '')
    return { ...triggerView(view, item, thread ? store.decisions.byThread(thread.key) : undefined),
      ...found ? { thread: threadSummary(view, found) } : {} }
  }
  const rows = (thread: Thread, ids: string[]) => ids.map(byId).filter(item => item !== undefined).map(item => row(item, thread))
  const decided = (entries: { thread: Thread; decision: Decision }[]) =>
    entries.flatMap(({ thread, decision }) => rows(thread, decision.triggerIds))
  return {
    policyVersion: policyVersionValue,
    queued: store.threads.active().flatMap(thread => rows(thread, awaitingEval(queue, thread))),
    evaluating: store.threads.active().filter(thread => thread.evaluating).map(thread => ({ thread: threadSummary(view, thread),
      items: rows(thread, thread.evaluating!.triggerIds) })),
    filtered: store.read.triggers({ filtered: true }, 0, 50).items.map(item => row(item)),
    ignore: decided(ignored(store, queue)),
    unavailable: decided(unjudged(store, dayAgo())),
    undelivered: store.tickets.open().filter(ticket => ticket.undelivered.length > 0).map(ticket => ticketRow(view, ticket)),
    raised: {
      person: store.tickets.open().filter(ticket => ticketStage(ticket).stage === 'person').map(ticket => ticketRow(view, ticket)),
      handbacks: store.read.handbacks(50).flatMap(({ trigger: handed, ticketId, reason, at }) => {
        const trigger = byId(handed.id)
        return trigger ? [{ ...row(trigger), handback: { ticketId, title: store.tickets.get(ticketId)?.title ?? ticketId,
          reason, at } }] : []
      }),
    },
  }
}
export type QueueView = ReturnType<typeof queueView>
