import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from '../../App'
import { useToastStore } from '../../components/feedback'
import { ApiError } from '../../lib/api/errors'
import { ACCESS_TOKEN_KEY, clearStoredSession, REFRESH_TOKEN_KEY } from '../../lib/auth/tokens'
import { useSessionStore } from '../../stores/session'
import { apiErrorBody, mockApi, type MockRequest } from '../../test/mockApi'
import { activationEvent, EXCHANGE, EXCHANGE_ID, exchangeDetail, proposalServer, STUDIO_ID, type ProposalServerOptions } from '../../test/proposalServer'
import { acceptOwnershipText, closedAt, conflictNotice, formatDayTime, historyTitle, nextStepText, reviewOverdue } from './exchangeCopy'
import type { Decision, Exchange, ExchangeEvent, ExchangeMilestone, Submission } from './exchangesApi'

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
const PAST = '2026-01-05T10:00:00Z'
const FUTURE = '2099-01-05T10:00:00Z'
const M1 = `${EXCHANGE}/milestones/milestone-1`
const M2 = `${EXCHANGE}/milestones/milestone-2`

/** A delivery of milestone 2, which Northside Studio delivers to Northstar Digital (business-1). */
function theirSubmission(overrides: Partial<Submission> = {}): Submission {
  return {
    id: 'submission-2',
    exchange_id: EXCHANGE_ID,
    milestone_id: 'milestone-2',
    number: 1,
    note: 'January books closed and reconciled.',
    links: [],
    attachments: [],
    submitted_by_user_id: 'user-9',
    submitted_by_user_name: 'Dana Studio',
    submitted_by_business_id: STUDIO_ID,
    submitted_at: '2026-12-01T10:00:00Z',
    is_revision: false,
    revision_number: null,
    beyond_revision_limit: false,
    review_due_at: FUTURE,
    decision: null,
    reminder: null,
    ...overrides,
  }
}

/** A delivery of milestone 1, which Northstar Digital delivers. */
function mySubmission(overrides: Partial<Submission> = {}): Submission {
  return theirSubmission({ id: 'submission-1', milestone_id: 'milestone-1', submitted_by_user_name: 'Alex Morgan', submitted_by_business_id: 'business-1', note: 'Three concepts.', ...overrides })
}

function withMilestone(at: number, change: Partial<ExchangeMilestone>, overrides: Partial<Exchange> = {}): Exchange {
  const base = exchangeDetail(overrides)
  return { ...base, milestones: base.milestones.map((milestone, index) => (index === at ? { ...milestone, ...change } : milestone)) }
}

const toReview = (submission = theirSubmission(), change: Partial<ExchangeMilestone> = {}) =>
  withMilestone(1, { status: 'submitted', latest_submission: submission, review_due_at: submission.review_due_at, acceptance_criteria: 'Every account reconciled', ...change })

const inReview = (submission = mySubmission(), change: Partial<ExchangeMilestone> = {}) =>
  withMilestone(0, { status: 'submitted', latest_submission: submission, review_due_at: submission.review_due_at, ...change })

const milestone = (n: number) => screen.getByRole('listitem', { name: new RegExp(`^Milestone ${n}:`) })

function decision(overrides: Partial<Decision> = {}): Decision {
  return {
    id: 'decision-1',
    decision: 'accepted',
    reason: null,
    decided_by_type: 'business',
    decided_by_user_id: 'user-1',
    decided_by_user_name: 'Alex Morgan',
    decided_by_business_id: 'business-1',
    decided_at: '2026-12-03T09:00:00Z',
    ...overrides,
  }
}

function event(overrides: Partial<ExchangeEvent>): ExchangeEvent {
  return activationEvent({ id: 'event-x', milestone_id: 'milestone-1', actor_type: 'business', actor_business_id: 'business-1', actor_user_name: 'Alex Morgan', from_status: null, to_status: null, metadata: {}, ...overrides })
}

describe('review copy', () => {
  it('names the agreement’s IP option when accepting a delivery', () => {
    const names = { mine: 'Northstar Digital', other: 'Northside Studio' }
    expect(acceptOwnershipText({ ip_terms: 'license_to_use', ip_terms_label: 'Licence to use' }, names)).toBe(
      'The agreement uses “Licence to use” (Exchange Terms 6.3): Northside Studio keeps ownership, and once it’s accepted and Northstar Digital has given Northside Studio everything it owes under the agreement, Northstar Digital may use it for its own business purposes.',
    )
    expect(acceptOwnershipText({ ip_terms: 'each_keeps_own', ip_terms_label: 'Each keeps its own' }, names)).toBe(
      'The agreement uses “Each keeps its own” (Exchange Terms 6.4): Northside Studio keeps ownership, and once it’s accepted and Northstar Digital has given Northside Studio everything it owes under the agreement, Northstar Digital may use it only for the purpose set out in the agreement.',
    )
    expect(acceptOwnershipText({ ip_terms: null, ip_terms_label: null }, names)).toBe('The agreement’s terms on who owns or may use the work apply to it (Exchange Terms section 6).')
  })

  it('dates a closed exchange by completed_at or cancelled_at, never updated_at', () => {
    expect(closedAt({ status: 'completed', completed_at: '2027-03-02T09:00:00Z', cancelled_at: null })).toBe('2027-03-02T09:00:00Z')
    expect(closedAt({ status: 'cancelled', completed_at: null, cancelled_at: '2027-01-24T09:00:00Z' })).toBe('2027-01-24T09:00:00Z')
    expect(closedAt({ status: 'active', completed_at: null, cancelled_at: null })).toBeNull()
  })

  it('knows when the review period has ended', () => {
    const now = new Date('2026-06-01T00:00:00Z')
    const base = exchangeDetail().milestones[0]
    expect(reviewOverdue({ ...base, status: 'submitted', review_due_at: '2026-05-31T00:00:00Z' }, now)).toBe(true)
    expect(reviewOverdue({ ...base, status: 'submitted', review_due_at: '2026-06-02T00:00:00Z' }, now)).toBe(false)
    expect(reviewOverdue({ ...base, status: 'accepted', review_due_at: '2026-05-31T00:00:00Z' }, now)).toBe(false)
  })

  it('formats the deemed-acceptance date with the weekday and time', () => {
    const value = new Date(2026, 10, 27, 10, 0).toISOString()
    expect(formatDayTime(value, new Date(2026, 0, 1))).toBe('Friday 27 November at 10:00')
    expect(formatDayTime(value, new Date(2027, 0, 1))).toBe('Friday 27 November 2026 at 10:00')
  })

  it('says to send a reminder after the deadline, then when it is treated as accepted', () => {
    const now = new Date('2026-06-01T00:00:00Z')
    const accepted = { status: 'accepted' as const }
    const overdue = withMilestone(0, { status: 'submitted', review_due_at: '2026-05-01T00:00:00Z' })
    const all = { ...overdue, milestones: overdue.milestones.map((item, at) => (at === 0 ? item : { ...item, ...accepted })) }
    expect(nextStepText(all, 'business-1', names, { canReview: true, now })).toBe('Northside Studio didn’t review “Logo concepts” in time. Send a reminder: if they still don’t decide within 5 business days, it is treated as accepted.')
    const reminded = { ...all, milestones: all.milestones.map((item, at) => (at === 0 ? { ...item, reminder_sent_at: '2026-05-02T00:00:00Z', deemed_acceptance_at: '2026-05-09T10:00:00Z' } : item)) }
    expect(nextStepText(reminded, 'business-1', names, { canReview: true, now })).toBe('Nothing for you to do now. If Northside Studio doesn’t decide on “Logo concepts” by 9 May, it is treated as accepted.')
  })

  it('names review history entries, including deemed acceptance by BFB', () => {
    expect(historyTitle(event({ type: 'milestone.accepted' }), 2)).toBe('Delivery accepted')
    expect(historyTitle(event({ type: 'milestone.changes_requested' }), 2)).toBe('Changes requested')
    expect(historyTitle(event({ type: 'milestone.reminder_sent', metadata: { deemed_acceptance_at: '2027-02-02T10:00:00Z' } }), 2)).toBe('Reminder sent: treated as accepted on 2 Feb 2027 if there’s no decision by then')
    expect(historyTitle(event({ type: 'milestone.deemed_accepted', actor_type: 'system' }), 2)).toMatch(/^Treated as accepted under the agreement’s terms/)
  })

  it('explains refusals that reload the exchange', () => {
    const refused = (code: string, details: unknown) => new ApiError({ status: 409, code: code as never, message: code, details })
    expect(conflictNotice(refused('invalid_exchange_transition', { reason: 'not_latest_submission' }), 'accept', names)).toBe('Northside Studio submitted a newer delivery since you opened the page, so nothing was accepted. Review the latest one below.')
    expect(conflictNotice(refused('invalid_exchange_transition', { reason: 'reminder_already_sent' }), 'remind', names)).toMatch(/^A reminder was already sent/)
    expect(conflictNotice(refused('business_role_required', null), 'request_changes', names)).toMatch(/^Only owners and administrators of Northstar Digital/)
  })
})

describe('reviewing a delivery', () => {
  it('accepts after a confirmation that names its effects, then reloads', async () => {
    let exchange = toReview()
    start({
      reply: ({ method, url }: MockRequest) => {
        if (method === 'get' && url === EXCHANGE) return { status: 200, data: exchange }
        if (method === 'post' && url === `${M2}/accept`) {
          const accepted = { ...theirSubmission(), decision: decision() }
          exchange = withMilestone(1, { status: 'accepted', latest_submission: accepted, review_due_at: FUTURE }, { milestones_accepted: 1 })
          return { status: 200, data: exchange.milestones[1] }
        }
        return undefined
      },
    })
    renderAt(`/exchanges/${EXCHANGE_ID}`)
    await screen.findByRole('list', { name: 'Milestones' })
    const second = milestone(2)
    expect(second).toHaveTextContent(/Review it by \d+ \w+ \d{4}\./)

    fireEvent.click(within(second).getByRole('button', { name: 'Accept' }))
    const dialog = screen.getByRole('dialog', { name: 'Accept “First monthly reconciliation”?' })
    expect(dialog).toHaveTextContent('Every account reconciled')
    expect(dialog).toHaveTextContent('It’s final and has effects under the agreement')
    expect(dialog).toHaveTextContent('The agreement uses “Transfer on payment and completion” (Exchange Terms 6.2): ownership of this work passes to Northstar Digital once it’s accepted and Northstar Digital has given Northside Studio everything it owes under the agreement.')
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Accept delivery' }))

    await waitFor(() => expect(api!.calls('post', `${M2}/accept`)).toHaveLength(1))
    expect(JSON.parse(api!.calls('post', `${M2}/accept`)[0][0].data as string)).toEqual({ submission_id: 'submission-2' })
    expect(await screen.findByText('“First monthly reconciliation” accepted.')).toBeInTheDocument()
    await waitFor(() => expect(within(milestone(2)).getByText('Accepted', { selector: '.match-pill' })).toBeInTheDocument())
    expect(within(milestone(2)).getByRole('article', { name: 'Delivery 1' })).toHaveTextContent('Accepted by Alex Morgan (Northstar Digital)')
    expect(within(milestone(2)).queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('needs a reason naming the unmet criteria before asking for changes', async () => {
    let exchange = toReview()
    start({
      reply: ({ method, url }: MockRequest) => {
        if (method === 'get' && url === EXCHANGE) return { status: 200, data: exchange }
        if (method === 'post' && url === `${M2}/request-changes`) {
          const decided = { ...theirSubmission(), decision: decision({ decision: 'changes_requested', reason: 'Two accounts are not reconciled.' }) }
          exchange = withMilestone(1, { status: 'changes_requested', latest_submission: decided })
          return { status: 200, data: exchange.milestones[1] }
        }
        return undefined
      },
    })
    renderAt(`/exchanges/${EXCHANGE_ID}`)
    await screen.findByRole('list', { name: 'Milestones' })
    fireEvent.click(within(milestone(2)).getByRole('button', { name: 'Ask for changes' }))
    const form = within(milestone(2)).getByRole('form', { name: 'Ask for changes' })
    expect(form).toHaveTextContent('Done when: Every account reconciled')
    const reason = within(form).getByLabelText(/^Which acceptance criteria aren’t met/)
    expect(reason).toHaveFocus()

    fireEvent.change(reason, { target: { value: '   ' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Ask for changes' }))
    expect(await within(form).findByText('Say which acceptance criteria the delivery doesn’t meet yet.')).toBeInTheDocument()
    expect(api!.calls('post', `${M2}/request-changes`)).toHaveLength(0)

    fireEvent.change(reason, { target: { value: ' Two accounts are not reconciled. ' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Ask for changes' }))
    await waitFor(() => expect(api!.calls('post', `${M2}/request-changes`)).toHaveLength(1))
    expect(JSON.parse(api!.calls('post', `${M2}/request-changes`)[0][0].data as string)).toEqual({ submission_id: 'submission-2', reason: 'Two accounts are not reconciled.' })
    expect(await screen.findByText('Changes requested on “First monthly reconciliation”. Northside Studio can now submit a revision.')).toBeInTheDocument()
    await waitFor(() => expect(within(milestone(2)).getByRole('article', { name: 'Delivery 1' })).toHaveTextContent('Changes requested by Alex Morgan (Northstar Digital)'))
    expect(within(milestone(2)).getByRole('article', { name: 'Delivery 1' })).toHaveTextContent('Two accounts are not reconciled.')
  })

  it('reloads with a red notice when a newer delivery arrived', async () => {
    start({
      exchange: toReview(),
      reply: ({ method, url }: MockRequest) =>
        method === 'post' && url === `${M2}/accept`
          ? { status: 409, data: apiErrorBody('invalid_exchange_transition', { entity: 'milestone', status: 'submitted', to: 'accepted', reason: 'not_latest_submission', latest_submission_id: 'submission-3' }) }
          : undefined,
    })
    renderAt(`/exchanges/${EXCHANGE_ID}`)
    await screen.findByRole('list', { name: 'Milestones' })
    fireEvent.click(within(milestone(2)).getByRole('button', { name: 'Accept' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Accept delivery' }))
    expect(await screen.findByText(/submitted a newer delivery since you opened the page, so nothing was accepted/)).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(api!.calls('get', EXCHANGE).length).toBeGreaterThanOrEqual(2))
  })

  it('shows members a lock line instead of the review buttons', async () => {
    start({ role: 'member', exchange: toReview() })
    renderAt(`/exchanges/${EXCHANGE_ID}`)
    await screen.findByRole('list', { name: 'Milestones' })
    expect(within(milestone(2)).queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument()
    expect(within(milestone(2)).queryByRole('button', { name: 'Ask for changes' })).not.toBeInTheDocument()
    expect(milestone(2)).toHaveTextContent('Only owners and administrators of Northstar Digital can accept a delivery or ask for changes.')
  })

  it('tells the reviewer when the reminder makes it count as accepted', async () => {
    const reminded = theirSubmission({ review_due_at: PAST, reminder: { id: 'r1', sent_by_user_id: 'user-9', sent_by_user_name: 'Dana Studio', sent_by_business_id: STUDIO_ID, sent_at: '2026-01-06T10:00:00Z', deemed_acceptance_at: FUTURE } })
    start({ exchange: toReview(reminded, { reminder_sent_at: '2026-01-06T10:00:00Z', deemed_acceptance_at: FUTURE }) })
    renderAt(`/exchanges/${EXCHANGE_ID}`)
    await screen.findByRole('list', { name: 'Milestones' })
    const second = milestone(2)
    expect(second).toHaveTextContent('Your review was due by')
    expect(second).toHaveTextContent(`If Northstar Digital doesn’t accept it or ask for changes by ${formatDayTime(FUTURE)}, BFB treats it as accepted under the agreement’s terms`)
    expect(within(second).getByRole('article', { name: 'Delivery 1' })).toHaveTextContent('Reminder sent by Dana Studio (Northside Studio)')
    // Deciding late is still allowed.
    expect(within(second).getByRole('button', { name: 'Accept' })).toBeInTheDocument()
  })
})

describe('reminders and deemed acceptance', () => {
  it('offers no reminder while the review period runs', async () => {
    start({ exchange: inReview() })
    renderAt(`/exchanges/${EXCHANGE_ID}`)
    await screen.findByRole('list', { name: 'Milestones' })
    expect(milestone(1)).toHaveTextContent('Northside Studio reviews it by')
    expect(within(milestone(1)).queryByRole('button', { name: 'Send a reminder' })).not.toBeInTheDocument()
    expect(within(milestone(1)).queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument()
  })

  it('sends a reminder after the deadline and shows the deemed-acceptance date', async () => {
    let exchange = inReview(mySubmission({ review_due_at: PAST }))
    start({
      reply: ({ method, url }: MockRequest) => {
        if (method === 'get' && url === EXCHANGE) return { status: 200, data: exchange }
        if (method === 'post' && url === `${M1}/remind`) {
          const reminder = { id: 'r1', sent_by_user_id: 'user-1', sent_by_user_name: 'Alex Morgan', sent_by_business_id: 'business-1', sent_at: '2026-01-06T10:00:00Z', deemed_acceptance_at: FUTURE }
          exchange = inReview(mySubmission({ review_due_at: PAST, reminder }), { reminder_sent_at: reminder.sent_at, deemed_acceptance_at: FUTURE })
          return { status: 200, data: exchange.milestones[0] }
        }
        return undefined
      },
    })
    renderAt(`/exchanges/${EXCHANGE_ID}`)
    await screen.findByRole('list', { name: 'Milestones' })
    expect(milestone(1)).toHaveTextContent('Northside Studio’s review was due by')
    expect(milestone(1)).toHaveTextContent('You can send one reminder.')
    fireEvent.click(within(milestone(1)).getByRole('button', { name: 'Send a reminder' }))

    await waitFor(() => expect(api!.calls('post', `${M1}/remind`)).toHaveLength(1))
    expect(await screen.findByText(`Reminder sent. Northside Studio sees it on this exchange. If Northside Studio doesn’t decide by ${formatDayTime(FUTURE)}, “Logo concepts” is treated as accepted.`)).toBeInTheDocument()
    await waitFor(() => expect(within(milestone(1)).queryByRole('button', { name: 'Send a reminder' })).not.toBeInTheDocument())
    expect(milestone(1)).toHaveTextContent(`If Northside Studio doesn’t accept it or ask for changes by ${formatDayTime(FUTURE)}, BFB treats it as accepted under the agreement’s terms`)
  })

  it('shows members of the delivering business a lock line for the reminder', async () => {
    start({ role: 'member', exchange: inReview(mySubmission({ review_due_at: PAST })) })
    renderAt(`/exchanges/${EXCHANGE_ID}`)
    await screen.findByRole('list', { name: 'Milestones' })
    expect(within(milestone(1)).queryByRole('button', { name: 'Send a reminder' })).not.toBeInTheDocument()
    expect(milestone(1)).toHaveTextContent('Only owners and administrators of Northstar Digital can send a reminder.')
  })

  it('shows deemed acceptance as accepted by BFB under the agreement’s terms, on the milestone and in history', async () => {
    const deemed = mySubmission({ review_due_at: PAST, decision: decision({ decision: 'deemed_accepted', decided_by_type: 'system', decided_by_user_id: null, decided_by_user_name: null, decided_by_business_id: null }) })
    start({
      exchange: withMilestone(0, { status: 'accepted', latest_submission: deemed, review_due_at: PAST }, { milestones_accepted: 1 }),
      history: [event({ id: 'e2', type: 'milestone.deemed_accepted', actor_type: 'system', actor_user_name: null, actor_business_id: null, from_status: 'submitted', to_status: 'accepted' }), activationEvent()],
    })
    renderAt(`/exchanges/${EXCHANGE_ID}`)
    await screen.findByRole('list', { name: 'Milestones' })
    const card = within(milestone(1)).getByRole('article', { name: 'Delivery 1' })
    expect(card).toHaveTextContent('Treated as accepted by BFB under the agreement’s terms')
    expect(card).toHaveTextContent('No decision came within 5 business days of the reminder')
    const history = await screen.findByRole('list', { name: 'Exchange history' })
    expect(within(history).getAllByRole('listitem')[0]).toHaveTextContent(/Treated as accepted under the agreement’s terms.*BFB ·/)
  })
})
