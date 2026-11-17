import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from '../../App'
import { useToastStore } from '../../components/feedback'
import { ACCESS_TOKEN_KEY, clearStoredSession, REFRESH_TOKEN_KEY } from '../../lib/auth/tokens'
import { useSessionStore } from '../../stores/session'
import { apiErrorBody, mockApi, type MockRequest } from '../../test/mockApi'
import { activationEvent, EXCHANGE, EXCHANGE_ID, EXCHANGES, exchangeDetail, exchangeSummary, proposalServer, studio, STUDIO_ID, type ProposalServerOptions } from '../../test/proposalServer'
import { historyActor, historyTitle, noticeEffectiveAt } from './exchangeCopy'
import type { CancellationNotice, Dispute, Exchange } from './exchangesApi'

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

const CANCELLATION = `${EXCHANGE}/cancellation`
const DISPUTES = `${EXCHANGE}/disputes`

function notice(overrides: Partial<CancellationNotice> = {}): CancellationNotice {
  return {
    id: 'notice-1',
    exchange_id: EXCHANGE_ID,
    status: 'pending',
    given_by_business_id: 'business-1',
    given_by_side: 'a',
    given_by_user_id: 'user-1',
    given_by_user_name: 'Alex Morgan',
    reason: 'We are closing our second location.',
    notice_days: 14,
    given_at: '2027-01-10T09:00:00Z',
    effective_at: '2027-01-24T09:00:00Z',
    ended_at: null,
    ...overrides,
  }
}

const theirNotice = () => notice({ given_by_business_id: STUDIO_ID, given_by_side: 'b', given_by_user_id: 'user-9', given_by_user_name: 'Dana Studio' })

function dispute(overrides: Partial<Dispute> = {}): Dispute {
  return {
    id: 'dispute-1',
    exchange_id: EXCHANGE_ID,
    status: 'open',
    category: 'missed_deadline',
    description: 'The reconciliation was due on 10 February.',
    milestone_ids: ['milestone-2'],
    opened_by_business_id: 'business-1',
    opened_by_side: 'a',
    opened_by_user_id: 'user-1',
    opened_by_user_name: 'Alex Morgan',
    opened_at: '2027-02-12T09:00:00Z',
    response: null,
    responded_by_business_id: null,
    responded_by_user_id: null,
    responded_by_user_name: null,
    responded_at: null,
    closed_at: null,
    closed_by: null,
    resolution: null,
    resolution_note: null,
    ...overrides,
  }
}

const theirDispute = (overrides: Partial<Dispute> = {}) =>
  dispute({ opened_by_business_id: STUDIO_ID, opened_by_side: 'b', opened_by_user_id: 'user-9', opened_by_user_name: 'Dana Studio', ...overrides })

const withNotice = (value: CancellationNotice | null, overrides: Partial<Exchange> = {}) => exchangeDetail({ cancellation_notice: value, open_dispute: null, ...overrides })
const withDispute = (value: Dispute | null, overrides: Partial<Exchange> = {}) => exchangeDetail({ cancellation_notice: null, open_dispute: value, ...overrides })

const sideCard = () => screen.getByRole('region', { name: 'If something goes wrong' })
const noticePanel = () => screen.getByRole('region', { name: 'Notice to cancel' })
const disputePanel = () => screen.getByRole('region', { name: 'Dispute open' })
const loaded = () => screen.findByRole('list', { name: 'Milestones' })

describe('cancellation and dispute copy', () => {
  it('names the new history entries, and hides staff names from businesses', () => {
    const entry = (type: string, metadata: Record<string, unknown> = {}, actor: 'business' | 'staff' | 'system' = 'business') =>
      activationEvent({ type, metadata, actor_type: actor, to_status: null, actor_user_name: actor === 'staff' ? 'Sam Lee' : 'Alex Morgan', actor_business_id: actor === 'business' ? 'business-1' : null })
    expect(historyTitle(entry('exchange.cancellation_noticed', { notice_days: 14, effective_at: '2027-01-24T09:00:00Z' }), 2)).toBe('Notice to cancel given: the exchange is cancelled on 24 Jan 2027 unless it’s withdrawn')
    expect(historyTitle(entry('exchange.cancellation_noticed', { notice_days: 0, effective_at: '2027-01-24T09:00:00Z' }), 2)).toBe('Notice to cancel given')
    expect(historyTitle(entry('exchange.cancellation_withdrawn'), 2)).toBe('Cancellation notice withdrawn')
    expect(historyTitle(entry('exchange.cancelled', { how: 'notice' }, 'system'), 2)).toBe('Exchange cancelled: the notice period ended')
    expect(historyTitle(entry('exchange.cancelled', { how: 'agreed' }), 2)).toBe('Exchange cancelled: both businesses agreed to cancel now')
    expect(historyTitle(entry('dispute.opened', { category: 'quality' }), 2)).toBe('Dispute opened: the quality of the work')
    expect(historyTitle(entry('dispute.opened', { category: 'late_payment' }), 2)).toBe('Dispute opened: late payment')
    expect(historyTitle(entry('dispute.responded'), 2)).toBe('Response to the dispute added')
    expect(historyTitle(entry('dispute.withdrawn'), 2)).toBe('Dispute withdrawn')
    expect(historyTitle(entry('dispute.closed', { resolution: 'mediation' }, 'staff'), 2)).toBe('Dispute closed by BFB staff: resolved through mediation')
    expect(historyActor(entry('dispute.closed', {}, 'staff'), 'business-1', { mine: 'A', other: 'B' })).toBe('BFB staff')
    expect(noticeEffectiveAt(14, new Date('2027-01-10T09:00:00Z')).toISOString()).toBe('2027-01-24T09:00:00.000Z')
  })
})

describe('cancelling an exchange', () => {
  it('gives notice with a reason and the date it takes effect', async () => {
    let exchange = withNotice(null)
    start({
      reply: ({ method, url, body }: MockRequest) => {
        if (method === 'get' && url === EXCHANGE) return { status: 200, data: exchange }
        if (method === 'post' && url === CANCELLATION) {
          const given = notice({ reason: (body as { reason: string }).reason })
          exchange = withNotice(given)
          return { status: 201, data: given }
        }
        return undefined
      },
    })
    renderAt(`/exchanges/${EXCHANGE_ID}`)
    await loaded()
    expect(sideCard()).toHaveTextContent('Either business can cancel for any reason with 14 days’ notice (Exchange Terms 13.1).')
    fireEvent.click(within(sideCard()).getByRole('button', { name: 'Cancel exchange' }))
    const dialog = screen.getByRole('dialog', { name: 'Give notice to cancel the exchange with Northside Studio?' })
    expect(dialog).toHaveTextContent('The agreement asks for 14 days’ notice, so if you give it now the exchange is cancelled on')
    expect(within(dialog).getByLabelText(/Why are you cancelling/)).toHaveFocus()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Give notice' }))
    expect(await within(dialog).findByText('Say why you’re cancelling.')).toBeInTheDocument()
    expect(api!.calls('post', CANCELLATION)).toHaveLength(0)

    fireEvent.change(within(dialog).getByLabelText(/Why are you cancelling/), { target: { value: '  We are closing our second location.  ' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Give notice' }))
    expect(await screen.findByText('Notice given. The exchange is cancelled on 24 Jan 2027 unless you withdraw it, or sooner if Northside Studio agrees.')).toBeInTheDocument()
    expect(api!.calls('post', CANCELLATION)[0][0].data).toBe(JSON.stringify({ reason: 'We are closing our second location.' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await waitFor(() => expect(noticePanel()).toHaveTextContent('Alex Morgan (Northstar Digital) gave notice to cancel the exchange on'))
    expect(noticePanel()).toHaveTextContent('We are closing our second location.')
    expect(noticePanel()).toHaveTextContent('Northstar Digital can withdraw the notice until then.')
    expect(within(noticePanel()).getByRole('button', { name: 'Withdraw notice' })).toBeInTheDocument()
    expect(within(noticePanel()).queryByRole('button', { name: 'Agree to cancel now' })).not.toBeInTheDocument()
    // No second notice while one runs.
    expect(within(sideCard()).queryByRole('button', { name: 'Cancel exchange' })).not.toBeInTheDocument()
  })

  it('says a zero-day notice cancels at once', async () => {
    start({ exchange: withNotice(null, { cancellation_notice_days: 0 }) })
    renderAt(`/exchanges/${EXCHANGE_ID}`)
    await loaded()
    fireEvent.click(within(sideCard()).getByRole('button', { name: 'Cancel exchange' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('the exchange is cancelled as soon as you give it. That is final.')
    expect(within(dialog).getByRole('button', { name: 'Cancel the exchange' })).toBeInTheDocument()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('withdraws the notice it gave', async () => {
    let exchange = withNotice(notice())
    start({
      reply: ({ method, url }: MockRequest) => {
        if (method === 'get' && url === EXCHANGE) return { status: 200, data: exchange }
        if (method === 'post' && url === `${CANCELLATION}/withdraw`) {
          exchange = withNotice(null)
          return { status: 200, data: notice({ status: 'withdrawn' }) }
        }
        return undefined
      },
    })
    renderAt(`/exchanges/${EXCHANGE_ID}`)
    await loaded()
    fireEvent.click(within(noticePanel()).getByRole('button', { name: 'Withdraw notice' }))
    expect(await screen.findByText('Cancellation notice withdrawn. The exchange carries on.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Notice to cancel' })).not.toBeInTheDocument())
    expect(api!.calls('post', `${CANCELLATION}/withdraw`)).toHaveLength(1)
  })

  it('agrees to the other business’s notice after a final check', async () => {
    let exchange = withNotice(theirNotice())
    start({
      reply: ({ method, url }: MockRequest) => {
        if (method === 'get' && url === EXCHANGE) return { status: 200, data: exchange }
        if (method === 'post' && url === `${CANCELLATION}/agree`) {
          exchange = withNotice(null, { status: 'cancelled', updated_at: '2027-01-12T10:00:00Z' })
          return { status: 200, data: theirNotice() }
        }
        return undefined
      },
    })
    renderAt(`/exchanges/${EXCHANGE_ID}`)
    await loaded()
    expect(noticePanel()).toHaveTextContent('Dana Studio (Northside Studio) gave notice')
    expect(noticePanel()).toHaveTextContent('Northstar Digital can agree to cancel now instead of waiting for that date.')
    expect(within(noticePanel()).queryByRole('button', { name: 'Withdraw notice' })).not.toBeInTheDocument()
    fireEvent.click(within(noticePanel()).getByRole('button', { name: 'Agree to cancel now' }))
    const dialog = screen.getByRole('dialog', { name: 'Cancel the exchange with Northside Studio now?' })
    expect(dialog).toHaveTextContent('It’s final')
    expect(within(dialog).getByRole('button', { name: 'Go back' })).toHaveFocus()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Agree to cancel now' }))

    expect(await screen.findByText('Exchange cancelled. Nothing more can be delivered or reviewed on it.')).toBeInTheDocument()
    const cancelled = await screen.findByRole('region', { name: 'Exchange cancelled' })
    expect(cancelled).toHaveTextContent('The exchange was cancelled on 12 Jan 2027 (Exchange Terms 13.1)')
    expect(screen.getAllByText('Cancelled', { selector: '.match-pill' })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /Submit delivery/ })).not.toBeInTheDocument()
    // Disputes survive the end of the exchange; cancelling doesn't.
    expect(within(sideCard()).getByRole('button', { name: 'Report a problem' })).toBeInTheDocument()
    expect(within(sideCard()).queryByRole('button', { name: 'Cancel exchange' })).not.toBeInTheDocument()
  })

  it('shows members lock lines instead of cancellation buttons', async () => {
    start({ role: 'member', exchange: withNotice(theirNotice()) })
    renderAt(`/exchanges/${EXCHANGE_ID}`)
    await loaded()
    expect(within(noticePanel()).queryByRole('button')).not.toBeInTheDocument()
    expect(noticePanel()).toHaveTextContent('Only owners and administrators of Northstar Digital can agree to cancel now.')
    expect(within(sideCard()).queryByRole('button')).not.toBeInTheDocument()
    expect(sideCard()).toHaveTextContent('Only owners and administrators of Northstar Digital can report a problem.')
  })

  it('reloads with a red notice when a notice is already running', async () => {
    start({
      exchange: withNotice(null),
      reply: ({ method, url }: MockRequest) =>
        method === 'post' && url === CANCELLATION
          ? { status: 409, data: apiErrorBody('invalid_exchange_transition', { entity: 'exchange', status: 'active', to: 'cancelled', reason: 'cancellation_pending', cancellation_id: 'notice-1' }) }
          : undefined,
    })
    renderAt(`/exchanges/${EXCHANGE_ID}`)
    await loaded()
    fireEvent.click(within(sideCard()).getByRole('button', { name: 'Cancel exchange' }))
    fireEvent.change(screen.getByLabelText(/Why are you cancelling/), { target: { value: 'Closing.' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Give notice' }))
    expect(await screen.findByText('A cancellation notice is already running, so no notice was given. The page now shows it.')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('disputes', () => {
  it('opens a dispute with a category, description and milestones', async () => {
    let exchange = withDispute(null)
    start({
      reply: ({ method, url, body }: MockRequest) => {
        if (method === 'get' && url === EXCHANGE) return { status: 200, data: exchange }
        if (method === 'post' && url === DISPUTES) {
          const opened = dispute(body as Partial<Dispute>)
          exchange = withDispute(opened, { completion: { blockers: ['milestones_not_accepted', 'dispute_open'], request: null, completed_at: null, record: null } })
          return { status: 201, data: opened }
        }
        return undefined
      },
    })
    renderAt(`/exchanges/${EXCHANGE_ID}`)
    await loaded()
    fireEvent.click(within(sideCard()).getByRole('button', { name: 'Report a problem' }))
    const dialog = screen.getByRole('dialog', { name: 'Open a dispute about the exchange with Northside Studio?' })
    expect(dialog).toHaveTextContent('doesn’t decide who is right (15.6)')
    expect(within(dialog).getByLabelText(/What is it about/)).toHaveFocus()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Open dispute' }))
    expect(await within(dialog).findByText('Choose what the problem is about.')).toBeInTheDocument()
    expect(within(dialog).getByText('Describe the problem.')).toBeInTheDocument()
    expect(api!.calls('post', DISPUTES)).toHaveLength(0)

    fireEvent.change(within(dialog).getByLabelText(/What is it about/), { target: { value: 'missed_deadline' } })
    fireEvent.change(within(dialog).getByLabelText(/Describe the problem/), { target: { value: 'The reconciliation was due on 10 February.' } })
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Milestone 3 · Final brand guide/ }))
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Milestone 2 · First monthly reconciliation/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Open dispute' }))

    expect(await screen.findByText(/^Dispute opened\./)).toBeInTheDocument()
    expect(JSON.parse(api!.calls('post', DISPUTES)[0][0].data as string)).toEqual({ category: 'missed_deadline', description: 'The reconciliation was due on 10 February.', milestone_ids: ['milestone-2', 'milestone-3'] })
    await waitFor(() => expect(disputePanel()).toHaveTextContent('A deadline was missed. Reported by Alex Morgan (Northstar Digital)'))
    expect(disputePanel()).toHaveTextContent('About Milestone 2 · First monthly reconciliation, Milestone 3 · Final brand guide.')
    expect(disputePanel()).toHaveTextContent('Northside Studio hasn’t responded yet.')
    expect(within(disputePanel()).getByRole('button', { name: 'Withdraw dispute' })).toBeInTheDocument()
    expect(within(disputePanel()).queryByRole('button', { name: 'Respond' })).not.toBeInTheDocument()
    expect(within(sideCard()).queryByRole('button', { name: 'Report a problem' })).not.toBeInTheDocument()
  })

  it('reloads with a red notice when a dispute is already open', async () => {
    start({
      exchange: withDispute(null),
      reply: ({ method, url }: MockRequest) => (method === 'post' && url === DISPUTES ? { status: 409, data: apiErrorBody('dispute_already_open', { dispute_id: 'dispute-1' }) } : undefined),
    })
    renderAt(`/exchanges/${EXCHANGE_ID}`)
    await loaded()
    fireEvent.click(within(sideCard()).getByRole('button', { name: 'Report a problem' }))
    fireEvent.change(screen.getByLabelText(/What is it about/), { target: { value: 'quality' } })
    fireEvent.change(screen.getByLabelText(/Describe the problem/), { target: { value: 'Blurry logos.' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Open dispute' }))
    expect(await screen.findByText('A dispute is already open on this exchange, so your dispute wasn’t opened. The page now shows it.')).toBeInTheDocument()
  })

  it('lets the other business respond once', async () => {
    let exchange = withDispute(theirDispute())
    start({
      reply: ({ method, url, body }: MockRequest) => {
        if (method === 'get' && url === EXCHANGE) return { status: 200, data: exchange }
        if (method === 'post' && url === `${DISPUTES}/dispute-1/response`) {
          const answered = theirDispute({ response: (body as { response: string }).response, responded_by_business_id: 'business-1', responded_by_user_id: 'user-1', responded_by_user_name: 'Alex Morgan', responded_at: '2027-02-13T09:00:00Z' })
          exchange = withDispute(answered)
          return { status: 200, data: answered }
        }
        return undefined
      },
    })
    renderAt(`/exchanges/${EXCHANGE_ID}`)
    await loaded()
    expect(disputePanel()).toHaveTextContent('What Northside Studio says')
    expect(within(disputePanel()).queryByRole('button', { name: 'Withdraw dispute' })).not.toBeInTheDocument()
    fireEvent.click(within(disputePanel()).getByRole('button', { name: 'Respond' }))
    fireEvent.click(within(disputePanel()).getByRole('button', { name: 'Send response' }))
    expect(await within(disputePanel()).findByText('Write your response.')).toBeInTheDocument()
    fireEvent.change(within(disputePanel()).getByLabelText(/Your response/), { target: { value: 'We agreed a new date by email.' } })
    fireEvent.click(within(disputePanel()).getByRole('button', { name: 'Send response' }))
    expect(await screen.findByText('Response added to the dispute.')).toBeInTheDocument()
    await waitFor(() => expect(disputePanel()).toHaveTextContent('Alex Morgan (Northstar Digital) responded on'))
    expect(disputePanel()).toHaveTextContent('We agreed a new date by email.')
    expect(within(disputePanel()).queryByRole('button')).not.toBeInTheDocument()
  })

  it('withdraws the dispute it opened and shows how it ended', async () => {
    let exchange = withDispute(dispute())
    let disputes: Dispute[] = [dispute()]
    start({
      reply: ({ method, url }: MockRequest) => {
        if (method === 'get' && url === EXCHANGE) return { status: 200, data: exchange }
        if (method === 'get' && url === DISPUTES) return { status: 200, data: { items: disputes } }
        if (method === 'post' && url === `${DISPUTES}/dispute-1/withdraw`) {
          const withdrawn = dispute({ status: 'closed', closed_by: 'business', resolution: 'withdrawn', closed_at: '2027-02-14T09:00:00Z' })
          exchange = withDispute(null)
          disputes = [withdrawn]
          return { status: 200, data: withdrawn }
        }
        return undefined
      },
    })
    renderAt(`/exchanges/${EXCHANGE_ID}`)
    await loaded()
    expect(screen.queryByRole('region', { name: 'Closed disputes' })).not.toBeInTheDocument()
    fireEvent.click(within(disputePanel()).getByRole('button', { name: 'Withdraw dispute' }))
    expect(await screen.findByText('Dispute withdrawn. It’s closed, and its record stays on the exchange.')).toBeInTheDocument()
    const closed = await screen.findByRole('region', { name: 'Closed disputes' })
    expect(closed).toHaveTextContent('Withdrawn by Northstar Digital on 14 Feb 2027.')
    expect(screen.queryByRole('region', { name: 'Dispute open' })).not.toBeInTheDocument()
  })

  it('shows the staff outcome and note, without the staff member’s name', async () => {
    start({
      exchange: withDispute(null),
      disputes: [theirDispute({ status: 'closed', closed_by: 'staff', resolution: 'resolved_by_parties', resolution_note: 'Both confirmed a new date.', closed_at: '2027-02-20T09:00:00Z' })],
    })
    renderAt(`/exchanges/${EXCHANGE_ID}`)
    const closed = await screen.findByRole('region', { name: 'Closed disputes' })
    expect(closed).toHaveTextContent('Closed by BFB staff on 20 Feb 2027: resolved by the businesses.')
    expect(closed).toHaveTextContent('Both confirmed a new date.')
  })

  it('says an open dispute blocks completion', async () => {
    const base = exchangeDetail({ milestones_accepted: 3, next_due_date: null })
    start({
      exchange: {
        ...base,
        milestones: base.milestones.map((milestone) => ({ ...milestone, status: 'accepted' as const })),
        completion: { blockers: ['dispute_open'], request: null, completed_at: null, record: null },
        open_dispute: theirDispute(),
      },
    })
    renderAt(`/exchanges/${EXCHANGE_ID}`)
    await loaded()
    expect(disputePanel()).toHaveTextContent('While it’s open the exchange can’t be completed.')
    const completion = screen.getByRole('region', { name: 'Completion' })
    expect(completion).toHaveTextContent('can’t be completed yet: a dispute is open, and BFB staff need to close it first')
    expect(within(completion).queryByRole('button', { name: 'Mark exchange complete' })).not.toBeInTheDocument()
  })

  it('shows members a lock line instead of the dispute buttons', async () => {
    start({ role: 'member', exchange: withDispute(theirDispute()) })
    renderAt(`/exchanges/${EXCHANGE_ID}`)
    await loaded()
    expect(within(disputePanel()).queryByRole('button')).not.toBeInTheDocument()
    expect(disputePanel()).toHaveTextContent('Only owners and administrators of Northstar Digital can respond to the dispute.')
  })
})

describe('cancelled exchanges in lists', () => {
  const cancelled = exchangeSummary({ id: 'exchange-off', status: 'cancelled', other_business: { ...studio, id: 'corner', display_name: 'Corner Bakery' }, updated_at: '2027-01-24T09:00:00Z' })

  it('lists cancelled exchanges under their own tab', async () => {
    start({ exchanges: [exchangeSummary(), cancelled] })
    renderAt('/exchanges?tab=cancelled')
    const list = await screen.findByRole('list', { name: 'Cancelled exchanges' })
    expect(screen.getByRole('tab', { name: 'Cancelled 1' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Active 1' })).toBeInTheDocument()
    const cards = within(list).getAllByRole('listitem')
    expect(cards).toHaveLength(1)
    expect(cards[0]).toHaveTextContent('Cancelled 24 Jan 2027')
    expect(within(cards[0]).getByRole('link', { name: 'View cancelled exchange with Corner Bakery' })).toHaveAttribute('href', '/exchanges/exchange-off')
    expect(api!.calls('get', EXCHANGES).some(([config]) => (config.params as { status: string }).status === 'cancelled')).toBe(true)
  })

  it('explains an empty Cancelled tab', async () => {
    start({ exchanges: [exchangeSummary()] })
    renderAt('/exchanges')
    fireEvent.click(await screen.findByRole('tab', { name: 'Cancelled 0' }))
    expect(await screen.findByText('No cancelled exchanges')).toBeInTheDocument()
  })

  it('keeps cancelled exchanges off the dashboard’s active list', async () => {
    start({ exchanges: [cancelled] })
    renderAt('/dashboard')
    expect(await screen.findByText(/No active exchanges yet\./)).toBeInTheDocument()
    expect(screen.queryByText(/Exchange with Corner Bakery/)).not.toBeInTheDocument()
  })
})
