import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from '../../App'
import { useToastStore } from '../../components/feedback'
import { ACCESS_TOKEN_KEY, clearStoredSession, REFRESH_TOKEN_KEY } from '../../lib/auth/tokens'
import { useSessionStore } from '../../stores/session'
import { apiErrorBody, mockApi, type MockRequest } from '../../test/mockApi'
import { EXCHANGE, EXCHANGE_ID, exchangeDetail, proposalServer, type ProposalServerOptions } from '../../test/proposalServer'
import { formatBytes, submissionLabel } from './exchangeCopy'
import type { Exchange, ExchangeMilestone, Submission } from './exchangesApi'

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

const UPLOADS = '/businesses/business-1/uploads'
const SUBMISSIONS_1 = `${EXCHANGE}/milestones/milestone-1/submissions`
const HISTORY = `${EXCHANGE}/history`

function submission(overrides: Partial<Submission> = {}): Submission {
  return {
    id: 'submission-1',
    exchange_id: EXCHANGE_ID,
    milestone_id: 'milestone-1',
    number: 1,
    note: 'Three logo directions with the rationale for each.',
    links: [{ url: 'https://www.figma.com/file/abc', label: 'Figma file' }],
    attachments: [{ upload_id: 'upload-1', original_filename: 'concepts.pdf', content_type: 'application/pdf', size_bytes: 482133 }],
    submitted_by_user_id: 'user-1',
    submitted_by_user_name: 'Alex Morgan',
    submitted_by_business_id: 'business-1',
    submitted_at: '2026-12-01T10:00:00Z',
    is_revision: false,
    revision_number: null,
    beyond_revision_limit: false,
    review_due_at: '2026-12-06T10:00:00Z',
    ...overrides,
  }
}

function withFirst(change: Partial<ExchangeMilestone>, overrides: Partial<Exchange> = {}): Exchange {
  const base = exchangeDetail(overrides)
  return { ...base, milestones: base.milestones.map((milestone, at) => (at === 0 ? { ...milestone, ...change } : milestone)) }
}

const milestone = (n: number) => screen.getByRole('listitem', { name: new RegExp(`^Milestone ${n}:`) })

function chooseFiles(scope: HTMLElement, files: File[]) {
  const input = within(scope).getByLabelText('Choose files to deliver') as HTMLInputElement
  Object.defineProperty(input, 'files', { value: files, configurable: true })
  fireEvent.change(input)
}

function fakeTab() {
  const tab = { opener: {} as unknown, location: { href: '' }, close: vi.fn() }
  const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window)
  return { tab, open }
}

describe('delivery copy', () => {
  it('labels deliveries and revisions against the limit', () => {
    expect(submissionLabel(submission(), 2)).toBe('Delivery 1')
    expect(submissionLabel(submission({ number: 2, is_revision: true, revision_number: 1 }), 2)).toBe('Revision 1 of 2')
    expect(submissionLabel(submission({ number: 4, is_revision: true, revision_number: 3, beyond_revision_limit: true }), 2)).toBe('Revision 3 (beyond the 2 agreed)')
    expect(formatBytes(482133)).toBe('471 KB')
    expect(formatBytes(2 * 1024 * 1024)).toBe('2.0 MB')
  })
})

describe('submitting a delivery', () => {
  it('uploads files, adds links and submits, then shows the delivery and reloads', async () => {
    let exchange = exchangeDetail()
    let uploads = 0
    start({
      reply: (request: MockRequest) => {
        const { method, url } = request
        if (method === 'get' && url === EXCHANGE) return { status: 200, data: exchange }
        if (method === 'post' && url === UPLOADS) {
          uploads += 1
          const form = request.body as FormData
          expect(form.get('category')).toBe('exchange_delivery')
          return { status: 201, data: { id: `upload-${uploads}`, category: 'exchange_delivery' } }
        }
        if (method === 'post' && url === SUBMISSIONS_1) {
          const created = submission({ attachments: [] })
          exchange = withFirst({ status: 'submitted', latest_submission: created, review_due_at: created.review_due_at })
          return { status: 201, data: created }
        }
        return undefined
      },
    })
    renderAt(`/exchanges/${EXCHANGE_ID}`)

    await screen.findByRole('list', { name: 'Milestones' })
    const first = milestone(1)
    fireEvent.click(within(first).getByRole('button', { name: 'Submit delivery' }))
    const form = within(first).getByRole('form', { name: 'Submit delivery' })
    expect(form).toHaveTextContent('Northside Studio reviews it against “Done when” and has 5 days')

    fireEvent.change(within(form).getByLabelText(/^Note/), { target: { value: '  Three logo directions with the rationale for each.  ' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Add a link' }))
    fireEvent.change(within(form).getByLabelText('Link 1 address'), { target: { value: 'https://www.figma.com/file/abc' } })
    fireEvent.change(within(form).getByLabelText('Link 1 label (optional)'), { target: { value: 'Figma file' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Add a link' }))
    // An empty extra link row is left out.
    chooseFiles(form, [new File(['%PDF'], 'concepts.pdf', { type: 'application/pdf' }), new File(['png'], 'mark.png', { type: 'image/png' })])
    await waitFor(() => expect(within(form).getAllByText(/uploaded$/)).toHaveLength(2))
    expect(within(form).getByRole('group', { name: 'Files 2 of 10' })).toBeInTheDocument()

    fireEvent.click(within(form).getByRole('button', { name: 'Submit delivery' }))
    await waitFor(() => expect(api!.calls('post', SUBMISSIONS_1)).toHaveLength(1))
    expect(api!.calls('post', SUBMISSIONS_1)[0][0].data && JSON.parse(api!.calls('post', SUBMISSIONS_1)[0][0].data as string)).toEqual({
      note: 'Three logo directions with the rationale for each.',
      links: [{ url: 'https://www.figma.com/file/abc', label: 'Figma file' }],
      attachment_upload_ids: ['upload-1', 'upload-2'],
    })

    expect(await screen.findByText('Delivery submitted. Northside Studio has until 6 Dec 2026 to review it.')).toBeInTheDocument()
    await waitFor(() => expect(within(milestone(1)).getByRole('article', { name: 'Delivery 1' })).toBeInTheDocument())
    expect(within(milestone(1)).getByText('Submitted')).toBeInTheDocument()
    expect(within(milestone(1)).queryByRole('button', { name: /Submit/ })).not.toBeInTheDocument()
    expect(api!.calls('get', HISTORY).length).toBeGreaterThanOrEqual(2)
  })

  it('requires a note and checks links and files before submitting', async () => {
    start()
    renderAt(`/exchanges/${EXCHANGE_ID}`)
    await screen.findByRole('list', { name: 'Milestones' })
    fireEvent.click(within(milestone(1)).getByRole('button', { name: 'Submit delivery' }))
    const form = within(milestone(1)).getByRole('form', { name: 'Submit delivery' })

    fireEvent.click(within(form).getByRole('button', { name: 'Add a link' }))
    fireEvent.change(within(form).getByLabelText('Link 1 address'), { target: { value: 'figma.com/file' } })
    chooseFiles(form, [new File(['zip'], 'source.zip', { type: 'application/zip' })])
    expect(within(form).getByText(/source\.zip: choose a JPEG, PNG or WebP image, or a PDF/)).toBeInTheDocument()

    fireEvent.click(within(form).getByRole('button', { name: 'Submit delivery' }))
    expect(within(form).getByText('Write a note on what you delivered.')).toBeInTheDocument()
    expect(within(form).getByText(/Enter a full web address/)).toBeInTheDocument()
    expect(within(form).getByRole('alert')).toHaveTextContent('Remove the files that couldn’t be attached')
    expect(api!.calls('post', UPLOADS)).toHaveLength(0)
    expect(api!.calls('post', SUBMISSIONS_1)).toHaveLength(0)

    fireEvent.click(within(form).getByRole('button', { name: 'Cancel' }))
    expect(within(milestone(1)).queryByRole('form')).not.toBeInTheDocument()
  })

  it('lets a member deliver, and never shows the form to the receiving business', async () => {
    start({ role: 'member', exchange: withFirst({ status: 'submitted', latest_submission: submission() }) })
    renderAt(`/exchanges/${EXCHANGE_ID}`)
    await screen.findByRole('list', { name: 'Milestones' })

    // Milestone 1 is submitted: nothing to submit. Milestone 2 is Northside Studio's.
    expect(within(milestone(1)).queryByRole('button', { name: /Submit/ })).not.toBeInTheDocument()
    expect(within(milestone(2)).queryByRole('button', { name: /Submit/ })).not.toBeInTheDocument()
    expect(within(milestone(3)).getByRole('button', { name: 'Submit delivery' })).toBeInTheDocument()
    expect(milestone(3)).toHaveTextContent('Any member of Northstar Digital can submit it.')
    cleanup()
    api?.restore()

    // As the receiving business (the delivery is Northside Studio's to make).
    start({ exchange: withFirst({ responsible_business_id: 'someone-else', receiving_business_id: 'business-1', status: 'submitted', latest_submission: submission({ submitted_by_business_id: 'someone-else', submitted_by_user_name: 'Dana Studio' }) }) })
    renderAt(`/exchanges/${EXCHANGE_ID}`)
    await screen.findByRole('list', { name: 'Milestones' })
    expect(within(milestone(1)).getByRole('article', { name: 'Delivery 1' })).toHaveTextContent('Dana Studio (Northside Studio)')
    expect(within(milestone(1)).queryByRole('button', { name: /Submit/ })).not.toBeInTheDocument()
    expect(milestone(1)).toHaveTextContent('Accepting a delivery or asking for changes on BFB comes in a later release.')
  })

  it('resubmits after changes were asked for, as a revision, and shows earlier deliveries', async () => {
    const first = submission()
    const revision = submission({ id: 'submission-2', number: 2, is_revision: true, revision_number: 1, note: 'Darker palette.', attachments: [], links: [] })
    let exchange = withFirst({ status: 'changes_requested', latest_submission: first, revisions_used: 0 })
    start({
      reply: ({ method, url }) => {
        if (method === 'get' && url === EXCHANGE) return { status: 200, data: exchange }
        if (method === 'post' && url === SUBMISSIONS_1) {
          exchange = withFirst({ status: 'submitted', latest_submission: revision, revisions_used: 1 })
          return { status: 201, data: revision }
        }
        if (method === 'get' && url === SUBMISSIONS_1) return { status: 200, data: { items: [revision, first] } }
        return undefined
      },
    })
    renderAt(`/exchanges/${EXCHANGE_ID}`)
    await screen.findByRole('list', { name: 'Milestones' })
    expect(milestone(1)).toHaveTextContent('Changes requested')
    expect(milestone(1)).toHaveTextContent('Revisions used: 0 of 2')

    fireEvent.click(within(milestone(1)).getByRole('button', { name: 'Submit revision' }))
    const form = within(milestone(1)).getByRole('form', { name: 'Revision 1 of 2' })
    expect(within(form).queryByRole('note')).not.toBeInTheDocument()
    fireEvent.change(within(form).getByLabelText(/^Note/), { target: { value: 'Darker palette.' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Submit revision' }))

    expect(await screen.findByText(/^Revision submitted\./)).toBeInTheDocument()
    await waitFor(() => expect(within(milestone(1)).getByRole('article', { name: 'Revision 1 of 2' })).toBeInTheDocument())
    fireEvent.click(within(milestone(1)).getByRole('button', { name: 'Show the earlier delivery' }))
    expect(await within(milestone(1)).findByRole('article', { name: 'Delivery 1' })).toBeInTheDocument()
    expect(within(milestone(1)).getAllByRole('article')).toHaveLength(2)
  })

  it('says plainly when a revision goes beyond the agreed limit', async () => {
    start({
      exchange: withFirst({
        status: 'changes_requested',
        revisions_used: 2,
        latest_submission: submission({ id: 'submission-3', number: 3, is_revision: true, revision_number: 2 }),
      }),
    })
    renderAt(`/exchanges/${EXCHANGE_ID}`)
    await screen.findByRole('list', { name: 'Milestones' })
    fireEvent.click(within(milestone(1)).getByRole('button', { name: 'Submit revision' }))
    const form = within(milestone(1)).getByRole('form', { name: 'Revision 3 (beyond the 2 agreed)' })
    expect(within(form).getByRole('note')).toHaveTextContent('You’ve made the 2 rounds of changes the agreement includes, so it doesn’t require this revision. You can still submit one.')
    cleanup()
    api?.restore()

    start({ exchange: withFirst({ status: 'submitted', revisions_used: 3, latest_submission: submission({ number: 4, is_revision: true, revision_number: 3, beyond_revision_limit: true }) }) })
    renderAt(`/exchanges/${EXCHANGE_ID}`)
    const article = await screen.findByRole('article', { name: 'Revision 3 (beyond the 2 agreed)' })
    expect(article).toHaveTextContent('The agreement includes 2 rounds of changes, so it didn’t require Northstar Digital to make this revision.')
    expect(milestone(1)).toHaveTextContent('Revisions used: 3, beyond the 2 agreed')
  })

  it('reloads with a notice when the milestone changed meanwhile', async () => {
    start({ reply: ({ method, url }) => (method === 'post' && url === SUBMISSIONS_1 ? { status: 409, data: apiErrorBody('invalid_exchange_transition', { entity: 'milestone', status: 'submitted', to: 'submitted', reason: 'not_allowed' }) } : undefined) })
    renderAt(`/exchanges/${EXCHANGE_ID}`)
    await screen.findByRole('list', { name: 'Milestones' })
    fireEvent.click(within(milestone(1)).getByRole('button', { name: 'Submit delivery' }))
    fireEvent.change(within(milestone(1)).getByLabelText(/^Note/), { target: { value: 'Done.' } })
    fireEvent.click(within(milestone(1)).getByRole('form', { name: 'Submit delivery' }).querySelector('button[type="submit"]')!)

    expect(await screen.findByText(/This milestone or exchange changed since you opened it/)).toBeInTheDocument()
    await waitFor(() => expect(api!.calls('get', EXCHANGE)).toHaveLength(2))
  })
})

describe('downloading delivered files', () => {
  const ATTACHMENT = `${SUBMISSIONS_1}/submission-1/attachments/upload-1`

  it('asks for a fresh link on every click and opens it in a new tab', async () => {
    let n = 0
    start({
      exchange: withFirst({ status: 'submitted', latest_submission: submission() }),
      reply: ({ method, url }) => {
        if (method === 'get' && url === ATTACHMENT) {
          n += 1
          return { status: 200, data: { upload_id: 'upload-1', original_filename: 'concepts.pdf', content_type: 'application/pdf', size_bytes: 482133, url: `http://files.example/concepts.pdf?sig=${n}`, url_expires_at: '2026-12-01T10:15:00Z' } }
        }
        return undefined
      },
    })
    renderAt(`/exchanges/${EXCHANGE_ID}`)
    const article = await screen.findByRole('article', { name: 'Delivery 1' })
    expect(article).toHaveTextContent('Three logo directions')
    expect(within(article).getByRole('link', { name: 'Figma file' })).toHaveAttribute('href', 'https://www.figma.com/file/abc')
    expect(within(article).getByRole('link', { name: 'Figma file' })).toHaveAttribute('rel', 'noopener noreferrer')
    expect(api!.calls('get', ATTACHMENT)).toHaveLength(0)

    const { tab, open } = fakeTab()
    const button = within(article).getByRole('button', { name: 'Download concepts.pdf (opens in a new tab)' })
    expect(button).toHaveTextContent('471 KB')
    fireEvent.click(button)
    await waitFor(() => expect(tab.location.href).toBe('http://files.example/concepts.pdf?sig=1'))
    expect(open).toHaveBeenCalledWith('', '_blank')
    expect(tab.opener).toBeNull()
    await waitFor(() => expect(button).not.toBeDisabled())
    fireEvent.click(button)
    await waitFor(() => expect(tab.location.href).toBe('http://files.example/concepts.pdf?sig=2'))
  })

  it('closes the tab and says so when a link cannot be fetched', async () => {
    start({
      exchange: withFirst({ status: 'submitted', latest_submission: submission() }),
      reply: ({ method, url }) => (method === 'get' && url === ATTACHMENT ? { status: 500, data: apiErrorBody('internal_error') } : undefined),
    })
    renderAt(`/exchanges/${EXCHANGE_ID}`)
    const { tab } = fakeTab()
    fireEvent.click(await screen.findByRole('button', { name: 'Download concepts.pdf (opens in a new tab)' }))
    expect(await screen.findByText(/We couldn’t open concepts.pdf/)).toBeInTheDocument()
    expect(tab.close).toHaveBeenCalled()
  })
})
