import { useEffect, useState } from 'react'
import { History } from 'lucide-react'

import { showErrorToast } from '../../components/feedback'
import { toApiError } from '../../lib/api/errors'
import { formatDateTime, historyActor, historyTitle, type Names } from './exchangeCopy'
import { getExchangeHistory, type Exchange, type ExchangeEvent } from './exchangesApi'

type HistoryState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; items: ExchangeEvent[]; nextCursor: string | null; loadingMore: boolean }

/**
 * Everything that happened in the exchange, newest first, from the history endpoint: what,
 * who (a person and their business, or BFB itself), when, and the milestone it concerns.
 * `reloadKey` reloads it after an action on the page.
 */
export function ExchangeHistory({ exchange, businessId, names, reloadKey }: { exchange: Exchange; businessId: string; names: Names; reloadKey: number }) {
  const [state, setState] = useState<HistoryState>({ kind: 'loading' })
  const [retryKey, setRetryKey] = useState(0)

  useEffect(() => {
    let live = true
    getExchangeHistory(businessId, exchange.id)
      .then((page) => {
        if (live) setState({ kind: 'ready', items: page.items, nextCursor: page.next_cursor, loadingMore: false })
      })
      .catch(() => {
        if (live) setState((current) => (current.kind === 'ready' ? current : { kind: 'error' }))
      })
    return () => {
      live = false
    }
  }, [businessId, exchange.id, reloadKey, retryKey])

  const loadMore = async () => {
    if (state.kind !== 'ready' || !state.nextCursor) return
    setState({ ...state, loadingMore: true })
    try {
      const page = await getExchangeHistory(businessId, exchange.id, state.nextCursor)
      setState((current) =>
        current.kind === 'ready'
          ? { kind: 'ready', items: [...current.items, ...page.items.filter((item) => !current.items.some((seen) => seen.id === item.id))], nextCursor: page.next_cursor, loadingMore: false }
          : current,
      )
    } catch (error) {
      setState((current) => (current.kind === 'ready' ? { ...current, loadingMore: false } : current))
      showErrorToast(`We couldn’t load more history. ${toApiError(error).userMessage}`)
    }
  }

  const milestones = new Map(exchange.milestones.map((milestone) => [milestone.id, milestone]))

  return (
    <section className="match-panel" aria-labelledby="exchange-history-title">
      <div className="match-panel-head">
        <h2 id="exchange-history-title">History</h2>
        <p>Everything that happened in this exchange, newest first. Both businesses see the same history.</p>
      </div>
      <div className="match-panel-body">
        {state.kind === 'loading' ? (
          <p className="exchange-readonly-note" role="status">Loading history…</p>
        ) : state.kind === 'error' ? (
          <p className="exchange-readonly-note" role="alert">
            We couldn’t load the history.{' '}
            <button type="button" className="text-button exchange-inline-button" onClick={() => { setState({ kind: 'loading' }); setRetryKey((key) => key + 1) }}>Try again</button>
          </p>
        ) : state.items.length === 0 ? (
          <p className="exchange-readonly-note">Nothing has happened in this exchange yet.</p>
        ) : (
          <>
            <ol className="exchange-history" aria-label="Exchange history">
              {state.items.map((entry) => {
                const milestone = entry.milestone_id ? milestones.get(entry.milestone_id) : undefined
                return (
                  <li key={entry.id} className={`exchange-history-entry exchange-history-${entry.actor_type}`}>
                    <span className="exchange-history-dot" aria-hidden="true" />
                    <div>
                      <strong>{historyTitle(entry, exchange.revision_limit)}</strong>
                      {entry.milestone_id && (
                        <span className="exchange-history-milestone">
                          {milestone ? `Milestone ${milestone.sequence} · ${milestone.title}` : 'A milestone'}
                        </span>
                      )}
                      <small>
                        {historyActor(entry, businessId, names)} · <time dateTime={entry.occurred_at}>{formatDateTime(entry.occurred_at)}</time>
                      </small>
                    </div>
                  </li>
                )
              })}
            </ol>
            {state.nextCursor && (
              <button type="button" className="button button-secondary button-small" onClick={() => void loadMore()} disabled={state.loadingMore}>
                <History size={14} aria-hidden="true" /> {state.loadingMore ? 'Loading…' : 'Show earlier history'}
              </button>
            )}
          </>
        )}
      </div>
    </section>
  )
}
