import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Ban, CalendarX2, Lock, Undo2, X } from 'lucide-react'

import { TextareaField } from '../../components/forms'
import { toApiError, type ApiError } from '../../lib/api/errors'
import { formatMatchDate } from '../matching/matchInboxDisplay'
import { formatDateTime, formatDayTime, noticeEffectiveAt, noticeText, type CancellationAction, type Names } from './exchangeCopy'
import { onDialogKeyDown } from './dialogKeys'
import { agreeToCancellation, CANCELLATION_LIMITS, giveCancellationNotice, withdrawCancellationNotice, type CancellationNotice, type Exchange } from './exchangesApi'

/** Refusals that mean the exchange or your place in it changed: reload and say why. */
export function isExchangeConflict(error: ApiError): boolean {
  return ['invalid_exchange_transition', 'exchange_party_not_allowed', 'business_role_required', 'not_found', 'dispute_already_open', 'invalid_dispute_status'].includes(error.code)
}

export interface CancellationHandlers {
  /** The action worked: show the toast and reload the exchange. */
  onDone: (toast: string) => void
  /** The action was refused because something changed. */
  onConflict: (error: ApiError, action: CancellationAction) => void
}

/** What each business does when the agreement ends early (Exchange Terms 13.5 and 14). */
const AT_THE_END = 'Each business delivers any completed deliverables that are due, and if one business has given more value than it received, the two settle the difference (Exchange Terms 13.5 and 14).'

/**
 * The cancellation notice at the top of the exchange (the banner slot) while it runs: who gave
 * it, why, and when it takes effect. "Withdraw notice" for the business that gave it, "Agree to
 * cancel now" for the other; members see a lock line.
 */
export function CancellationNoticePanel({ exchange, businessId, names, canAct, onDone, onConflict }: {
  exchange: Exchange
  businessId: string
  names: Names
  /** Owners and administrators withdraw or agree; members see a lock line. */
  canAct: boolean
} & CancellationHandlers) {
  const [busy, setBusy] = useState(false)
  const [agreeing, setAgreeing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const live = useRef(true)

  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])

  const notice = exchange.status === 'active' ? exchange.cancellation_notice : null
  if (!notice || notice.status !== 'pending') return null
  const mine = notice.given_by_business_id === businessId
  const giver = `${notice.given_by_user_name ?? 'A former team member'} (${mine ? names.mine : names.other})`

  const withdraw = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await withdrawCancellationNotice(businessId, exchange.id)
      if (!live.current) return
      setBusy(false)
      onDone('Cancellation notice withdrawn. The exchange carries on.')
    } catch (caught) {
      const apiError = toApiError(caught)
      if (!live.current) return
      setBusy(false)
      if (isExchangeConflict(apiError)) onConflict(apiError, 'withdraw_notice')
      else setError(`We couldn’t withdraw the notice. ${apiError.userMessage}`)
    }
  }

  return (
    <section className="match-panel match-panel-body exchange-banner exchange-cancellation" aria-labelledby="exchange-cancellation-title">
      <h2 id="exchange-cancellation-title" className="match-side-title"><CalendarX2 size={14} aria-hidden="true" /> Notice to cancel</h2>
      <p>
        {giver} gave notice to cancel the exchange on {formatDateTime(notice.given_at)}. It is cancelled on <strong>{formatDayTime(notice.effective_at)}</strong> ({noticeText(notice.notice_days)}, Exchange Terms 13.1) unless the notice is withdrawn first. Until then the exchange carries on: deliveries and reviews continue as normal.
      </p>
      <p className="exchange-banner-quote"><span>Reason</span>{notice.reason}</p>
      <p>
        {mine
          ? `${names.mine} can withdraw the notice until then.`
          : `${names.mine} can agree to cancel now instead of waiting for that date. Agreeing is final.`}
      </p>
      {canAct ? (
        <div className="exchange-completion-actions">
          {mine ? (
            <button type="button" className="button button-secondary button-small" onClick={() => void withdraw()} disabled={busy}>
              <Undo2 size={14} aria-hidden="true" /> {busy ? 'Withdrawing…' : 'Withdraw notice'}
            </button>
          ) : (
            <button type="button" className="button button-secondary button-small" onClick={() => setAgreeing(true)}>
              <Ban size={14} aria-hidden="true" /> Agree to cancel now
            </button>
          )}
        </div>
      ) : (
        <p className="match-answer-who exchange-lock-line">
          <Lock size={13} aria-hidden="true" /> Only owners and administrators of {names.mine} can {mine ? 'withdraw the notice' : 'agree to cancel now'}.
        </p>
      )}
      {error && <p className="match-notice match-notice-error" role="alert">{error}</p>}
      {agreeing && (
        <AgreeToCancelDialog
          exchange={exchange}
          notice={notice}
          giver={giver}
          businessId={businessId}
          names={names}
          onCancel={() => setAgreeing(false)}
          onDone={(toast) => {
            setAgreeing(false)
            onDone(toast)
          }}
          onConflict={(apiError, action) => {
            setAgreeing(false)
            onConflict(apiError, action)
          }}
        />
      )}
    </section>
  )
}

/** Agreeing to the other business's notice cancels the exchange now: final, so it asks first. */
function AgreeToCancelDialog({ exchange, notice, giver, businessId, names, onCancel, onDone, onConflict }: {
  exchange: Exchange
  notice: CancellationNotice
  giver: string
  businessId: string
  names: Names
  onCancel: () => void
} & CancellationHandlers) {
  const titleId = useId()
  const bodyId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const backRef = useRef<HTMLButtonElement>(null)
  const live = useRef(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    live.current = true
    const previous = document.activeElement as HTMLElement | null
    backRef.current?.focus()
    return () => {
      live.current = false
      previous?.focus?.()
    }
  }, [])

  const agree = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await agreeToCancellation(businessId, exchange.id)
      onDone('Exchange cancelled. Nothing more can be delivered or reviewed on it.')
    } catch (caught) {
      const apiError = toApiError(caught)
      if (!live.current) return
      setBusy(false)
      if (isExchangeConflict(apiError)) onConflict(apiError, 'agree_cancel')
      else setError(`We couldn’t cancel the exchange. ${apiError.userMessage}`)
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="match-dialog proposal-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={bodyId} ref={dialogRef} onKeyDown={(event) => onDialogKeyDown(event, dialogRef.current, { busy, onCancel })}>
        <div className="modal-head">
          <div><span>CANCEL EXCHANGE</span><h2 id={titleId}>Cancel the exchange with {names.other} now?</h2></div>
          <button type="button" className="icon-button" aria-label="Close" onClick={onCancel} disabled={busy}><X size={19} aria-hidden="true" /></button>
        </div>
        <div className="modal-body">
          <p className="match-dialog-intro" id={bodyId}>
            {giver} gave notice that the exchange is cancelled on {formatDayTime(notice.effective_at)}. Agreeing cancels it now instead, for both businesses. It’s final: nothing more can be delivered or reviewed on it. {AT_THE_END}
          </p>
          {error && <p className="match-notice match-notice-error" role="alert">{error}</p>}
        </div>
        <div className="modal-footer">
          <button type="button" className="button button-secondary" ref={backRef} onClick={onCancel} disabled={busy}>Go back</button>
          <button type="button" className="button button-danger" onClick={() => void agree()} disabled={busy}>
            {busy ? 'Cancelling…' : <><Ban size={16} aria-hidden="true" /> Agree to cancel now</>}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * "Cancel exchange": the reason (required, both businesses see it) and the date the notice
 * would take effect, from the agreement's notice period. With no notice period it cancels at once.
 */
export function GiveNoticeDialog({ exchange, businessId, names, onCancel, onDone, onConflict }: {
  exchange: Exchange
  businessId: string
  names: Names
  onCancel: () => void
} & CancellationHandlers) {
  const id = useId()
  const dialogRef = useRef<HTMLFormElement>(null)
  const reasonRef = useRef<HTMLTextAreaElement>(null)
  const live = useRef(true)
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string | undefined>()
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const days = exchange.cancellation_notice_days
  const effective = noticeEffectiveAt(days).toISOString()

  useEffect(() => {
    live.current = true
    const previous = document.activeElement as HTMLElement | null
    reasonRef.current?.focus()
    return () => {
      live.current = false
      previous?.focus?.()
    }
  }, [])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    if (!reason.trim()) {
      setReasonError('Say why you’re cancelling.')
      reasonRef.current?.focus()
      return
    }
    setBusy(true)
    setFormError(null)
    try {
      const notice = await giveCancellationNotice(businessId, exchange.id, reason.trim())
      onDone(
        notice.status === 'pending'
          ? `Notice given. The exchange is cancelled on ${formatMatchDate(notice.effective_at)} unless you withdraw it, or sooner if ${names.other} agrees.`
          : 'Exchange cancelled. Nothing more can be delivered or reviewed on it.',
      )
    } catch (caught) {
      const error = toApiError(caught)
      if (!live.current) return
      setBusy(false)
      if (isExchangeConflict(error)) onConflict(error, 'give_notice')
      else if (error.code === 'validation_error' && error.fieldErrors.some((item) => item.field === 'reason')) {
        setReasonError(error.fieldErrors.find((item) => item.field === 'reason')?.message)
      } else setFormError(`We couldn’t give notice. ${error.userMessage}`)
    }
  }

  return (
    <div className="modal-backdrop">
      <form
        className="match-dialog proposal-dialog exchange-form-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-intro`}
        ref={dialogRef}
        onKeyDown={(event) => onDialogKeyDown(event, dialogRef.current, { busy, onCancel })}
        onSubmit={(event) => void submit(event)}
        noValidate
      >
        <div className="modal-head">
          <div><span>CANCEL EXCHANGE</span><h2 id={`${id}-title`}>Give notice to cancel the exchange with {names.other}?</h2></div>
          <button type="button" className="icon-button" aria-label="Close" onClick={onCancel} disabled={busy}><X size={19} aria-hidden="true" /></button>
        </div>
        <div className="modal-body">
          <p className="match-dialog-intro" id={`${id}-intro`}>
            {days === 0
              ? `Either business can cancel for any reason (Exchange Terms 13.1). The agreement needs no notice, so the exchange is cancelled as soon as you give it. That is final.`
              : `Either business can cancel for any reason by giving notice (Exchange Terms 13.1). The agreement asks for ${noticeText(days)}, so if you give it now the exchange is cancelled on ${formatDayTime(effective)}. Until then it carries on: deliveries and reviews continue, ${names.other} can agree to cancel sooner, and ${names.mine} can withdraw the notice.`}
          </p>
          <p className="match-dialog-intro">{AT_THE_END}</p>
          <TextareaField
            ref={reasonRef}
            id={`${id}-reason`}
            label="Why are you cancelling?"
            required
            rows={4}
            maxLength={CANCELLATION_LIMITS.reasonMax}
            hint={`Both businesses see this on the exchange. Up to ${CANCELLATION_LIMITS.reasonMax.toLocaleString('en-US')} characters.`}
            value={reason}
            error={reasonError}
            onChange={(event) => {
              setReason(event.target.value)
              if (reasonError && event.target.value.trim()) setReasonError(undefined)
            }}
            disabled={busy}
          />
          {formError && <p className="match-notice match-notice-error" role="alert">{formError}</p>}
        </div>
        <div className="modal-footer">
          <button type="button" className="button button-secondary" onClick={onCancel} disabled={busy}>Go back</button>
          <button type="submit" className="button button-danger" disabled={busy}>
            {busy ? 'Giving notice…' : <><CalendarX2 size={16} aria-hidden="true" /> {days === 0 ? 'Cancel the exchange' : 'Give notice'}</>}
          </button>
        </div>
      </form>
    </div>
  )
}

/** A cancelled exchange, in the banner slot: final, and what still applies. */
export function CancelledPanel({ exchange }: { exchange: Exchange }) {
  if (exchange.status !== 'cancelled') return null
  return (
    <section className="match-panel match-panel-body exchange-banner exchange-cancelled" aria-labelledby="exchange-cancelled-title">
      <h2 id="exchange-cancelled-title" className="match-side-title"><Ban size={14} aria-hidden="true" /> Exchange cancelled</h2>
      <p>
        The exchange was cancelled on {formatMatchDate(exchange.updated_at)} (Exchange Terms 13.1), so nothing more can be delivered or reviewed on it. History below shows who gave notice and when. {AT_THE_END}
      </p>
      <p>Either business can still report a problem with it: the Exchange Terms on disputes still apply after an exchange ends (13.5).</p>
    </section>
  )
}
