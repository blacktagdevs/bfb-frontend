import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from '../../App'
import { useToastStore } from '../../components/feedback'
import { ACCESS_TOKEN_KEY, clearStoredSession, REFRESH_TOKEN_KEY } from '../../lib/auth/tokens'
import { useSessionStore } from '../../stores/session'
import { apiErrorBody, mockApi } from '../../test/mockApi'
import { activationEvent, EXCHANGE, EXCHANGE_ID, exchangeDetail, exchangeSummary, proposalServer, STUDIO_ID, type ProposalServerOptions } from '../../test/proposalServer'
import { historyActor, historyTitle, humanizeCode, MILESTONE_STATUS_LABELS, nextStepText, progressPercent, progressText } from './exchangeCopy'
import type { Exchange, ExchangeMilestone } from './exchangesApi'

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
}

let api: ReturnType<typeof mockApi> | undefined

function start(options: ProposalServerOptions = {}) {
  api = mockApi(proposalServer(options))
  return api
}

beforeEach(() => {
  localStorage.clear()
  clearStoredSession()
  useSessionStore.setState({ status: 'idle', endReason: null })
  useToastStore.setState({ toasts: [] })
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  localStorage.setItem(ACCESS_TOKEN_KEY, 'stale-access')
  localStorage.setItem(REFRESH_TOKEN_KEY, 'refresh-1')
})

afterEach(() => {
  cleanup()
  api?.restore()
  api = undefined
  vi.restoreAllMocks()
})

const HISTORY = `${EXCHANGE}/history`
const names = { mine: 'Northstar Digital', other: 'Northside Studio' }

/** The default exchange with its milestones changed: 1 and 3 are Northstar's, 2 is Northside's. */
function withMilestones(changes: Array<Partial<ExchangeMilestone>>, overrides: Partial<Exchange> = {}): Exchange {
  const base = exchangeDetail()
  return { ...base, ...overrides, milestones: base.milestones.map((milestone, at) => ({ ...milestone, ...changes[at] })) }
}

function submittedEvent(overrides: Parameters<typeof activationEvent>[0] = {}) {
  return activationEvent({
    id: 'event-submitted',
    milestone_id: 'milestone-1',
    type: 'milestone.submitted',
    actor_type: 'business',
    actor_user_id: 'user-1',
    actor_user_name: 'Alex Morgan',
    actor_business_id: 'business-1',
    actor_side: 'a',
    from_status: 'pending',
    to_status: 'submitted',
    metadata: { number: 1, is_revision: false, revision_number: null, beyond_revision_limit: false },
    occurred_at: '2026-12-01T10:00:00Z',
    ...overrides,
  })
}

describe('exchange workspace copy', () => {
  it('labels every milestone status', () => {
    expect(MILESTONE_STATUS_LABELS).toEqual({ pending: 'Not started', submitted: 'Submitted', changes_requested: 'Changes requested', accepted: 'Accepted' })
  })

  it('says how far the exchange has got', () => {
    expect(progressText(1, 3)).toBe('1 of 3 milestones accepted')
    expect(progressText(0, 1)).toBe('0 of 1 milestone accepted')
    expect(progressPercent(1, 3)).toBe(33)
    expect(progressPercent(0, 0)).toBe(0)
  })

  it('says the next step for your business, most urgent first', () => {
    const next = (exchange: Exchange, canReview = true) => nextStepText(exchange, 'business-1', names, { canReview })
    expect(next(exchangeDetail())).toBe('Deliver “Logo concepts” by 18 Jan 2027.')
    expect(next(withMilestones([{ status: 'changes_requested' }]))).toBe('Resubmit “Logo concepts”: Northside Studio asked for changes.')
    const toReview = withMilestones([{}, { status: 'submitted', review_due_at: '2027-02-15T10:00:00Z' }])
    expect(next(toReview)).toBe('Review “First monthly reconciliation” from Northside Studio by 15 Feb 2027: accept it or ask for changes.')
    expect(next(toReview, false)).toMatch(/ask for changes\. An owner or administrator of Northstar Digital does this\.$/)
    expect(next(withMilestones([{ status: 'submitted', review_due_at: '2027-01-23T10:00:00Z' }, {}, { status: 'accepted' }]))).toBe('Nothing for you to do now. Northside Studio needs to review “Logo concepts”, due by 23 Jan 2027.')
    expect(next(withMilestones([{ status: 'accepted' }, {}, { status: 'accepted' }]))).toBe('Nothing for you to do now. Northside Studio delivers “First monthly reconciliation” next, due 10 Feb 2027.')
    expect(next(withMilestones([{ status: 'accepted' }, { status: 'accepted' }, { status: 'accepted' }]))).toBe('Every milestone is accepted. Mark the exchange complete; Northside Studio then confirms it.')
    expect(next(exchangeDetail({ status: 'completed' }))).toBe('The exchange is complete. There is nothing more to do.')
  })

  it('describes history entries, including ones by BFB itself and types it does not know', () => {
    expect(historyTitle(activationEvent(), 2)).toBe('Exchange started: both businesses signed the agreement')
    expect(historyActor(activationEvent(), 'business-1', names)).toBe('BFB')
    expect(historyTitle(submittedEvent(), 2)).toBe('Delivery submitted')
    expect(historyActor(submittedEvent(), 'business-1', names)).toBe('Alex Morgan (Northstar Digital)')
    expect(historyActor(submittedEvent({ actor_business_id: STUDIO_ID, actor_user_name: null }), 'business-1', names)).toBe('A former team member (Northside Studio)')
    expect(historyTitle(submittedEvent({ metadata: { is_revision: true, revision_number: 3, beyond_revision_limit: true } }), 2)).toBe('Revision 3 submitted (beyond the 2 agreed)')
    expect(historyTitle(submittedEvent({ type: 'milestone.deemed_accepted', actor_type: 'system' }), 2)).toBe('Treated as accepted under the agreement’s terms: no decision came within 5 business days of the reminder')
    expect(historyTitle(submittedEvent({ type: 'milestone.reminder_sent', from_status: null, to_status: null }), 2)).toBe('Reminder sent')
    expect(historyTitle(submittedEvent({ type: 'exchange.cancellation_noticed', milestone_id: null, from_status: 'active', to_status: 'cancelled' }), 2)).toBe('Cancellation noticed: Active to Cancelled')
    expect(historyActor(submittedEvent({ actor_type: 'staff', actor_user_name: 'Sam Lee' }), 'business-1', names)).toBe('Sam Lee, BFB staff')
    expect(humanizeCode('dispute.opened')).toBe('Opened')
  })
})

describe('exchange workspace', () => {
  it('shows what each business provides, yours first, with values and the cash adjustment', async () => {
    start()
    renderAt(`/exchanges/${EXCHANGE_ID}`)

    const provides = await screen.findByRole('region', { name: 'What each business provides' })
    const sides = within(provides).getAllByRole('group')
    expect(sides[0]).toHaveAccessibleName('Northstar Digital provides')
    expect(sides[0]).toHaveTextContent('Brand identity sprint')
    expect(sides[0]).toHaveTextContent('$3,000')
    expect(sides[0]).toHaveTextContent('Logo suite')
    expect(sides[0]).toHaveTextContent('Not included')
    expect(sides[0]).toHaveTextContent('Printing')
    expect(sides[1]).toHaveAccessibleName('Northside Studio provides')
    expect(sides[1]).toHaveTextContent('Monthly bookkeeping')
    expect(sides[1]).toHaveTextContent('Total value$2,700')
    expect(provides).toHaveTextContent('Cash adjustment: Northside Studio pays Northstar Digital $300 when the work is complete.')

    const status = screen.getByRole('region', { name: 'Status' })
    expect(within(status).getByText('Review period').nextSibling).toHaveTextContent('5 days')
    expect(within(status).getByText('Revisions').nextSibling).toHaveTextContent('Up to 2')
    expect(within(status).getByText('Cancellation').nextSibling).toHaveTextContent('14 days’ notice')
  })

  it('says when no cash changes hands', async () => {
    start({ exchange: exchangeDetail({ cash_adjustment: null }) })
    renderAt(`/exchanges/${EXCHANGE_ID}`)
    const provides = await screen.findByRole('region', { name: 'What each business provides' })
    expect(provides).toHaveTextContent('No cash changes hands.')
  })

  it('shows every milestone status, the progress and the next step', async () => {
    start({
      exchange: withMilestones(
        [{ status: 'submitted', review_due_at: '2027-01-23T10:00:00Z' }, { status: 'changes_requested' }, { status: 'accepted' }],
        { milestones_accepted: 1 },
      ),
    })
    renderAt(`/exchanges/${EXCHANGE_ID}`)

    const milestones = within(await screen.findByRole('list', { name: 'Milestones' })).getAllByRole('listitem')
    expect(milestones[0]).toHaveTextContent('Submitted')
    expect(milestones[0]).toHaveTextContent('Northside Studio reviews it by 23 Jan 2027.')
    expect(milestones[1]).toHaveTextContent('Changes requested')
    expect(milestones[2]).toHaveTextContent('Accepted')
    const standing = screen.getByRole('region', { name: 'Where it stands' })
    expect(standing).toHaveTextContent('1 of 3 milestones accepted.')
    expect(within(standing).getByRole('progressbar', { name: 'Milestones accepted' })).toHaveAttribute('aria-valuenow', '1')
    expect(standing).toHaveTextContent('Next step for Northstar Digital: Nothing for you to do now. Northside Studio needs to review “Logo concepts”, due by 23 Jan 2027.')
    expect(within(screen.getByRole('region', { name: 'Status' })).getByText('Progress').nextSibling).toHaveTextContent('1 of 3 milestones accepted')

    cleanup()
    api?.restore()
    start({ exchange: withMilestones([{}, {}, {}]) })
    renderAt(`/exchanges/${EXCHANGE_ID}`)
    expect(within(await screen.findByRole('list', { name: 'Milestones' })).getAllByText('Not started')).toHaveLength(3)
  })

  it('tells a member who reviews', async () => {
    start({ role: 'member', exchange: withMilestones([{}, { status: 'submitted', review_due_at: '2027-02-15T10:00:00Z' }]) })
    renderAt(`/exchanges/${EXCHANGE_ID}`)
    const standing = await screen.findByRole('region', { name: 'Where it stands' })
    expect(standing).toHaveTextContent('An owner or administrator of Northstar Digital does this.')
    const milestones = within(screen.getByRole('list', { name: 'Milestones' })).getAllByRole('listitem')
    expect(milestones[1]).toHaveTextContent('Review it by 15 Feb 2027.')
  })

  it('lists the history newest first, with who did it, when and the milestone', async () => {
    let page = 0
    start({
      history: [submittedEvent(), activationEvent()],
      reply: ({ method, url, config }) => {
        if (method !== 'get' || url !== HISTORY) return undefined
        page += 1
        const cursor = (config.params as { cursor?: string }).cursor
        if (!cursor) return { status: 200, data: { items: [submittedEvent(), submittedEvent({ id: 'event-unknown', type: 'milestone.reminder_sent', from_status: null, to_status: null, actor_user_name: 'Alex Morgan', occurred_at: '2026-12-02T10:00:00Z' })], next_cursor: 'next-1' } }
        return { status: 200, data: { items: [activationEvent()], next_cursor: null } }
      },
    })
    renderAt(`/exchanges/${EXCHANGE_ID}`)

    const history = await screen.findByRole('list', { name: 'Exchange history' })
    let entries = within(history).getAllByRole('listitem')
    expect(entries).toHaveLength(2)
    expect(entries[0]).toHaveTextContent('Delivery submitted')
    expect(entries[0]).toHaveTextContent('Milestone 1 · Logo concepts')
    expect(entries[0]).toHaveTextContent(/Alex Morgan \(Northstar Digital\) · 1 Dec, \d\d:\d\d/)
    expect(entries[1]).toHaveTextContent('Reminder sent')

    fireEvent.click(screen.getByRole('button', { name: 'Show earlier history' }))
    await waitFor(() => expect(within(history).getAllByRole('listitem')).toHaveLength(3))
    entries = within(history).getAllByRole('listitem')
    expect(entries[2]).toHaveTextContent('Exchange started: both businesses signed the agreement')
    expect(entries[2]).toHaveTextContent(/^.*BFB · 20 Nov/)
    expect(entries[2]).not.toHaveTextContent('Milestone')
    expect(screen.queryByRole('button', { name: 'Show earlier history' })).not.toBeInTheDocument()
    expect(page).toBe(2)
    expect((api!.calls('get', HISTORY)[1][0].params as { cursor: string }).cursor).toBe('next-1')
  })

  it('explains an empty history and retries a failed one', async () => {
    start({ history: [] })
    renderAt(`/exchanges/${EXCHANGE_ID}`)
    expect(await screen.findByText('Nothing has happened in this exchange yet.')).toBeInTheDocument()
    cleanup()
    api?.restore()

    let fail = true
    start({ reply: ({ method, url }) => (method === 'get' && url === HISTORY && fail ? { status: 500, data: apiErrorBody('internal_error') } : undefined) })
    renderAt(`/exchanges/${EXCHANGE_ID}`)
    expect(await screen.findByText(/We couldn’t load the history/)).toBeInTheDocument()
    // The rest of the workspace still shows.
    expect(screen.getByRole('list', { name: 'Milestones' })).toBeInTheDocument()
    fail = false
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Exchange started: both businesses signed the agreement')).toBeInTheDocument()
  })
})

describe('exchange progress on cards and the dashboard', () => {
  it('fills the progress bars from accepted milestones', async () => {
    start({ exchanges: [exchangeSummary({ milestones_accepted: 1 })] })
    renderAt('/exchanges')
    const card = within(await screen.findByRole('list', { name: 'Active exchanges' })).getAllByRole('listitem')[0]
    expect(card).toHaveTextContent('3 milestones, 1 accepted')
    const bar = within(card).getByRole('progressbar', { name: 'Milestones accepted' })
    expect(bar).toHaveAttribute('aria-valuetext', '1 of 3 milestones accepted')
    expect(bar.querySelector('span')).toHaveStyle({ width: '33%' })
    cleanup()

    renderAt('/dashboard')
    const row = within(await screen.findByRole('list', { name: 'Active exchanges' })).getAllByRole('listitem')[0]
    expect(row).toHaveTextContent('1 of 3 milestones accepted · active since 20 Nov')
    const dashboardBar = within(row).getByRole('progressbar', { name: 'Milestones accepted' })
    expect(dashboardBar).toHaveAttribute('aria-valuenow', '1')
    expect(dashboardBar.querySelector('span')).toHaveStyle({ width: '33%' })
  })
})
