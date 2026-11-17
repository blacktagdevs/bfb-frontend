import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { CalendarX2, Lock, MessageSquareReply, MessageSquareWarning, Undo2, X } from 'lucide-react'

import { SelectField, TextareaField } from '../../components/forms'
import { toApiError, type ApiError } from '../../lib/api/errors'
import { formatMatchDate } from '../matching/matchInboxDisplay'
import { GiveNoticeDialog, isExchangeConflict } from './CancellationPanel'
import {
  DISPUTE_CATEGORY_LABELS,
  DISPUTE_RESOLUTION_LABELS,
  formatDateTime,
  MILESTONE_STATUS_LABELS,
  noticeText,
  type CancellationAction,
  type DisputeAction,
  type Names,
} from './exchangeCopy'
import { onDialogKeyDown } from './dialogKeys'
import {
  DISPUTE_LIMITS,
  listDisputes,
  openDispute,
  respondToDispute,
  withdrawDispute,
  type Dispute,
  type DisputeCategory,
  type Exchange,
  type ExchangeMilestone,
} from './exchangesApi'

export interface DisputeHandlers {
  /** The action worked: show the toast and reload the exchange. */
  onDone: (toast: string) => void
  /** The action was refused because something changed. */
  onConflict: (error: ApiError, action: DisputeAction) => void
}

/** BFB's part in a dispute, in one line (Exchange Terms 15.3 and 15.6). */
const BFB_ROLE = 'BFB keeps this record with the exchange’s evidence (Exchange Terms 15.3) but doesn’t decide who is right (15.6).'

/** "Milestone 1 · Logo concepts, Milestone 3 · Final brand guide", or null when none are named. */
function milestoneNames(ids: string[], milestones: ExchangeMilestone[]): string | null {
  if (ids.length === 0) return null
  return ids
    .map((id) => {
      const milestone = milestones.find((item) => item.id === id)
      return milestone ? `Milestone ${milestone.sequence} · ${milestone.title}` : 'A milestone'
    })
    .join(', ')
}

function whoSaid(name: string | null, businessId: string | null, myBusinessId: string, names: Names): string {
  return `${name ?? 'A former team member'} (${businessId === myBusinessId ? names.mine : names.other})`
}

/**
 * The open dispute at the top of the exchange (the banner slot): what it's about, both
 * statements, and BFB's part. The other business can respond once; the opener can withdraw it.
 * Members see a lock line.
 */
export function OpenDisputePanel({ exchange, businessId, names, canAct, onDone, onConflict }: {
  exchange: Exchange
  businessId: string
  names: Names
  canAct: boolean
} & DisputeHandlers) {
  const [responding, setResponding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const live = useRef(true)

  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])

  const dispute = exchange.open_dispute
  if (!dispute || dispute.status !== 'open') return null
  const mine = dispute.opened_by_business_id === businessId
  const opener = whoSaid(dispute.opened_by_user_name, dispute.opened_by_business_id, businessId, names)
  const about = milestoneNames(dispute.milestone_ids, exchange.milestones)
  const answered = dispute.responded_at !== null

  const withdraw = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await withdrawDispute(businessId, exchange.id, dispute.id)
      if (!live.current) return
      setBusy(false)
      onDone('Dispute withdrawn. It’s closed, and its record stays on the exchange.')
    } catch (caught) {
      const apiError = toApiError(caught)
      if (!live.current) return
      setBusy(false)
      if (isExchangeConflict(apiError)) onConflict(apiError, 'withdraw_dispute')
      else setError(`We couldn’t withdraw the dispute. ${apiError.userMessage}`)
    }
  }

  const canRespond = !mine && !answered
  const lock = mine ? 'withdraw the dispute' : canRespond ? 'respond to the dispute' : null

  return (
    <section className="match-panel match-panel-body exchange-banner exchange-dispute" aria-labelledby="exchange-dispute-title">
      <h2 id="exchange-dispute-title" className="match-side-title"><MessageSquareWarning size={14} aria-hidden="true" /> Dispute open</h2>
      <p>
        <strong>{DISPUTE_CATEGORY_LABELS[dispute.category]}.</strong> Reported by {opener} on {formatDateTime(dispute.opened_at)}.
        {about && <> About {about}.</>}
      </p>
      <p className="exchange-banner-quote"><span>What {mine ? names.mine : names.other} says</span>{dispute.description}</p>
      {answered ? (
        <p className="exchange-banner-quote">
          <span>{whoSaid(dispute.responded_by_user_name, dispute.responded_by_business_id, businessId, names)} responded on {formatDateTime(dispute.responded_at ?? dispute.opened_at)}</span>
          {dispute.response}
        </p>
      ) : (
        <p>{mine ? `${names.other} hasn’t responded yet. It can respond once.` : `${names.mine} can respond once. Both businesses and BFB staff see the response.`}</p>
      )}
      <p>
        {BFB_ROLE} Try to settle it with {names.other} directly; BFB staff close the dispute once it’s settled{mine ? ', or you can withdraw it' : ''}. While it’s open the exchange can’t be completed. Delivery, review and cancellation carry on.
      </p>
      {lock && !canAct && (
        <p className="match-answer-who exchange-lock-line"><Lock size={13} aria-hidden="true" /> Only owners and administrators of {names.mine} can {lock}.</p>
      )}
      {lock && canAct && (responding ? (
        <DisputeResponseForm
          exchange={exchange}
          dispute={dispute}
          businessId={businessId}
          names={names}
          onCancel={() => setResponding(false)}
          onDone={(toast) => {
            setResponding(false)
            onDone(toast)
          }}
          onConflict={(apiError, action) => {
            setResponding(false)
            onConflict(apiError, action)
          }}
        />
      ) : (
        <div className="exchange-completion-actions">
          {mine ? (
            <button type="button" className="button button-secondary button-small" onClick={() => void withdraw()} disabled={busy}>
              <Undo2 size={14} aria-hidden="true" /> {busy ? 'Withdrawing…' : 'Withdraw dispute'}
            </button>
          ) : (
            <button type="button" className="button button-primary button-small" onClick={() => setResponding(true)}>
              <MessageSquareReply size={14} aria-hidden="true" /> Respond
            </button>
          )}
        </div>
      ))}
      {error && <p className="match-notice match-notice-error" role="alert">{error}</p>}
    </section>
  )
}

/** The other business's one response, inside the dispute panel. */
function DisputeResponseForm({ exchange, dispute, businessId, names, onCancel, onDone, onConflict }: {
  exchange: Exchange
  dispute: Dispute
  businessId: string
  names: Names
  onCancel: () => void
} & DisputeHandlers) {
  const id = useId()
  const responseRef = useRef<HTMLTextAreaElement>(null)
  const live = useRef(true)
  const [response, setResponse] = useState('')
  const [responseError, setResponseError] = useState<string | undefined>()
  const [formError, setFormError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  useEffect(() => {
    live.current = true
    responseRef.current?.focus()
    return () => {
      live.current = false
    }
  }, [])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (sending) return
    if (!response.trim()) {
      setResponseError('Write your response.')
      responseRef.current?.focus()
      return
    }
    setSending(true)
    setFormError(null)
    try {
      await respondToDispute(businessId, exchange.id, dispute.id, response.trim())
      onDone('Response added to the dispute.')
    } catch (caught) {
      const error = toApiError(caught)
      if (!live.current) return
      setSending(false)
      if (isExchangeConflict(error)) onConflict(error, 'respond_dispute')
      else if (error.code === 'validation_error' && error.fieldErrors.some((item) => item.field === 'response')) {
        setResponseError(error.fieldErrors.find((item) => item.field === 'response')?.message)
      } else setFormError(`We couldn’t send your response. ${error.userMessage}`)
    }
  }

  return (
    <form className="exchange-delivery-form" onSubmit={(event) => void submit(event)} aria-labelledby={`${id}-title`} noValidate>
      <h4 id={`${id}-title`}>Respond to the dispute</h4>
      <p className="exchange-delivery-intro">
        Give {names.mine}’s side. You can respond once, and it can’t be changed afterwards. {names.other} and BFB staff see it.
      </p>
      <TextareaField
        ref={responseRef}
        id={`${id}-response`}
        label="Your response"
        required
        rows={4}
        maxLength={DISPUTE_LIMITS.responseMax}
        hint={`Up to ${DISPUTE_LIMITS.responseMax.toLocaleString('en-US')} characters.`}
        value={response}
        error={responseError}
        onChange={(event) => {
          setResponse(event.target.value)
          if (responseError && event.target.value.trim()) setResponseError(undefined)
        }}
        disabled={sending}
      />
      {formError && <p className="match-notice match-notice-error" role="alert">{formError}</p>}
      <div className="exchange-delivery-actions">
        <button type="button" className="button button-secondary button-small" onClick={onCancel} disabled={sending}>Cancel</button>
        <button type="submit" className="button button-primary button-small" disabled={sending}>
          {sending ? 'Sending…' : <><MessageSquareReply size={14} aria-hidden="true" /> Send response</>}
        </button>
      </div>
    </form>
  )
}

const CATEGORY_OPTIONS = (Object.keys(DISPUTE_CATEGORY_LABELS) as DisputeCategory[]).map((value) => ({ value, label: DISPUTE_CATEGORY_LABELS[value] }))

/** "Report a problem": what it's about, a description and the milestones it concerns. */
export function OpenDisputeDialog({ exchange, businessId, names, onCancel, onDone, onConflict }: {
  exchange: Exchange
  businessId: string
  names: Names
  onCancel: () => void
} & DisputeHandlers) {
  const id = useId()
  const dialogRef = useRef<HTMLFormElement>(null)
  const categoryRef = useRef<HTMLSelectElement>(null)
  const descriptionRef = useRef<HTMLTextAreaElement>(null)
  const live = useRef(true)
  const [category, setCategory] = useState<DisputeCategory | ''>('')
  const [description, setDescription] = useState('')
  const [milestoneIds, setMilestoneIds] = useState<string[]>([])
  const [errors, setErrors] = useState<{ category?: string; description?: string }>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    live.current = true
    const previous = document.activeElement as HTMLElement | null
    categoryRef.current?.focus()
    return () => {
      live.current = false
      previous?.focus?.()
    }
  }, [])

  const toggle = (milestoneId: string, checked: boolean) =>
    setMilestoneIds((current) => (checked ? [...current, milestoneId] : current.filter((item) => item !== milestoneId)))

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    const found = {
      category: category ? undefined : 'Choose what the problem is about.',
      description: description.trim() ? undefined : 'Describe the problem.',
    }
    setErrors(found)
    if (found.category) return categoryRef.current?.focus()
    if (found.description) return descriptionRef.current?.focus()
    setBusy(true)
    setFormError(null)
    try {
      // Milestones in exchange order, whatever order they were ticked in.
      const ordered = exchange.milestones.filter((milestone) => milestoneIds.includes(milestone.id)).map((milestone) => milestone.id)
      await openDispute(businessId, exchange.id, { category: category as DisputeCategory, description: description.trim(), milestone_ids: ordered })
      onDone('Dispute opened. Both businesses see it on this exchange, and BFB staff close it once it’s settled.')
    } catch (caught) {
      const error = toApiError(caught)
      if (!live.current) return
      setBusy(false)
      if (isExchangeConflict(error)) return onConflict(error, 'open_dispute')
      if (error.code === 'validation_error') {
        const field = (name: string) => error.fieldErrors.find((item) => item.field === name)?.message
        if (field('description') || field('category')) return setErrors({ category: field('category'), description: field('description') })
        if (error.fieldErrors.some((item) => item.field.startsWith('milestone_ids'))) {
          return setFormError('One of the milestones you chose isn’t part of this exchange. Close this, reload the page and choose again.')
        }
      }
      setFormError(`We couldn’t open the dispute. ${error.userMessage}`)
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
          <div><span>REPORT A PROBLEM</span><h2 id={`${id}-title`}>Open a dispute about the exchange with {names.other}?</h2></div>
          <button type="button" className="icon-button" aria-label="Close" onClick={onCancel} disabled={busy}><X size={19} aria-hidden="true" /></button>
        </div>
        <div className="modal-body exchange-form-dialog-body">
          <p className="match-dialog-intro" id={`${id}-intro`}>
            The Exchange Terms ask both businesses to try to settle a disagreement directly, in good faith, for at least 10 business days after it’s described in writing through BFB (15.1). This is that description. {BFB_ROLE} BFB staff close the dispute once it’s settled. While it’s open the exchange can’t be completed; delivery, review and cancellation carry on.
          </p>
          <SelectField
            ref={categoryRef}
            id={`${id}-category`}
            label="What is it about?"
            required
            placeholder="Choose one"
            options={CATEGORY_OPTIONS}
            value={category}
            error={errors.category}
            onChange={(event) => {
              setCategory(event.target.value as DisputeCategory | '')
              if (event.target.value) setErrors((current) => ({ ...current, category: undefined }))
            }}
            disabled={busy}
          />
          <TextareaField
            ref={descriptionRef}
            id={`${id}-description`}
            label="Describe the problem"
            required
            rows={5}
            maxLength={DISPUTE_LIMITS.descriptionMax}
            hint={`What happened, what you expected under the agreement, and what you’ve tried. ${names.other} and BFB staff see it. Up to ${DISPUTE_LIMITS.descriptionMax.toLocaleString('en-US')} characters.`}
            value={description}
            error={errors.description}
            onChange={(event) => {
              setDescription(event.target.value)
              if (event.target.value.trim()) setErrors((current) => ({ ...current, description: undefined }))
            }}
            disabled={busy}
          />
          {exchange.milestones.length > 0 && (
            <fieldset className="exchange-delivery-group exchange-dispute-milestones" disabled={busy}>
              <legend>Which milestones does it concern? <span>Optional</span></legend>
              {exchange.milestones.map((milestone) => (
                <label key={milestone.id} className="exchange-check">
                  <input type="checkbox" checked={milestoneIds.includes(milestone.id)} onChange={(event) => toggle(milestone.id, event.target.checked)} />
                  <span>Milestone {milestone.sequence} · {milestone.title} <small>{MILESTONE_STATUS_LABELS[milestone.status]}</small></span>
                </label>
              ))}
            </fieldset>
          )}
          {formError && <p className="match-notice match-notice-error" role="alert">{formError}</p>}
        </div>
        <div className="modal-footer">
          <button type="button" className="button button-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="submit" className="button button-primary" disabled={busy}>
            {busy ? 'Opening…' : <><MessageSquareWarning size={16} aria-hidden="true" /> Open dispute</>}
          </button>
        </div>
      </form>
    </div>
  )
}

/**
 * In the side column: "Report a problem" (any status, while no dispute is open) and "Cancel
 * exchange" (while active with no notice running). Members see a lock line instead.
 */
export function SomethingWrongCard({ exchange, businessId, names, canAct, onDone, onConflict }: {
  exchange: Exchange
  businessId: string
  names: Names
  canAct: boolean
  onDone: (toast: string) => void
  onConflict: (error: ApiError, action: CancellationAction | DisputeAction) => void
}) {
  const [open, setOpen] = useState<'dispute' | 'cancel' | null>(null)
  const canDispute = !exchange.open_dispute
  const canCancel = exchange.status === 'active' && !exchange.cancellation_notice
  if (!canDispute && !canCancel) return null
  const close = () => setOpen(null)
  const handlers = {
    onDone: (toast: string) => {
      setOpen(null)
      onDone(toast)
    },
    onConflict: (error: ApiError, action: CancellationAction | DisputeAction) => {
      setOpen(null)
      onConflict(error, action)
    },
  }

  return (
    <section className="match-panel match-panel-body exchange-problems" aria-labelledby="exchange-problems-title">
      <h2 id="exchange-problems-title" className="match-side-title">If something goes wrong</h2>
      {canDispute && (
        <p>
          {exchange.status === 'active'
            ? `Try to settle a disagreement with ${names.other} directly first. If you can’t, report a problem: BFB keeps a record of it with the exchange’s evidence.`
            : `The Exchange Terms on disputes still apply after an exchange ends (13.5), so you can still report a problem with it.`}
        </p>
      )}
      {canCancel && <p>Either business can cancel for any reason with {noticeText(exchange.cancellation_notice_days)} (Exchange Terms 13.1).</p>}
      {canAct ? (
        <div className="exchange-problems-actions">
          {canDispute && (
            <button type="button" className="button button-secondary button-small" onClick={() => setOpen('dispute')}>
              <MessageSquareWarning size={14} aria-hidden="true" /> Report a problem
            </button>
          )}
          {canCancel && (
            <button type="button" className="button button-secondary button-small exchange-cancel-button" onClick={() => setOpen('cancel')}>
              <CalendarX2 size={14} aria-hidden="true" /> Cancel exchange
            </button>
          )}
        </div>
      ) : (
        <p className="match-answer-who exchange-lock-line">
          <Lock size={13} aria-hidden="true" /> Only owners and administrators of {names.mine} can {canDispute && canCancel ? 'report a problem or cancel the exchange' : canDispute ? 'report a problem' : 'cancel the exchange'}.
        </p>
      )}
      {canAct && open === 'dispute' && <OpenDisputeDialog exchange={exchange} businessId={businessId} names={names} onCancel={close} {...handlers} />}
      {canAct && open === 'cancel' && <GiveNoticeDialog exchange={exchange} businessId={businessId} names={names} onCancel={close} {...handlers} />}
    </section>
  )
}

type PastState = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; items: Dispute[] }

/**
 * Closed disputes, newest first, with how each ended (withdrawn by the business that opened
 * it, or closed by BFB staff with a resolution and note). Hidden until there is one.
 */
export function PastDisputes({ exchange, businessId, names, reloadKey }: { exchange: Exchange; businessId: string; names: Names; reloadKey: number }) {
  const [state, setState] = useState<PastState>({ kind: 'loading' })
  const [retryKey, setRetryKey] = useState(0)

  useEffect(() => {
    let live = true
    listDisputes(businessId, exchange.id)
      .then((items) => {
        if (live) setState({ kind: 'ready', items })
      })
      .catch(() => {
        if (live) setState((current) => (current.kind === 'ready' ? current : { kind: 'error' }))
      })
    return () => {
      live = false
    }
  }, [businessId, exchange.id, reloadKey, retryKey])

  const closed = state.kind === 'ready' ? state.items.filter((dispute) => dispute.status === 'closed') : []
  if (state.kind === 'loading' || (state.kind === 'ready' && closed.length === 0)) return null

  return (
    <section className="match-panel" aria-labelledby="exchange-past-disputes-title">
      <div className="match-panel-head">
        <h2 id="exchange-past-disputes-title">Closed disputes</h2>
        <p>How each one ended. {BFB_ROLE}</p>
      </div>
      <div className="match-panel-body">
        {state.kind === 'error' ? (
          <p className="exchange-readonly-note" role="alert">
            We couldn’t load this exchange’s disputes.{' '}
            <button type="button" className="text-button exchange-inline-button" onClick={() => { setState({ kind: 'loading' }); setRetryKey((key) => key + 1) }}>Try again</button>
          </p>
        ) : (
          <ul className="exchange-disputes" aria-label="Closed disputes">
            {closed.map((dispute) => <ClosedDispute key={dispute.id} dispute={dispute} exchange={exchange} businessId={businessId} names={names} />)}
          </ul>
        )}
      </div>
    </section>
  )
}

function ClosedDispute({ dispute, exchange, businessId, names }: { dispute: Dispute; exchange: Exchange; businessId: string; names: Names }) {
  const about = milestoneNames(dispute.milestone_ids, exchange.milestones)
  const openerBusiness = dispute.opened_by_business_id === businessId ? names.mine : names.other
  const closedOn = dispute.closed_at ? ` on ${formatMatchDate(dispute.closed_at)}` : ''
  return (
    <li className="exchange-dispute-closed">
      <strong>{DISPUTE_CATEGORY_LABELS[dispute.category]}</strong>
      <small>
        Reported by {whoSaid(dispute.opened_by_user_name, dispute.opened_by_business_id, businessId, names)} on {formatMatchDate(dispute.opened_at)}
        {about ? ` · About ${about}` : ''}
      </small>
      <p>{dispute.description}</p>
      {dispute.response && (
        <p className="exchange-dispute-response">
          <span>Response from {whoSaid(dispute.responded_by_user_name, dispute.responded_by_business_id, businessId, names)}</span>
          {dispute.response}
        </p>
      )}
      <div className="exchange-dispute-outcome">
        {dispute.closed_by === 'business' ? (
          <p><strong>Withdrawn by {openerBusiness}{closedOn}.</strong></p>
        ) : (
          <>
            <p><strong>Closed by BFB staff{closedOn}: {dispute.resolution ? DISPUTE_RESOLUTION_LABELS[dispute.resolution].toLowerCase() : 'no outcome recorded'}.</strong></p>
            {dispute.resolution_note && <p>{dispute.resolution_note}</p>}
          </>
        )}
      </div>
    </li>
  )
}
