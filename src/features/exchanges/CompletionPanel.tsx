import { useEffect, useId, useRef, useState } from 'react'
import { CircleCheckBig, FileCheck2, FileDown, Flag, Lock, Undo2, X } from 'lucide-react'

import { showErrorToast } from '../../components/feedback'
import { toApiError, type ApiError } from '../../lib/api/errors'
import { formatMatchDate } from '../matching/matchInboxDisplay'
import { blockersSentence, formatDateTime, milestoneCount, type CompletionAction, type Names } from './exchangeCopy'
import { confirmCompletion, getCompletionRecord, requestCompletion, withdrawCompletion, type Exchange } from './exchangesApi'

/** Refusals that mean the exchange or your place in it changed: reload and say why. */
function isConflict(error: ApiError): boolean {
  return ['invalid_exchange_transition', 'exchange_party_not_allowed', 'business_role_required', 'not_found'].includes(error.code)
}

const SUCCESS: Record<Exclude<CompletionAction, 'completion_record'>, (names: Names) => string> = {
  request_completion: (names) => `Exchange marked complete. ${names.other} needs to confirm it.`,
  confirm_completion: () => 'Exchange completed. The completion record is ready to download.',
  withdraw_completion: () => 'Completion request withdrawn.',
  decline_completion: (names) => `Completion request declined. The exchange stays active, and ${names.other} can ask again.`,
}

/**
 * The completion panel at the top of the exchange (the banner slot). Shown once every milestone
 * is accepted, or while something blocks completion, or a request is pending, and once completed:
 * "Mark exchange complete", the pending request (withdraw, or confirm and decline for the other
 * business), and the completed summary with the completion record.
 */
export function CompletionPanel({ exchange, businessId, names, canAct, onExchange, onConflict }: {
  exchange: Exchange
  businessId: string
  names: Names
  /** Owners and administrators request, confirm and withdraw; members see a lock line. */
  canAct: boolean
  /** The API returned the exchange as it is now. */
  onExchange: (exchange: Exchange, toast: string) => void
  onConflict: (error: ApiError, action: CompletionAction) => void
}) {
  const [busy, setBusy] = useState<CompletionAction | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const live = useRef(true)

  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])

  if (exchange.status === 'completed') return <CompletedPanel exchange={exchange} businessId={businessId} names={names} onConflict={onConflict} />
  if (exchange.status !== 'active') return null

  const { blockers, request } = exchange.completion
  const pending = request?.status === 'pending' ? request : null
  const otherBlockers = blockers.filter((code) => code !== 'milestones_not_accepted')
  if (!pending && blockers.includes('milestones_not_accepted')) return null

  const act = async (action: Exclude<CompletionAction, 'completion_record'>) => {
    if (busy) return
    setBusy(action)
    setError(null)
    try {
      const call = action === 'request_completion' ? requestCompletion : action === 'confirm_completion' ? confirmCompletion : withdrawCompletion
      const updated = await call(businessId, exchange.id)
      if (!live.current) return
      setBusy(null)
      setConfirming(false)
      onExchange(updated, SUCCESS[action](names))
    } catch (caught) {
      const apiError = toApiError(caught)
      if (!live.current) return
      setBusy(null)
      setConfirming(false)
      if (isConflict(apiError)) onConflict(apiError, action)
      else setError(`We couldn’t do that. ${apiError.userMessage}`)
    }
  }

  const lock = <p className="match-answer-who exchange-lock-line"><Lock size={13} aria-hidden="true" /> Only owners and administrators of {names.mine} can complete the exchange.</p>
  const mine = pending?.requested_by_business_id === businessId
  const requester = pending ? `${pending.requested_by_user_name ?? 'A former team member'} (${mine ? names.mine : names.other})` : ''

  return (
    <section className="match-panel match-panel-body exchange-completion" aria-labelledby="exchange-completion-title">
      <h2 id="exchange-completion-title" className="match-side-title"><Flag size={14} aria-hidden="true" /> Completion</h2>
      {pending ? (
        <>
          <p>
            {requester} marked the exchange complete on {formatDateTime(pending.requested_at)}.{' '}
            {mine
              ? `It completes when ${names.other} confirms. Until then you can withdraw the request.`
              : `Confirm it to complete the exchange for both businesses. That is final, and BFB stores a completion record of the whole exchange.`}
          </p>
          {otherBlockers.length > 0 && <p className="exchange-completion-blocked">It can’t be confirmed yet: {blockersSentence(otherBlockers)}.</p>}
          {canAct ? (
            <div className="exchange-completion-actions">
              {mine ? (
                <button type="button" className="button button-secondary button-small" onClick={() => void act('withdraw_completion')} disabled={busy !== null}>
                  <Undo2 size={14} aria-hidden="true" /> {busy === 'withdraw_completion' ? 'Withdrawing…' : 'Withdraw request'}
                </button>
              ) : (
                <>
                  <button type="button" className="button button-primary button-small" onClick={() => setConfirming(true)} disabled={busy !== null || otherBlockers.length > 0}>
                    <CircleCheckBig size={14} aria-hidden="true" /> Confirm completion
                  </button>
                  <button type="button" className="button button-secondary button-small" onClick={() => void act('decline_completion')} disabled={busy !== null}>
                    {busy === 'decline_completion' ? 'Declining…' : 'Decline'}
                  </button>
                </>
              )}
            </div>
          ) : lock}
        </>
      ) : otherBlockers.length > 0 ? (
        <p>Every milestone is accepted, but the exchange can’t be completed yet: {blockersSentence(otherBlockers)}.</p>
      ) : (
        <>
          <p>
            All {milestoneCount(exchange.milestone_count)} are accepted. When the work is done, mark the exchange complete: {names.other} then confirms it, and BFB stores a completion record of the whole exchange for both businesses.
          </p>
          {canAct ? (
            <div className="exchange-completion-actions">
              <button type="button" className="button button-primary button-small" onClick={() => void act('request_completion')} disabled={busy !== null}>
                <Flag size={14} aria-hidden="true" /> {busy === 'request_completion' ? 'Marking…' : 'Mark exchange complete'}
              </button>
            </div>
          ) : lock}
        </>
      )}
      {error && <p className="match-notice match-notice-error" role="alert">{error}</p>}
      {confirming && pending && (
        <ConfirmCompletionDialog names={names} requester={requester} busy={busy === 'confirm_completion'} onConfirm={() => void act('confirm_completion')} onCancel={() => setConfirming(false)} />
      )}
    </section>
  )
}

function ConfirmCompletionDialog({ names, requester, busy, onConfirm, onCancel }: { names: Names; requester: string; busy: boolean; onConfirm: () => void; onCancel: () => void }) {
  const titleId = useId()
  const bodyId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    cancelRef.current?.focus()
    return () => previous?.focus?.()
  }, [])

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && !busy) {
      event.preventDefault()
      onCancel()
    } else if (event.key === 'Tab') {
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? [])
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="match-dialog proposal-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={bodyId} ref={dialogRef} onKeyDown={onKeyDown}>
        <div className="modal-head">
          <div><span>COMPLETE EXCHANGE</span><h2 id={titleId}>Complete the exchange with {names.other}?</h2></div>
          <button type="button" className="icon-button" aria-label="Close" onClick={onCancel} disabled={busy}><X size={19} aria-hidden="true" /></button>
        </div>
        <div className="modal-body">
          <p className="match-dialog-intro" id={bodyId}>
            {requester} marked it complete. Confirming completes the exchange for both businesses: it’s final, nothing more can be delivered or reviewed on it, and BFB stores a completion record with every milestone, delivery and decision, and the value each business provided and received.
          </p>
        </div>
        <div className="modal-footer">
          <button type="button" className="button button-secondary" ref={cancelRef} onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" className="button button-primary" onClick={onConfirm} disabled={busy}>
            {busy ? 'Completing…' : <><CircleCheckBig size={16} aria-hidden="true" /> Confirm completion</>}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Completed: who requested and confirmed, when, and the completion record (a fresh link per click). */
function CompletedPanel({ exchange, businessId, names, onConflict }: {
  exchange: Exchange
  businessId: string
  names: Names
  onConflict: (error: ApiError, action: CompletionAction) => void
}) {
  const [busy, setBusy] = useState(false)
  const { request, record, completed_at: completedAt } = exchange.completion
  const nameOf = (id: string | null | undefined) => (id === businessId ? names.mine : names.other)

  const download = async () => {
    setBusy(true)
    // Open the tab while the click still counts as the user's, so popup blockers allow it,
    // then point it at a fresh link once the API returns one (row 148).
    const tab = window.open('', '_blank')
    if (tab) tab.opener = null
    try {
      const file = await getCompletionRecord(businessId, exchange.id)
      if (tab) tab.location.href = file.url
      else window.open(file.url, '_blank', 'noopener')
    } catch (caught) {
      tab?.close()
      const error = toApiError(caught)
      if (error.code === 'invalid_exchange_transition' || error.code === 'not_found') onConflict(error, 'completion_record')
      else showErrorToast(`We couldn’t open the completion record. ${error.userMessage}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="match-panel match-panel-body exchange-completion exchange-completion-done" aria-labelledby="exchange-completion-title">
      <h2 id="exchange-completion-title" className="match-side-title"><FileCheck2 size={14} aria-hidden="true" /> Exchange completed</h2>
      <p>
        Both businesses confirmed the exchange is complete{completedAt ? ` on ${formatMatchDate(completedAt)}` : ''}, with all {milestoneCount(exchange.milestone_count)} accepted.
        {request && (
          <> {request.requested_by_user_name ?? 'A former team member'} ({nameOf(request.requested_by_business_id)}) marked it complete and {request.resolved_by_user_name ?? 'a former team member'} ({nameOf(request.resolved_by_business_id)}) confirmed it.</>
        )}
      </p>
      {record ? (
        <>
          <p>The completion record lists every milestone, delivery and decision, and the value each business provided and received. Each link works for 15 minutes; download again for a fresh one.</p>
          <div className="exchange-completion-actions">
            <button type="button" className="button button-secondary" onClick={() => void download()} disabled={busy} aria-label="Download the completion record (opens in a new tab)">
              <FileDown size={16} aria-hidden="true" /> {busy ? 'Opening…' : 'Completion record'}
            </button>
          </div>
          <p className="agreement-signed-hashes">
            Completion record (SHA-256): <code>{record.sha256}</code>
            <br />
            Stored {formatMatchDate(record.created_at)}.
          </p>
        </>
      ) : (
        <p>BFB is preparing the completion record. Reload the page in a moment to download it.</p>
      )}
    </section>
  )
}
