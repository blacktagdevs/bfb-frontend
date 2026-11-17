import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from '../../App'
import { useToastStore } from '../../components/feedback'
import { ACCESS_TOKEN_KEY, clearStoredSession, REFRESH_TOKEN_KEY } from '../../lib/auth/tokens'
import { useSessionStore } from '../../stores/session'
import { apiErrorBody, apiMembership, apiUser, mockApi, tokenBody, type MockHandler, type MockReply, type MockRequest } from '../../test/mockApi'
import { activationEvent, exchangeDetail, northstar, studio, STUDIO_ID } from '../../test/proposalServer'
import type { AdminDispute, AdminDisputeDetail } from './disputesApi'
import { readDisputeFilters } from './DisputesPage'

const DISPUTE_ID = 'dispute-1'
const EXCHANGE_ID = 'exchange-1'

function listItem(overrides: Partial<AdminDispute> = {}): AdminDispute {
  return {
    id: DISPUTE_ID,
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
    closed_by_user_id: null,
    closed_by_user_name: null,
    exchange: { id: EXCHANGE_ID, status: 'active', agreement_id: 'agreement-1', business_a: northstar, business_b: studio, activated_at: '2026-11-20T12:00:00Z' },
    ...overrides,
  }
}

function detail(overrides: Partial<AdminDisputeDetail> = {}): AdminDisputeDetail {
  const milestones = exchangeDetail().milestones.map((milestone) =>
    milestone.sequence === 1
      ? {
          ...milestone,
          status: 'submitted' as const,
          latest_submission: {
            id: 'submission-1',
            milestone_id: milestone.id,
            number: 1,
            is_revision: false,
            revision_number: null,
            beyond_revision_limit: false,
            note: 'Three concepts attached.',
            links: [],
            attachments: [{ upload_id: 'upload-1', original_filename: 'concepts.pdf', content_type: 'application/pdf', size_bytes: 2048, position: 0 }],
            submitted_by_user_id: 'user-1',
            submitted_by_user_name: 'Alex Morgan',
            submitted_by_business_id: 'business-1',
            submitted_at: '2027-01-15T10:00:00Z',
            review_due_at: '2027-01-22T10:00:00Z',
            decision: null,
            reminder: null,
          },
        }
      : milestone,
  ) as AdminDisputeDetail['milestones']
  return {
    ...listItem(),
    milestones,
    cancellation_notice: null,
    history: [
      activationEvent({ id: 'e-2', type: 'dispute.opened', actor_type: 'business', actor_user_name: 'Alex Morgan', actor_business_id: 'business-1', to_status: null, metadata: { category: 'missed_deadline' }, occurred_at: '2027-02-12T09:00:00Z' }),
      activationEvent(),
    ],
    history_next_cursor: 'cursor-2',
    ...overrides,
  }
}

interface ServerOptions {
  items?: AdminDispute[]
  dispute?: AdminDisputeDetail
  reply?: (request: MockRequest) => MockReply | undefined
}

function apiServer({ items = [listItem()], dispute = detail(), reply }: ServerOptions = {}): MockHandler {
  const user = apiUser({ email_verified: true, platform_role: 'support' })
  return (request) => {
    const custom = reply?.(request)
    if (custom) return custom
    const { method, url, config } = request
    if (method === 'post' && url === '/auth/refresh') return { status: 200, data: { ...tokenBody('access-2', 'refresh-2'), user } }
    if (method === 'get' && url === '/account') return { status: 200, data: { user, memberships: [apiMembership()] } }
    if (method === 'get' && url === '/admin/disputes') {
      const { status } = (config.params ?? {}) as { status?: string }
      const filtered = items.filter((item) => !status || item.status === status)
      return { status: 200, data: { items: filtered, total: filtered.length, limit: 20, offset: 0 } }
    }
    if (method === 'get' && url === `/admin/disputes/${DISPUTE_ID}`) return { status: 200, data: dispute }
    if (method === 'get' && url === `/admin/exchanges/${EXCHANGE_ID}/history`) {
      return { status: 200, data: { items: [activationEvent({ id: 'e-0', type: 'exchange.cancellation_withdrawn', actor_type: 'business', actor_user_name: 'Dana Studio', actor_business_id: STUDIO_ID, to_status: null, metadata: {} })], next_cursor: null } }
    }
    return { status: 404, data: apiErrorBody('not_found') }
  }
}

let api: ReturnType<typeof mockApi> | undefined

function renderAt(path: string, options: ServerOptions = {}) {
  api = mockApi(apiServer(options))
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
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

describe('admin disputes list', () => {
  it('reads the status and page from the address', () => {
    expect(readDisputeFilters(new URLSearchParams('status=open&page=3'))).toEqual({ status: 'open', page: 3 })
    expect(readDisputeFilters(new URLSearchParams('status=nope&page=-1'))).toEqual({ page: 1 })
  })

  it('lists disputes with their businesses, category and state, and filters by status', async () => {
    const closed = listItem({ id: 'dispute-2', status: 'closed', category: 'quality', closed_by: 'staff', resolution: 'mediation', closed_at: '2027-02-20T09:00:00Z', responded_at: '2027-02-13T09:00:00Z' })
    renderAt('/admin/disputes', { items: [listItem(), closed] })
    const list = await screen.findByRole('list', { name: 'Disputes' })
    const rows = within(list).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('Northstar Digital & Northside Studio')
    expect(rows[0]).toHaveTextContent('A deadline was missed')
    expect(rows[0]).toHaveTextContent('by Alex Morgan (Northstar Digital) · No response yet')
    expect(rows[0]).toHaveTextContent('Open')
    expect(rows[1]).toHaveTextContent('Resolved through mediation')
    expect(rows[1]).toHaveTextContent('Response received')
    expect(within(rows[0]).getByRole('link', { name: 'Open dispute between Northstar Digital & Northside Studio' })).toHaveAttribute('href', `/admin/disputes/${DISPUTE_ID}`)
    expect(screen.getByRole('link', { name: 'Disputes' })).toHaveClass('active')

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'closed' } })
    await waitFor(() => expect(within(screen.getByRole('list', { name: 'Disputes' })).getAllByRole('listitem')).toHaveLength(1))
    expect(screen.getByRole('heading', { name: 'Closed disputes' })).toBeInTheDocument()
  })

  it('explains an empty list', async () => {
    renderAt('/admin/disputes?status=open', { items: [] })
    expect(await screen.findByText('No open disputes')).toBeInTheDocument()
  })
})

describe('admin dispute detail', () => {
  it('shows the statements, milestones and history, and says staff change nothing', async () => {
    renderAt(`/admin/disputes/${DISPUTE_ID}`)
    expect(await screen.findByRole('heading', { name: 'Northstar Digital & Northside Studio' })).toBeInTheDocument()
    expect(screen.getByRole('note')).toHaveTextContent('It never changes a milestone or the exchange: staff can’t accept, reject or cancel anything here.')
    const statements = screen.getByRole('region', { name: 'Statements' })
    expect(statements).toHaveTextContent('The reconciliation was due on 10 February.')
    expect(statements).toHaveTextContent('About Milestone 2 · First monthly reconciliation')
    expect(statements).toHaveTextContent('Northside Studio hasn’t responded.')

    const milestones = screen.getByRole('list', { name: 'Milestones' })
    expect(within(milestones).getByRole('listitem', { name: /Milestone 2/ })).toHaveTextContent('Named in the dispute')
    expect(within(milestones).getByRole('listitem', { name: /Milestone 1/ })).toHaveTextContent('Three concepts attached.')
    expect(within(milestones).getByRole('button', { name: 'Download concepts.pdf (opens in a new tab)' })).toBeInTheDocument()
    // No milestone or exchange actions for staff.
    expect(screen.queryByRole('button', { name: /Accept|Ask for changes|Cancel exchange/ })).not.toBeInTheDocument()

    const history = screen.getByRole('region', { name: 'Exchange history' })
    expect(history).toHaveTextContent('Dispute opened: a deadline was missed')
    expect(history).toHaveTextContent('Alex Morgan (Northstar Digital)')
    fireEvent.click(within(history).getByRole('button', { name: 'Show earlier history' }))
    expect(await within(history).findByText('Cancellation notice withdrawn')).toBeInTheDocument()
    expect(history).toHaveTextContent('Dana Studio (Northside Studio)')
  })

  it('closes a dispute with a resolution and note', async () => {
    let current = detail()
    renderAt(`/admin/disputes/${DISPUTE_ID}`, {
      reply: ({ method, url, body }) => {
        if (method === 'get' && url === `/admin/disputes/${DISPUTE_ID}`) return { status: 200, data: current }
        if (method === 'post' && url === `/admin/disputes/${DISPUTE_ID}/close`) {
          const { resolution, note } = body as { resolution: AdminDispute['resolution']; note: string }
          current = detail({ status: 'closed', closed_by: 'staff', resolution, resolution_note: note, closed_at: '2027-02-20T09:00:00Z', closed_by_user_name: 'Sam Lee' })
          return { status: 200, data: current }
        }
        return undefined
      },
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Close dispute' }))
    const dialog = screen.getByRole('dialog', { name: 'Close this dispute?' })
    expect(dialog).toHaveTextContent('Closing doesn’t change any milestone or the exchange')
    expect(within(dialog).getByLabelText(/How did it end/)).toHaveFocus()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close dispute' }))
    expect(await within(dialog).findByText('Choose how the dispute ended.')).toBeInTheDocument()
    expect(within(dialog).getByText('Write a note for both businesses.')).toBeInTheDocument()
    expect(api!.calls('post', `/admin/disputes/${DISPUTE_ID}/close`)).toHaveLength(0)

    fireEvent.change(within(dialog).getByLabelText(/How did it end/), { target: { value: 'resolved_by_parties' } })
    fireEvent.change(within(dialog).getByLabelText(/Note for both businesses/), { target: { value: ' Both confirmed a new date. ' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close dispute' }))
    expect(await screen.findByText('Dispute closed. Both businesses see the outcome and your note on the exchange.')).toBeInTheDocument()
    expect(JSON.parse(api!.calls('post', `/admin/disputes/${DISPUTE_ID}/close`)[0][0].data as string)).toEqual({ resolution: 'resolved_by_parties', note: 'Both confirmed a new date.' })
    const outcome = await screen.findByRole('region', { name: 'Outcome' })
    await waitFor(() => expect(outcome).toHaveTextContent('Resolved by the businesses'))
    expect(outcome).toHaveTextContent('Sam Lee, BFB staff')
    expect(outcome).toHaveTextContent('Both confirmed a new date.')
    expect(within(outcome).queryByRole('button', { name: 'Close dispute' })).not.toBeInTheDocument()
  })

  it('says so when the dispute was already closed', async () => {
    renderAt(`/admin/disputes/${DISPUTE_ID}`, {
      reply: ({ method, url }) =>
        method === 'post' && url === `/admin/disputes/${DISPUTE_ID}/close` ? { status: 409, data: apiErrorBody('invalid_dispute_status', { status: 'closed', reason: 'dispute_closed' }) } : undefined,
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Close dispute' }))
    fireEvent.change(screen.getByLabelText(/How did it end/), { target: { value: 'other' } })
    fireEvent.change(screen.getByLabelText(/Note for both businesses/), { target: { value: 'Done.' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close dispute' }))
    expect(await screen.findByText('This dispute was already closed, so nothing changed. Its outcome is shown below.')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('names a dispute that doesn’t exist', async () => {
    renderAt('/admin/disputes/nope')
    expect(await screen.findByText('This dispute doesn’t exist')).toBeInTheDocument()
  })
})
