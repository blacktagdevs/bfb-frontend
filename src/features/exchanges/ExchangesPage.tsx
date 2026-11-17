import { useEffect, useState } from 'react'
import { ArrowRight, Handshake, ScrollText } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'

import { paths } from '../../app/router/paths'
import { EmptyState, ErrorState, LoadingState, showErrorToast } from '../../components/feedback'
import { toApiError } from '../../lib/api/errors'
import { useActiveBusiness } from '../../lib/businesses/useActiveBusiness'
import { BusinessLogo } from '../businesses/BusinessLogo'
import { formatLocation } from '../businesses/profileLabels'
import { formatMatchDate } from '../matching/matchInboxDisplay'
import { EXCHANGE_STATUS_LABELS, milestoneCount } from './exchangeCopy'
import { ProgressBar } from './ProgressBar'
import { listExchanges, type ExchangeStatus, type ExchangeSummary } from './exchangesApi'
import './ExchangesPage.css'

type Tab = 'Active' | 'Completed'

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; error: unknown }
  | { kind: 'ready'; items: ExchangeSummary[]; nextCursor: string | null; loadingMore: boolean }

/** One status's exchanges, newest first, with "Load more". */
function useExchangePages(businessId: string, status: ExchangeStatus) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let live = true
    setState({ kind: 'loading' })
    listExchanges(businessId, status)
      .then((page) => {
        if (live) setState({ kind: 'ready', items: page.items, nextCursor: page.next_cursor, loadingMore: false })
      })
      .catch((error: unknown) => {
        if (live) setState({ kind: 'error', error })
      })
    return () => {
      live = false
    }
  }, [businessId, status, reloadKey])

  const loadMore = async () => {
    if (state.kind !== 'ready' || !state.nextCursor) return
    setState({ ...state, loadingMore: true })
    try {
      const page = await listExchanges(businessId, status, { cursor: state.nextCursor })
      setState((current) =>
        current.kind === 'ready'
          ? { kind: 'ready', items: [...current.items, ...page.items.filter((item) => !current.items.some((seen) => seen.id === item.id))], nextCursor: page.next_cursor, loadingMore: false }
          : current,
      )
    } catch (error) {
      setState((current) => (current.kind === 'ready' ? { ...current, loadingMore: false } : current))
      showErrorToast(`We couldn’t load more exchanges. ${toApiError(error).userMessage}`)
    }
  }

  const count = state.kind === 'ready' ? `${state.items.length}${state.nextCursor ? '+' : ''}` : null
  return { state, count, loadMore, retry: () => setReloadKey((key) => key + 1) }
}

/**
 * `/exchanges`: the active business's exchanges, in the prototype's cards, under Active and
 * Completed tabs (`?tab=completed` opens the second).
 */
export function ExchangesPage() {
  const business = useActiveBusiness()
  const [params, setParams] = useSearchParams()
  const tab: Tab = params.get('tab') === 'completed' ? 'Completed' : 'Active'
  const active = useExchangePages(business.id, 'active')
  const completed = useExchangePages(business.id, 'completed')
  const lists: Record<Tab, ReturnType<typeof useExchangePages>> = { Active: active, Completed: completed }
  const { state, loadMore, retry } = lists[tab]

  return (
    <>
      <div className="page-heading">
        <div><span>EXCHANGES</span><h1>Keep every trade moving.</h1><p>Every exchange both businesses signed, with the milestones each one delivers.</p></div>
        <Link className="button button-secondary" to={paths.agreements}><ScrollText size={16} aria-hidden="true" /> Agreements</Link>
      </div>
      <div className="exchange-tabs" role="tablist" aria-label="Exchanges">
        {(['Active', 'Completed'] as const).map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            id={`exchange-tab-${item}`}
            aria-selected={tab === item}
            aria-controls="exchange-tab-panel"
            className={tab === item ? 'active' : ''}
            onClick={() => setParams(item === 'Completed' ? { tab: 'completed' } : {}, { replace: true })}
          >
            {item} {lists[item].count !== null && <span>{lists[item].count}</span>}
          </button>
        ))}
      </div>
      <div id="exchange-tab-panel" role="tabpanel" aria-labelledby={`exchange-tab-${tab}`}>
        {state.kind === 'loading' ? (
          <LoadingState label="Loading exchanges…" />
        ) : state.kind === 'error' ? (
          <ErrorState title="We couldn’t load your exchanges" error={state.error} onRetry={retry} />
        ) : state.items.length === 0 ? (
          tab === 'Completed' ? (
            <EmptyState icon={Handshake} title="No completed exchanges yet" description="An exchange moves here once every milestone is accepted and both businesses confirm it is complete." />
          ) : (
            <EmptyState
              icon={Handshake}
              title="No active exchanges yet"
              description="An exchange starts when both businesses sign its agreement. Agreements waiting for signatures are on the Agreements page."
              action={<Link className="button button-secondary button-small" to={paths.agreements}>See your agreements</Link>}
            />
          )
        ) : (
          <>
            <ul className="exchange-page-list" aria-label={`${tab} exchanges`}>
              {state.items.map((exchange) => <ExchangeCard key={exchange.id} exchange={exchange} />)}
            </ul>
            {state.nextCursor && (
              <div className="match-more">
                <button type="button" className="button button-secondary" onClick={() => void loadMore()} disabled={state.loadingMore}>
                  {state.loadingMore ? 'Loading…' : 'Load more'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </>
  )
}

function ExchangeCard({ exchange }: { exchange: ExchangeSummary }) {
  const other = exchange.other_business
  const location = formatLocation(other)
  const completed = exchange.status === 'completed'
  return (
    <li className="exchange-page-card">
      <div className="exchange-card-business">
        <BusinessLogo business={other} />
        <div>
          <span>{other.display_name}</span>
          <strong>Business exchange with {other.display_name}</strong>
          <small>{location ? `${location} · ` : ''}{completed ? `Completed ${formatMatchDate(exchange.updated_at)}` : `Active since ${formatMatchDate(exchange.activated_at)}`}</small>
        </div>
        <span className={`status ${completed ? 'status-complete' : 'status-progress'}`}>{EXCHANGE_STATUS_LABELS[exchange.status]}</span>
      </div>
      <dl className="exchange-trade-summary exchange-facts">
        <div><dt>MILESTONES</dt><dd>{milestoneCount(exchange.milestone_count)}, {exchange.milestones_accepted} accepted</dd></div>
        {completed ? (
          <div><dt>COMPLETED</dt><dd>{formatMatchDate(exchange.updated_at)}</dd></div>
        ) : (
          <div><dt>NEXT DUE</dt><dd>{exchange.next_due_date ? formatMatchDate(exchange.next_due_date) : 'Nothing due'}</dd></div>
        )}
        <div><dt>ACTIVE SINCE</dt><dd>{formatMatchDate(exchange.activated_at)}</dd></div>
        <div><dt>AGREEMENT</dt><dd>Signed by both</dd></div>
      </dl>
      <ProgressBar accepted={exchange.milestones_accepted} count={exchange.milestone_count} className="exchange-card-progress" />
      <div className="exchange-card-actions">
        <Link className="button button-secondary" to={paths.agreement(exchange.agreement_id)}>Signed agreement</Link>
        <Link className="button button-primary" to={paths.exchange(exchange.id)} aria-label={`View ${completed ? 'completed ' : ''}exchange with ${other.display_name}`}>View details <ArrowRight size={15} aria-hidden="true" /></Link>
      </div>
    </li>
  )
}
