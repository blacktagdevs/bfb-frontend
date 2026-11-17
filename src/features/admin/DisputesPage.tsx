import { useEffect, useState } from 'react'
import { ArrowRight, ChevronLeft, ChevronRight, MessageSquareWarning } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'

import { paths } from '../../app/router/paths'
import { EmptyState, ErrorState, LoadingState } from '../../components/feedback'
import { toApiError } from '../../lib/api/errors'
import { DISPUTE_CATEGORY_LABELS, DISPUTE_RESOLUTION_LABELS, EXCHANGE_STATUS_LABELS } from '../exchanges/exchangeCopy'
import { AdminTabs } from './AdminTabs'
import { formatDateTime } from './adminDisplay'
import { DISPUTES_PAGE_SIZE, listAdminDisputes, type AdminDispute, type AdminDisputeList, type DisputeStatus } from './disputesApi'
import { formatDate } from './matchDisplay'
import './Admin.css'

const STATUSES: { value: DisputeStatus; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Closed' },
]

/** `?status=` (open or closed) and `?page=`. Unknown values are ignored. */
export function readDisputeFilters(params: URLSearchParams): { status?: DisputeStatus; page: number } {
  const status = params.get('status')
  const page = Number(params.get('page'))
  return {
    ...(status === 'open' || status === 'closed' ? { status } : {}),
    page: Number.isInteger(page) && page > 1 ? page : 1,
  }
}

/** "Northstar Digital & Northside Studio". */
export function disputeBusinesses(dispute: Pick<AdminDispute, 'exchange'>): string {
  return `${dispute.exchange.business_a.display_name} & ${dispute.exchange.business_b.display_name}`
}

/** The business that opened it, or responded: by ID within the dispute's exchange. */
export function businessName(dispute: Pick<AdminDispute, 'exchange'>, businessId: string | null): string {
  const { business_a: a, business_b: b } = dispute.exchange
  return businessId === a.id ? a.display_name : businessId === b.id ? b.display_name : 'a former business'
}

export function DisputeStatusBadge({ status }: { status: DisputeStatus }) {
  return <span className={`admin-status dispute-status-${status}`}>{status === 'open' ? 'Open' : 'Closed'}</span>
}

/** `/admin/disputes`: every dispute, open ones first (oldest first, a queue), 20 per page. */
export function DisputesPage() {
  const [params, setParams] = useSearchParams()
  const { status, page } = readDisputeFilters(params)
  const [list, setList] = useState<AdminDisputeList | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let live = true
    setList(null)
    setError(null)
    listAdminDisputes({ status, offset: (page - 1) * DISPUTES_PAGE_SIZE })
      .then((result) => {
        if (live) setList(result)
      })
      .catch((caught: unknown) => {
        if (live) setError(toApiError(caught))
      })
    return () => {
      live = false
    }
  }, [status, page, reloadKey])

  const setStatus = (value: string) => setParams(value ? { status: value } : {})
  const goToPage = (next: number) => {
    const nextParams = new URLSearchParams(params)
    if (next > 1) nextParams.set('page', String(next))
    else nextParams.delete('page')
    setParams(nextParams)
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <span>ADMIN · DISPUTES</span>
          <h1>Disputes between businesses.</h1>
          <p>Open disputes first, oldest first. BFB records disputes and keeps the evidence; it doesn’t decide who is right (Exchange Terms 15.6).</p>
        </div>
      </div>
      <AdminTabs />
      <div className="admin-filters" role="group" aria-label="Filter disputes">
        <label className="admin-filter">
          <span>Status</span>
          <select value={status ?? ''} onChange={(event) => setStatus(event.target.value)}>
            <option value="">Open and closed</option>
            {STATUSES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
      </div>
      {error ? (
        <ErrorState title="We couldn’t load disputes" error={error} onRetry={() => setReloadKey((key) => key + 1)} />
      ) : !list ? (
        <LoadingState label="Loading disputes…" />
      ) : list.total === 0 ? (
        <EmptyState
          className="admin-card"
          icon={MessageSquareWarning}
          title={status === 'open' ? 'No open disputes' : status === 'closed' ? 'No closed disputes yet' : 'No disputes yet'}
          description="A dispute appears here as soon as a business reports a problem with an exchange."
        />
      ) : (
        <section className="admin-card" aria-labelledby="admin-disputes-title">
          <div className="admin-card-head">
            <h2 id="admin-disputes-title">{status === 'open' ? 'Open disputes' : status === 'closed' ? 'Closed disputes' : 'All disputes'}</h2>
            <p>{list.total === 1 ? '1 dispute' : `${list.total} disputes`}</p>
          </div>
          <ul className="admin-queue" aria-label="Disputes">
            {list.items.map((dispute) => <DisputeRow key={dispute.id} dispute={dispute} />)}
          </ul>
          <Pagination list={list} page={page} goToPage={goToPage} />
        </section>
      )}
    </>
  )
}

function DisputeRow({ dispute }: { dispute: AdminDispute }) {
  const names = disputeBusinesses(dispute)
  const opener = `${dispute.opened_by_user_name ?? 'A former team member'} (${businessName(dispute, dispute.opened_by_business_id)})`
  return (
    <li className="admin-queue-row">
      <div className="match-row-marks" aria-hidden="true"><MessageSquareWarning size={18} /></div>
      <div className="admin-queue-main">
        <strong>{dispute.exchange.business_a.display_name} <span className="match-row-amp">&amp;</span> {dispute.exchange.business_b.display_name}</strong>
        <span>{DISPUTE_CATEGORY_LABELS[dispute.category]}</span>
        <small>
          Opened {formatDateTime(dispute.opened_at)} by {opener} · {dispute.responded_at ? 'Response received' : 'No response yet'}
          {dispute.closed_at ? ` · Closed ${formatDate(dispute.closed_at)}` : ''}
        </small>
        <div className="admin-tags">
          <DisputeStatusBadge status={dispute.status} />
          {dispute.resolution && <span className="admin-tag">{DISPUTE_RESOLUTION_LABELS[dispute.resolution]}</span>}
          <span className="admin-tag">Exchange {EXCHANGE_STATUS_LABELS[dispute.exchange.status].toLowerCase()}</span>
        </div>
      </div>
      <div className="admin-queue-side">
        <Link className="button button-secondary button-small" to={paths.adminDispute(dispute.id)} aria-label={`Open dispute between ${names}`}>
          Open <ArrowRight size={15} aria-hidden="true" />
        </Link>
      </div>
    </li>
  )
}

function Pagination({ list, page, goToPage }: { list: AdminDisputeList; page: number; goToPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(list.total / DISPUTES_PAGE_SIZE))
  if (pages <= 1) return null
  return (
    <nav className="admin-pagination" aria-label="Dispute pages">
      <span>Showing {list.offset + 1}–{list.offset + list.items.length} of {list.total}</span>
      <div>
        <button type="button" className="button button-secondary button-small" onClick={() => goToPage(page - 1)} disabled={page <= 1}>
          <ChevronLeft size={15} aria-hidden="true" /> Previous
        </button>
        <span aria-current="page">Page {page} of {pages}</span>
        <button type="button" className="button button-secondary button-small" onClick={() => goToPage(page + 1)} disabled={page >= pages}>
          Next <ChevronRight size={15} aria-hidden="true" />
        </button>
      </div>
    </nav>
  )
}
