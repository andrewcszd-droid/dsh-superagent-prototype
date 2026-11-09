// @vitest-environment jsdom
// The Pending tab.
import { expect, it } from 'vitest'
import type { QueueFilter } from '../src/client/api.ts'
import { zh } from '../src/client/locales.ts'
import { usePanel, mount, all, find, tab, click, text } from './fixtures/panel.tsx'
import { server, threadSummary, ticketSummary, trigger } from './fixtures/panel-server.ts'

usePanel()
const pill = (kind: QueueFilter) => all('.dt-pill').find(item => item.textContent?.includes(zh[`queueFilter.${kind}`]))!
const open = async () => { await click(zh['tab.queue']) }

it('opens on the queued Triggers, one row with its Thread, actor, and kind, and a count on each filter', async () => {
  await mount()
  await open()
  expect(tab(zh['tab.queue']).getAttribute('aria-selected')).toBe('true')
  expect(pill('queued').getAttribute('aria-pressed')).toBe('true')
  expect(pill('queued').textContent).toBe(`${zh['queueFilter.queued']} 1`)
  expect(text()).toContain('feishu:oc_1:om_root')
  expect(text()).toContain('message e5')
  expect(all('.dt-row-buttons').map(row => row.textContent)).toEqual([])
})

it('shows an empty kind by its empty state', async () => {
  await mount()
  await open()
  await click(pill('evaluating'))
  expect(text()).toContain(zh.queueNone)
  expect(tab(zh['tab.queue']).getAttribute('aria-selected')).toBe('true')
})

it('sends a filtered Trigger to an Eval again after confirming', async () => {
  server.queue = { ...server.queue, queued: [], filtered: [trigger('e4', '2026-09-23T00:01:00Z',
    { disposition: { filtered: { code: 'not_a_member' } } })] }
  await mount()
  await open()
  await click(pill('filtered'))
  expect(text()).toContain(zh['reason.not_a_member'])
  await click(zh.requeue)
  await click(zh.confirm)
  expect(server.requests.some(request => request.path === 'triggers/e4/requeue' && request.method === 'POST')).toBe(true)
})

it('dismisses an unavailable Eval from its row, and links its decision Ticket', async () => {
  server.queue = { ...server.queue, queued: [], unavailable: [{ ...trigger('e3', '2026-09-23T00:00:00Z',
    { disposition: { decision: { id: 'd9', outcome: 'unavailable' as const, reason: [{ code: 'timeout' }], ticketId: 't1' } } }),
    thread: threadSummary() }] }
  await mount()
  await open()
  await click(pill('unavailable'))
  await click(zh.dismiss)
  await click(zh.confirm)
  expect(server.requests.some(request => request.path === 'decisions/d9/dismiss' && request.method === 'POST')).toBe(true)
})

it('lists undelivered Inputs as Tickets, and what workers raised below the filters', async () => {
  const undelivered = ticketSummary({ id: 't9', undelivered: 2 }, { stage: 'person', action: 'delivery' })
  server.queue = { ...server.queue, queued: [], undelivered: [undelivered],
    raised: { person: [server.person[0]!], handbacks: [{ ...trigger('e7', '2026-09-23T00:05:00Z'),
      handback: { ticketId: 't1', title: '修复回归', reason: 'Beyond the ticket', at: '2026-09-23T00:06:00Z' } }] } }
  await mount()
  await open()
  await click(pill('undelivered'))
  expect(text()).toContain(zh.ticketUndeliveredLabel)
  expect(text()).toContain(zh.queueRaised)
  expect(text()).toContain('message e7')
  expect(text()).toContain('需要确认按钮颜色')
})

it('reads a host that answers without a kind as partial data, and shows the Policy version', async () => {
  const { filtered, ...rest } = server.queue
  server.queue = { ...rest } as typeof server.queue
  await mount()
  await open()
  await click(pill('filtered'))
  expect(text()).toContain(zh.queuePartial)
  expect(text()).toContain('abcdef1234567890')
})
