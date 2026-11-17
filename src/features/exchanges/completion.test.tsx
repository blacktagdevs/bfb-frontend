import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from '../../App'
import { useToastStore } from '../../components/feedback'
import { ACCESS_TOKEN_KEY, clearStoredSession, REFRESH_TOKEN_KEY } from '../../lib/auth/tokens'
import { useSessionStore } from '../../stores/session'
import { apiErrorBody, mockApi, type MockRequest } from '../../test/mockApi'
import { activationEvent, EXCHANGE, EXCHANGE_ID, EXCHANGES, exchangeDetail, exchangeSummary, proposalServer, studio, STUDIO_ID, type ProposalServerOptions } from '../../test/proposalServer'
import { blockersSentence, historyTitle, nextStepText } from './exchangeCopy'
import type { CompletionRequest, Exchange, ExchangeCompletion } from './exchangesApi'

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

const names = { mine: 'Northstar Digital', other: 'Northside Studio' }
const COMPLETION = `${EXCHANGE}/completion`
const RECORD = `${EXCHANGE}/completion-record`

function pendingRequest(overrides: Partial<CompletionRequest> = {}): CompletionRequest {
  return {
    id: 'request-1',
    status: 'pending',
    requested_by_user_id: 'user-1',
    requested_by_user_name: 'Alex Morgan',
    requested_by_business_id: 'business-1',
    requested_by_side: 'a',
    requested_at: '2027-03-01T10:00:00Z',
    resolved_by_user_id: null,
    resolved_by_user_name: null,
    resolved_by_business_id: null,
    resolved_at: null,
    ...overrides,
  }
}

const byThem = () => pendingRequest({ requested_by_user_id: 'user-9', requested_by_user_name: 'Dana Studio', requested_by_business_id: STUDIO_ID, requested_by_side: 'b' })

/** Every milestone accepted, with the completion state given. */
function allAccepted(completion: Partial<ExchangeCompletion> = {}, overrides: Partial<Exchange> = {}): Exchange {
  const base = exchangeDetail({ milestones_accepted: 3, next_due_date: null, ...overrides })
  return {
    ...base,
    milestones: base.milestones.map((milestone) => ({ ...milestone, status: 'accepted' as const })),
    completion: { blockers: [], request: null, completed_at: null, record: null, ...completion },
  }
}

function completed(): Exchange {
  return allAccepted(
    {
      request: pendingRequest({ status: 'confirmed', resolved_by_user_id: 'user-9', resolved_by_user_name: 'Dana Studio', resolved_by_business_id: STUDIO_ID, resolved_at: '2027-03-02T09:00:00Z' }),
      completed_at: '2027-03-02T09:00:00Z',
      record: { content_type: 'text/html; charset=utf-8', sha256: 'e'.repeat(64), created_at: '2027-03-02T09:00:00Z' },
    },
    // updated_at moves on later (a dispute after the end, say); the page dates completion by completed_at.
    { status: 'completed', completed_at: '2027-03-02T09:00:00Z', updated_at: '2027-04-15T09:00:00Z' },
  )
}

const panel = () => screen.getByRole('region', { name: /^(Completion|Exchange completed)$/ })

function fakeTab() {
  const tab = { opener: {} as unknown, location: { href: '' }, close: vi.fn() }
  const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window)
  return { tab, open }
}

describe('completion copy', () => {
  it('names completion history entries and blockers, unknown ones generically', () => {
    const entry = (type: string, metadata: Record<string, unknown> = {}) => activationEvent({ type, metadata, actor_type: 'business', to_status: null })
    expect(historyTitle(entry('exchange.completion_requested'), 2)).toBe('Completion requested')
    expect(historyTitle(entry('exchange.completion_withdrawn', { by_requesting_business: true }), 2)).toBe('Completion request withdrawn')
    expect(historyTitle(entry('exchange.completion_withdrawn', { by_requesting_business: false }), 2)).toBe('Completion request declined')
    expect(historyTitle(entry('exchange.completed'), 2)).toBe('Exchange completed: both businesses confirmed')
    expect(blockersSentence(['dispute_open'])).toBe('a dispute is open, and BFB staff need to close it first')
    expect(blockersSentence(['dispute_open', 'payment_pending'])).toBe('a dispute is open, and BFB staff need to close it first and something still needs resolving first (payment pending)')
  })

  it('says the next step around completion', () => {
    const next = (exchange: Exchange) => nextStepText(exchange, 'business-1', names, { canReview: true })
    expect(next(allAccepted())).toBe('Every milestone is accepted. Mark the exchange complete; Northside Studio then confirms it.')
    expect(next(allAccepted({ request: pendingRequest() }))).toBe('Nothing for you to do now. Northside Studio needs to confirm completion.')
    expect(next(allAccepted({ request: byThem() }))).toBe('Confirm completion: Northside Studio marked the exchange complete.')
    expect(next(allAccepted({ blockers: ['dispute_open'] }))).toMatch(/can’t be completed yet: a dispute is open/)
    expect(next(completed())).toBe('The exchange is complete. There is nothing more to do.')
  })
})

describe('completing an exchange', () => {
  it('shows nothing about completion until every milestone is accepted', async () => {
    start()
    renderAt(`/exchanges/${EXCHANGE_ID}`)
    await screen.findByRole('list', { name: 'Milestones' })
    expect(screen.queryByRole('region', { name: 'Completion' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mark exchange complete' })).not.toBeInTheDocument()
  })

  it('marks the exchange complete, then withdraws the request', async () => {
    let exchange = allAccepted()
    start({
      reply: ({ method, url }: MockRequest) => {
        if (method === 'get' && url === EXCHANGE) return { status: 200, data: exchange }
        if (method === 'post' && url === COMPLETION) {
          exchange = allAccepted({ request: pendingRequest() })
          return { status: 200, data: exchange }
        }
        if (method === 'post' && url === `${COMPLETION}/withdraw`) {
          exchange = allAccepted()
          return { status: 200, data: exchange }
        }
        return undefined
      },
    })
    renderAt(`/exchanges/${EXCHANGE_ID}`)
    await screen.findByRole('list', { name: 'Milestones' })
    expect(panel()).toHaveTextContent('All 3 milestones are accepted.')
    fireEvent.click(within(panel()).getByRole('button', { name: 'Mark exchange complete' }))

    expect(await screen.findByText('Exchange marked complete. Northside Studio needs to confirm it.')).toBeInTheDocument()
    expect(api!.calls('post', COMPLETION)).toHaveLength(1)
    expect(panel()).toHaveTextContent('Alex Morgan (Northstar Digital) marked the exchange complete on')
    expect(panel()).toHaveTextContent('It completes when Northside Studio confirms.')
    expect(within(panel()).queryByRole('button', { name: 'Confirm completion' })).not.toBeInTheDocument()

    fireEvent.click(within(panel()).getByRole('button', { name: 'Withdraw request' }))
    expect(await screen.findByText('Completion request withdrawn.')).toBeInTheDocument()
    expect(within(panel()).getByRole('button', { name: 'Mark exchange complete' })).toBeInTheDocument()
  })

  it('confirms the other business’s request after a final check, then offers the completion record', async () => {
    let exchange = allAccepted({ request: byThem() })
    let links = 0
    start({
      reply: ({ method, url }: MockRequest) => {
        if (method === 'get' && url === EXCHANGE) return { status: 200, data: exchange }
        if (method === 'post' && url === `${COMPLETION}/confirm`) {
          exchange = completed()
          return { status: 200, data: exchange }
        }
        if (method === 'get' && url === RECORD) {
          links += 1
          return { status: 200, data: { url: `https://files.example/record.html?sig=${links}`, url_expires_at: '2027-03-02T09:15:00Z', content_type: 'text/html; charset=utf-8', sha256: 'e'.repeat(64) } }
        }
        return undefined
      },
    })
    renderAt(`/exchanges/${EXCHANGE_ID}`)
    await screen.findByRole('list', { name: 'Milestones' })
    expect(panel()).toHaveTextContent('Dana Studio (Northside Studio) marked the exchange complete on')
    fireEvent.click(within(panel()).getByRole('button', { name: 'Confirm completion' }))
    const dialog = screen.getByRole('dialog', { name: 'Complete the exchange with Northside Studio?' })
    expect(dialog).toHaveTextContent('it’s final')
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm completion' }))

    expect(await screen.findByText('Exchange completed. The completion record is ready to download.')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    const done = await screen.findByRole('region', { name: 'Exchange completed' })
    expect(done).toHaveTextContent('Both businesses confirmed the exchange is complete on 2 Mar 2027')
    expect(done).toHaveTextContent('Alex Morgan (Northstar Digital) marked it complete and Dana Studio (Northside Studio) confirmed it.')
    expect(done).toHaveTextContent('e'.repeat(64))
    expect(screen.getAllByText('Completed', { selector: '.match-pill' })).toHaveLength(1)

    const { tab, open } = fakeTab()
    const download = within(done).getByRole('button', { name: 'Download the completion record (opens in a new tab)' })
    fireEvent.click(download)
    await waitFor(() => expect(tab.location.href).toBe('https://files.example/record.html?sig=1'))
    expect(open).toHaveBeenCalledWith('', '_blank')
    expect(tab.opener).toBeNull()
    await waitFor(() => expect(download).not.toBeDisabled())
    fireEvent.click(download)
    await waitFor(() => expect(tab.location.href).toBe('https://files.example/record.html?sig=2'))
    expect(api!.calls('get', RECORD)).toHaveLength(2)
  })

  it('declines the other business’s request', async () => {
    let exchange = allAccepted({ request: byThem() })
    start({
      reply: ({ method, url }: MockRequest) => {
        if (method === 'get' && url === EXCHANGE) return { status: 200, data: exchange }
        if (method === 'post' && url === `${COMPLETION}/withdraw`) {
          exchange = allAccepted()
          return { status: 200, data: exchange }
        }
        return undefined
      },
    })
    renderAt(`/exchanges/${EXCHANGE_ID}`)
    await screen.findByRole('list', { name: 'Milestones' })
    fireEvent.click(within(panel()).getByRole('button', { name: 'Decline' }))
    expect(await screen.findByText(/^Completion request declined\./)).toBeInTheDocument()
    expect(api!.calls('post', `${COMPLETION}/withdraw`)).toHaveLength(1)
  })

  it('shows members a lock line instead of the completion buttons', async () => {
    start({ role: 'member', exchange: allAccepted({ request: byThem() }) })
    renderAt(`/exchanges/${EXCHANGE_ID}`)
    await screen.findByRole('list', { name: 'Milestones' })
    expect(within(panel()).queryByRole('button')).not.toBeInTheDocument()
    expect(panel()).toHaveTextContent('Only owners and administrators of Northstar Digital can complete the exchange.')
  })

  it('says what blocks completion, including blockers it does not know', async () => {
    start({ exchange: allAccepted({ blockers: ['dispute_open', 'payment_pending'] }) })
    renderAt(`/exchanges/${EXCHANGE_ID}`)
    await screen.findByRole('list', { name: 'Milestones' })
    expect(panel()).toHaveTextContent('can’t be completed yet: a dispute is open, and BFB staff need to close it first and something still needs resolving first (payment pending)')
    expect(within(panel()).queryByRole('button', { name: 'Mark exchange complete' })).not.toBeInTheDocument()
  })

  it('reloads with a red notice when completion became blocked', async () => {
    start({
      exchange: allAccepted({ request: byThem() }),
      reply: ({ method, url }: MockRequest) =>
        method === 'post' && url === `${COMPLETION}/confirm`
          ? { status: 409, data: apiErrorBody('invalid_exchange_transition', { entity: 'exchange', status: 'active', to: 'completed', reason: 'completion_blocked', blockers: ['dispute_open'] }) }
          : undefined,
    })
    renderAt(`/exchanges/${EXCHANGE_ID}`)
    await screen.findByRole('list', { name: 'Milestones' })
    fireEvent.click(within(panel()).getByRole('button', { name: 'Confirm completion' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm completion' }))
    expect(await screen.findByText('The exchange can’t be completed yet: a dispute is open, and BFB staff need to close it first. So the exchange wasn’t completed.')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('completed exchanges in lists', () => {
  const done = exchangeSummary({ id: 'exchange-done', status: 'completed', other_business: { ...studio, id: 'corner', display_name: 'Corner Bakery' }, milestones_accepted: 3, next_due_date: null, completed_at: '2027-03-02T09:00:00Z', updated_at: '2027-04-15T09:00:00Z' })

  it('lists completed exchanges under the Completed tab', async () => {
    start({ exchanges: [exchangeSummary(), done] })
    renderAt('/exchanges')
    expect(await screen.findByRole('tab', { name: 'Completed 1' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Active 1' })).toHaveAttribute('aria-selected', 'true')
    expect(within(screen.getByRole('list', { name: 'Active exchanges' })).getAllByRole('listitem')).toHaveLength(1)

    fireEvent.click(screen.getByRole('tab', { name: 'Completed 1' }))
    const list = await screen.findByRole('list', { name: 'Completed exchanges' })
    const cards = within(list).getAllByRole('listitem')
    expect(cards).toHaveLength(1)
    expect(cards[0]).toHaveTextContent('Business exchange with Corner Bakery')
    expect(cards[0]).toHaveTextContent('Completed 2 Mar 2027')
    expect(cards[0]).toHaveTextContent('3 milestones, 3 accepted')
    expect(within(cards[0]).getByRole('link', { name: 'View completed exchange with Corner Bakery' })).toHaveAttribute('href', '/exchanges/exchange-done')
    expect(api!.calls('get', EXCHANGES).some(([config]) => (config.params as { status: string }).status === 'completed')).toBe(true)
  })

  it('opens the Completed tab from the link', async () => {
    start({ exchanges: [done] })
    renderAt('/exchanges?tab=completed')
    expect(await screen.findByRole('list', { name: 'Completed exchanges' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Completed 1' })).toHaveAttribute('aria-selected', 'true')
  })

  it('shows the last completed exchange on the dashboard, out of the active list', async () => {
    start({ exchanges: [done] })
    renderAt('/dashboard')
    expect(await screen.findByText(/No active exchanges right now\./)).toBeInTheDocument()
    expect(await screen.findByText(/Last completed: the exchange with Corner Bakery, 2 Mar 2027\./)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /See completed exchanges/ })).toHaveAttribute('href', '/exchanges?tab=completed')
    expect(screen.getByText('Starts when an agreement is signed')).toBeInTheDocument()
  })
})
