import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { BellRing, Check, Lock, MessageSquareWarning, X } from 'lucide-react'

import { TextareaField } from '../../components/forms'
import { toApiError, type ApiError } from '../../lib/api/errors'
import { formatFullDate } from '../proposals/proposalCopy'
import {
  acceptOwnershipText,
  canRemind,
  canReviewMilestone,
  formatDateTime,
  formatDayTime,
  revisionsIncluded,
  reviewOverdue,
  submissionLabel,
  type MilestoneAction,
  type Names,
} from './exchangeCopy'
import { acceptMilestone, remindReviewer, requestChanges, REVIEW_LIMITS, type Exchange, type ExchangeMilestone, type Submission } from './exchangesApi'

/** Refusals that mean the milestone, the exchange or your place in it changed: reload and say why. */
function isConflict(error: ApiError): boolean {
  return ['invalid_exchange_transition', 'exchange_party_not_allowed', 'business_role_required', 'not_found'].includes(error.code)
}

export interface ReviewHandlers {
  /** The action worked: show the toast and reload the exchange. */
  onDone: (toast: string) => void
  /** The action was refused because something changed. */
  onConflict: (error: ApiError, action: MilestoneAction) => void
}

/**
 * The review part of a milestone's action area. For the receiving business: "Accept" (with a
 * confirmation) and "Ask for changes" (with a required reason) on the latest delivery, or a lock
 * line for members. For the delivering business, once the review period has ended: "Send a
 * reminder", then the date the milestone will be treated as accepted.
 */
export function MilestoneReview({ exchange, milestone, businessId, names, canAct, onDone, onConflict }: {
  exchange: Exchange
  milestone: ExchangeMilestone
  businessId: string
  names: Names
  /** Owners and administrators review and remind; members see a lock line. */
  canAct: boolean
} & ReviewHandlers) {
  const now = new Date()
  const latest = milestone.latest_submission
  if (!latest || exchange.status !== 'active' || milestone.status !== 'submitted') return null

  if (canReviewMilestone(exchange, milestone, businessId)) {
    return <ReviewActions exchange={exchange} milestone={milestone} submission={latest} businessId={businessId} names={names} canAct={canAct} onDone={onDone} onConflict={onConflict} />
  }
  if (milestone.responsible_business_id !== businessId) return null
  if (milestone.deemed_acceptance_at) return <ReminderLine milestone={milestone} names={names} receiving={false} />
  if (!reviewOverdue(milestone, now)) return null
  return <RemindAction exchange={exchange} milestone={milestone} businessId={businessId} names={names} canAct={canAct && canRemind(exchange, milestone, businessId, now)} onDone={onDone} onConflict={onConflict} />
}

/** "Reminder sent …: treated as accepted on … unless …". Both businesses see it. */
function ReminderLine({ milestone, names, receiving }: { milestone: ExchangeMilestone; names: Names; receiving: boolean }) {
  const reminder = milestone.latest_submission?.reminder
  const deemed = milestone.deemed_acceptance_at
  if (!deemed) return null
  const by = reminder ? `${reminder.sent_by_user_name ?? 'A former team member'} (${receiving ? names.other : names.mine})` : receiving ? names.other : names.mine
  const sent = milestone.reminder_sent_at ? ` on ${formatFullDate(milestone.reminder_sent_at)}` : ''
  return (
    <p className="exchange-reminder-note" role="note">
      <BellRing size={14} aria-hidden="true" />
      <span>
        <strong>Reminder sent{sent}</strong> by {by}.{' '}
        {receiving
          ? `If ${names.mine} doesn’t accept it or ask for changes by ${formatDayTime(deemed)}, BFB treats it as accepted under the agreement’s terms (Exchange Terms 4.3).`
          : `If ${names.other} doesn’t accept it or ask for changes by ${formatDayTime(deemed)}, BFB treats it as accepted under the agreement’s terms (Exchange Terms 4.3).`}
      </span>
    </p>
  )
}

function ReviewActions({ exchange, milestone, submission, businessId, names, canAct, onDone, onConflict }: {
  exchange: Exchange
  milestone: ExchangeMilestone
  submission: Submission
  businessId: string
  names: Names
  canAct: boolean
} & ReviewHandlers) {
  const [mode, setMode] = useState<'idle' | 'accept' | 'changes'>('idle')
  const overdue = reviewOverdue(milestone)
  const label = submissionLabel(submission, exchange.revision_limit)
  const handlers: ReviewHandlers = {
    onDone: (toast) => {
      setMode('idle')
      onDone(toast)
    },
    onConflict: (error, action) => {
      setMode('idle')
      onConflict(error, action)
    },
  }

  return (
    <>
      {milestone.deemed_acceptance_at ? (
        <ReminderLine milestone={milestone} names={names} receiving />
      ) : overdue && milestone.review_due_at ? (
        <p className="exchange-review-due">
          The review period ended on {formatDayTime(milestone.review_due_at)}. You can still accept it or ask for changes. {names.other} can now send a reminder; 5 business days after it, BFB treats the delivery as accepted under the agreement’s terms.
        </p>
      ) : null}
      {!canAct ? (
        <p className="match-answer-who exchange-lock-line"><Lock size={13} aria-hidden="true" /> Only owners and administrators of {names.mine} can accept a delivery or ask for changes.</p>
      ) : mode === 'changes' ? (
        <ChangeRequestForm exchange={exchange} milestone={milestone} submission={submission} businessId={businessId} names={names} label={label} onCancel={() => setMode('idle')} {...handlers} />
      ) : (
        <div className="exchange-milestone-cta">
          <button type="button" className="button button-primary button-small" onClick={() => setMode('accept')}>
            <Check size={14} aria-hidden="true" /> Accept
          </button>
          <button type="button" className="button button-secondary button-small" onClick={() => setMode('changes')}>
            <MessageSquareWarning size={14} aria-hidden="true" /> Ask for changes
          </button>
        </div>
      )}
      {canAct && mode === 'accept' && (
        <AcceptDeliveryDialog exchange={exchange} milestone={milestone} submission={submission} businessId={businessId} names={names} label={label} onCancel={() => setMode('idle')} {...handlers} />
      )}
    </>
  )
}

/** "Ask for changes": a required reason naming which acceptance criteria are not met. */
function ChangeRequestForm({ exchange, milestone, submission, businessId, names, label, onCancel, onDone, onConflict }: {
  exchange: Exchange
  milestone: ExchangeMilestone
  submission: Submission
  businessId: string
  names: Names
  label: string
  onCancel: () => void
} & ReviewHandlers) {
  const id = useId()
  const reasonRef = useRef<HTMLTextAreaElement>(null)
  const live = useRef(true)
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string | undefined>()
  const [formError, setFormError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const beyondLimit = milestone.revisions_used >= exchange.revision_limit

  useEffect(() => {
    live.current = true
    reasonRef.current?.focus()
    return () => {
      live.current = false
    }
  }, [])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (sending) return
    if (!reason.trim()) {
      setReasonError('Say which acceptance criteria the delivery doesn’t meet yet.')
      reasonRef.current?.focus()
      return
    }
    setSending(true)
    setFormError(null)
    try {
      await requestChanges(businessId, exchange.id, milestone.id, submission.id, reason.trim())
      onDone(`Changes requested on “${milestone.title}”. ${names.other} can now submit a revision.`)
    } catch (caught) {
      const error = toApiError(caught)
      if (!live.current) return
      setSending(false)
      if (isConflict(error)) onConflict(error, 'request_changes')
      else if (error.code === 'validation_error') {
        const problem = error.fieldErrors.find((item) => item.field === 'reason')
        if (problem) setReasonError(problem.message)
        else setFormError(`We couldn’t send the change request. ${error.userMessage}`)
      } else setFormError(`We couldn’t send the change request. ${error.userMessage}`)
    }
  }

  return (
    <form className="exchange-delivery-form exchange-review-form" onSubmit={(event) => void submit(event)} aria-labelledby={`${id}-title`} noValidate>
      <h4 id={`${id}-title`}>Ask for changes</h4>
      <p className="exchange-delivery-intro">
        Say which parts of “Done when” {label} doesn’t meet yet, so {names.other} knows what to fix (Exchange Terms 4.2). {names.other} then submits a revision.
      </p>
      {milestone.acceptance_criteria && <p className="exchange-milestone-criteria"><strong>Done when:</strong> {milestone.acceptance_criteria}</p>}
      {beyondLimit && (
        <p className="exchange-revision-note" role="note">
          {names.other} has made the {revisionsIncluded(exchange.revision_limit)} the agreement includes, so the agreement doesn’t require it to make another revision. You can still ask.
        </p>
      )}
      <TextareaField
        ref={reasonRef}
        id={`${id}-reason`}
        label="Which acceptance criteria aren’t met"
        required
        rows={4}
        maxLength={REVIEW_LIMITS.reasonMax}
        hint={`Both businesses see this on the delivery. Up to ${REVIEW_LIMITS.reasonMax.toLocaleString('en-US')} characters.`}
        value={reason}
        error={reasonError}
        onChange={(event) => {
          setReason(event.target.value)
          if (reasonError && event.target.value.trim()) setReasonError(undefined)
        }}
        disabled={sending}
      />
      {formError && <p className="match-notice match-notice-error" role="alert">{formError}</p>}
      <div className="exchange-delivery-actions">
        <button type="button" className="button button-secondary button-small" onClick={onCancel} disabled={sending}>Cancel</button>
        <button type="submit" className="button button-primary button-small" disabled={sending}>
          {sending ? 'Sending…' : <><MessageSquareWarning size={14} aria-hidden="true" /> Ask for changes</>}
        </button>
      </div>
    </form>
  )
}

/** Confirms accepting a delivery: it is final and has effects under the agreement. */
function AcceptDeliveryDialog({ exchange, milestone, submission, businessId, names, label, onCancel, onDone, onConflict }: {
  exchange: Exchange
  milestone: ExchangeMilestone
  submission: Submission
  businessId: string
  names: Names
  label: string
  onCancel: () => void
} & ReviewHandlers) {
  const titleId = useId()
  const bodyId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const live = useRef(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    live.current = true
    const previous = document.activeElement as HTMLElement | null
    cancelRef.current?.focus()
    return () => {
      live.current = false
      previous?.focus?.()
    }
  }, [])

  const accept = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await acceptMilestone(businessId, exchange.id, milestone.id, submission.id)
      onDone(`“${milestone.title}” accepted.`)
    } catch (caught) {
      const apiError = toApiError(caught)
      if (!live.current) return
      setBusy(false)
      if (isConflict(apiError)) onConflict(apiError, 'accept')
      else setError(`We couldn’t accept it. ${apiError.userMessage}`)
    }
  }

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
      <div className="match-dialog proposal-dialog exchange-accept-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={bodyId} ref={dialogRef} onKeyDown={onKeyDown}>
        <div className="modal-head">
          <div><span>ACCEPT DELIVERY</span><h2 id={titleId}>Accept “{milestone.title}”?</h2></div>
          <button type="button" className="icon-button" aria-label="Close" onClick={onCancel} disabled={busy}><X size={19} aria-hidden="true" /></button>
        </div>
        <div className="modal-body">
          <dl className="proposal-accept-summary" aria-label="What you are accepting">
            <div><dt>Delivery</dt><dd>{label} <span>· {submission.submitted_by_user_name ?? 'A former team member'} ({names.other}), {formatDateTime(submission.submitted_at)}</span></dd></div>
            {milestone.acceptance_criteria && <div><dt>Done when</dt><dd>{milestone.acceptance_criteria}</dd></div>}
          </dl>
          <p className="match-dialog-intro" id={bodyId}>
            Accepting confirms the delivery meets “Done when”. It’s final and has effects under the agreement: the milestone counts as delivered by {names.other}. {acceptOwnershipText(exchange, names)}
          </p>
          {error && <p className="match-notice match-notice-error" role="alert">{error}</p>}
        </div>
        <div className="modal-footer">
          <button type="button" className="button button-secondary" ref={cancelRef} onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" className="button button-primary" onClick={() => void accept()} disabled={busy}>
            {busy ? 'Accepting…' : <><Check size={16} aria-hidden="true" /> Accept delivery</>}
          </button>
        </div>
      </div>
    </div>
  )
}

/** For the delivering business once the review period ended: "Send a reminder", or a lock line. */
function RemindAction({ exchange, milestone, businessId, names, canAct, onDone, onConflict }: {
  exchange: Exchange
  milestone: ExchangeMilestone
  businessId: string
  names: Names
  canAct: boolean
} & ReviewHandlers) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const live = useRef(true)

  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])

  const remind = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const updated = await remindReviewer(businessId, exchange.id, milestone.id)
      const deemed = updated.deemed_acceptance_at ? ` If ${names.other} doesn’t decide by ${formatDayTime(updated.deemed_acceptance_at)}, “${milestone.title}” is treated as accepted.` : ''
      onDone(`Reminder sent. ${names.other} sees it on this exchange.${deemed}`)
    } catch (caught) {
      const apiError = toApiError(caught)
      if (!live.current) return
      setBusy(false)
      if (isConflict(apiError)) onConflict(apiError, 'remind')
      else setError(`We couldn’t send the reminder. ${apiError.userMessage}`)
    }
  }

  return (
    <>
      <p className="exchange-review-due">
        {names.other} didn’t accept it or ask for changes by {milestone.review_due_at ? formatDayTime(milestone.review_due_at) : 'the end of the review period'}. You can send one reminder. If {names.other} still doesn’t decide within 5 business days of it, BFB treats the delivery as accepted under the agreement’s terms (Exchange Terms 4.3).
      </p>
      {canAct ? (
        <div className="exchange-milestone-cta">
          <button type="button" className="button button-primary button-small" onClick={() => void remind()} disabled={busy}>
            <BellRing size={14} aria-hidden="true" /> {busy ? 'Sending…' : 'Send a reminder'}
          </button>
        </div>
      ) : (
        <p className="match-answer-who exchange-lock-line"><Lock size={13} aria-hidden="true" /> Only owners and administrators of {names.mine} can send a reminder.</p>
      )}
      {error && <p className="match-notice match-notice-error" role="alert">{error}</p>}
    </>
  )
}

/** On a delivery: the decision on it (and the reminder, if one was sent), or nothing while undecided. */
export function SubmissionOutcome({ submission, businessId, names }: { submission: Submission; businessId: string; names: Names }) {
  const decision = submission.decision
  const reminder = submission.reminder
  const businessName = (id: string | null | undefined) => (id === businessId ? names.mine : names.other)
  return (
    <>
      {reminder && (
        <p className="exchange-submission-reminder">
          <BellRing size={13} aria-hidden="true" /> Reminder sent by {reminder.sent_by_user_name ?? 'a former team member'} ({businessName(reminder.sent_by_business_id)}) · <time dateTime={reminder.sent_at}>{formatDateTime(reminder.sent_at)}</time>
        </p>
      )}
      {decision && (
        decision.decision === 'changes_requested' ? (
          <div className="exchange-decision exchange-decision-changes">
            <p><strong>Changes requested</strong> by {decision.decided_by_user_name ?? 'a former team member'} ({businessName(decision.decided_by_business_id)}) · <time dateTime={decision.decided_at}>{formatDateTime(decision.decided_at)}</time></p>
            {decision.reason && <p className="exchange-decision-reason">{decision.reason}</p>}
          </div>
        ) : decision.decision === 'deemed_accepted' ? (
          <div className="exchange-decision exchange-decision-accepted">
            <p><Check size={14} aria-hidden="true" /> <strong>Treated as accepted</strong> by BFB under the agreement’s terms · <time dateTime={decision.decided_at}>{formatDateTime(decision.decided_at)}</time></p>
            <p className="exchange-decision-reason">No decision came within 5 business days of the reminder (Exchange Terms 4.3).</p>
          </div>
        ) : (
          <div className="exchange-decision exchange-decision-accepted">
            <p><Check size={14} aria-hidden="true" /> <strong>Accepted</strong> by {decision.decided_by_user_name ?? 'a former team member'} ({businessName(decision.decided_by_business_id)}) · <time dateTime={decision.decided_at}>{formatDateTime(decision.decided_at)}</time></p>
          </div>
        )
      )}
    </>
  )
}
