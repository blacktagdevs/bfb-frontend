import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { ArrowLeft, CalendarDays, ExternalLink, FileDown, History, Info, PackageCheck, X } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'

import { paths } from '../../app/router/paths'
import { ErrorState, LoadingState, showErrorToast, showToast } from '../../components/feedback'
import { SelectField, TextareaField } from '../../components/forms'
import { toApiError } from '../../lib/api/errors'
import { onDialogKeyDown } from '../exchanges/dialogKeys'
import {
  DISPUTE_CATEGORY_LABELS,
  DISPUTE_RESOLUTION_LABELS,
  EXCHANGE_STATUS_LABELS,
  formatBytes,
  formatDayTime,
  historyActor,
  MILESTONE_STATUS_LABELS,
  noticeText,
} from '../exchanges/exchangeCopy'
import { HistoryList } from '../exchanges/ExchangeHistory'
import { SubmissionOutcome } from '../exchanges/MilestoneReview'
import type { ExchangeEvent, ExchangeMilestone, Submission } from '../exchanges/exchangesApi'
import { formatFullDate } from '../proposals/proposalCopy'
import { formatDateTime } from './adminDisplay'
import { businessName, disputeBusinesses, DisputeStatusBadge } from './DisputesPage'
import {
  CLOSE_NOTE_MAX,
  closeDispute,
  getAdminAttachmentUrl,
  getAdminDispute,
  getAdminExchangeHistory,
  listAdminSubmissions,
  type AdminDisputeDetail,
  type DisputeResolution,
} from './disputesApi'
import { BusinessMark, businessPlace } from './matchDisplay'
import './Admin.css'
import '../matching/MatchInbox.css'
import '../exchanges/ExchangesPage.css'

/**
 * `/admin/disputes/:id`: the dispute with its exchange, both statements, every milestone with its
 * latest delivery, the exchange's history, and "Close dispute" with a resolution and note. Staff
 * record the outcome only; they never change a milestone or the exchange.
 */
export function DisputeDetailPage() {
  const { disputeId = '' } = useParams()
  const [dispute, setDispute] = useState<AdminDisputeDetail | null>(null)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [closing, setClosing] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const reload = useCallback(() => setReloadKey((key) => key + 1), [])

  useEffect(() => {
    let live = true
    setLoadError(null)
    getAdminDispute(disputeId)
      .then((result) => {
        if (live) setDispute(result)
      })
      .catch((error: unknown) => {
        if (live) setLoadError(toApiError(error))
      })
    return () => {
      live = false
    }
  }, [disputeId, reloadKey])

  const back = <Link className="back-button admin-back" to={paths.adminDisputes}><ArrowLeft size={17} aria-hidden="true" /> Back to disputes</Link>

  if (!dispute) {
    const notFound = loadError !== null && toApiError(loadError).code === 'not_found'
    return (
      <>
        {back}
        {loadError ? (
          <ErrorState title={notFound ? 'This dispute doesn’t exist' : 'We couldn’t load this dispute'} error={loadError} onRetry={notFound ? undefined : reload} />
        ) : (
          <LoadingState label="Loading dispute…" />
        )}
      </>
    )
  }

  const names = disputeBusinesses(dispute)
  const opener = `${dispute.opened_by_user_name ?? 'A former team member'} (${businessName(dispute, dispute.opened_by_business_id)})`
  const otherId = dispute.opened_by_business_id === dispute.exchange.business_a.id ? dispute.exchange.business_b.id : dispute.exchange.business_a.id
  const named = new Set(dispute.milestone_ids)

  const closed = (toast: string) => {
    setClosing(false)
    setNotice(null)
    showToast(toast)
    reload()
  }

  const alreadyClosed = () => {
    setClosing(false)
    setNotice('This dispute was already closed, so nothing changed. Its outcome is shown below.')
    reload()
  }

  return (
    <>
      {back}
      <div className="page-heading admin-heading">
        <div>
          <span>ADMIN · DISPUTE</span>
          <h1>{names}</h1>
          <p>Opened {formatDateTime(dispute.opened_at)} by {opener}.</p>
        </div>
        <div className="admin-status-pills">
          <DisputeStatusBadge status={dispute.status} />
          <span className="admin-status">{DISPUTE_CATEGORY_LABELS[dispute.category]}</span>
        </div>
      </div>
      {notice && <p className="admin-notice admin-notice-error" role="alert">{notice}</p>}
      <p className="admin-info" role="note">
        <Info size={16} aria-hidden="true" />
        <span>BFB records disputes and keeps the evidence; it doesn’t judge them (Exchange Terms 15.6). Closing a dispute records how it ended and shows your note to both businesses. It never changes a milestone or the exchange: staff can’t accept, reject or cancel anything here.</span>
      </p>
      <div className="admin-layout">
        <div className="admin-main">
          <section className="admin-card" aria-labelledby="dispute-statements-title">
            <div className="admin-card-head">
              <h2 id="dispute-statements-title">Statements</h2>
              <p>Both businesses see these on the exchange.</p>
            </div>
            <ul className="admin-history">
              <li>
                <span className="admin-status">{businessName(dispute, dispute.opened_by_business_id)} opened it</span>
                <small>{opener} · {formatDateTime(dispute.opened_at)}</small>
                <p>{dispute.description}</p>
                {dispute.milestone_ids.length > 0 && (
                  <small>About {dispute.milestone_ids.map((id) => milestoneName(id, dispute.milestones)).join(', ')}</small>
                )}
              </li>
              <li>
                {dispute.response ? (
                  <>
                    <span className="admin-status">{businessName(dispute, dispute.responded_by_business_id)} responded</span>
                    <small>{dispute.responded_by_user_name ?? 'A former team member'} · {dispute.responded_at ? formatDateTime(dispute.responded_at) : ''}</small>
                    <p>{dispute.response}</p>
                  </>
                ) : (
                  <p className="admin-muted">{businessName(dispute, otherId)} hasn’t responded. It can respond once while the dispute is open.</p>
                )}
              </li>
            </ul>
          </section>
          <section className="admin-card" aria-labelledby="dispute-milestones-title">
            <div className="admin-card-head">
              <h2 id="dispute-milestones-title">Milestones</h2>
              <p>Every milestone in the exchange with its latest delivery, as the businesses see them now.</p>
            </div>
            <ol className="admin-dispute-milestones" aria-label="Milestones">
              {dispute.milestones.map((milestone) => (
                <AdminMilestone key={milestone.id} dispute={dispute} milestone={milestone} named={named.has(milestone.id)} />
              ))}
            </ol>
          </section>
          <AdminHistory dispute={dispute} />
        </div>
        <aside className="admin-side">
          <section className="admin-card admin-decision" aria-labelledby="dispute-outcome-title">
            <h2 id="dispute-outcome-title">Outcome</h2>
            {dispute.status === 'open' ? (
              <>
                <p>Close the dispute once the businesses have settled it, or it ended another way. Record how it ended and a note both businesses see. They don’t see your name.</p>
                <button type="button" className="button button-primary" onClick={() => setClosing(true)}>Close dispute</button>
              </>
            ) : (
              <dl className="match-facts">
                <div><dt>Closed</dt><dd>{dispute.closed_at ? formatDateTime(dispute.closed_at) : 'Yes'}</dd></div>
                <div><dt>How it ended</dt><dd>{dispute.resolution ? DISPUTE_RESOLUTION_LABELS[dispute.resolution] : 'Not recorded'}</dd></div>
                <div>
                  <dt>Closed by</dt>
                  <dd>
                    {dispute.closed_by === 'business'
                      ? `${dispute.closed_by_user_name ?? 'A former team member'} (${businessName(dispute, dispute.opened_by_business_id)}), withdrawn`
                      : `${dispute.closed_by_user_name ?? 'Former staff member'}, BFB staff`}
                  </dd>
                </div>
              </dl>
            )}
            {dispute.status === 'closed' && dispute.resolution_note && (
              <div className="match-withdrawn">
                <strong>Note for both businesses</strong>
                <p>{dispute.resolution_note}</p>
              </div>
            )}
          </section>
          <section className="admin-card" aria-labelledby="dispute-exchange-title">
            <div className="admin-card-head">
              <h2 id="dispute-exchange-title">Exchange</h2>
              <p>Staff can’t change it from here.</p>
            </div>
            <div className="admin-card-body admin-dispute-exchange">
              {[dispute.exchange.business_a, dispute.exchange.business_b].map((business) => (
                <div key={business.id} className="match-participant">
                  <BusinessMark business={business} />
                  <div>
                    <strong>{business.display_name}</strong>
                    <small>{businessPlace(business)}</small>
                  </div>
                </div>
              ))}
              <dl className="match-facts">
                <div><dt>Status</dt><dd>{EXCHANGE_STATUS_LABELS[dispute.exchange.status]}</dd></div>
                <div><dt>Active since</dt><dd>{formatDateTime(dispute.exchange.activated_at)}</dd></div>
              </dl>
              {dispute.cancellation_notice && (
                <div className="match-withdrawn">
                  <strong>Notice to cancel running</strong>
                  <p>
                    Given by {dispute.cancellation_notice.given_by_user_name ?? 'a former team member'} ({businessName(dispute, dispute.cancellation_notice.given_by_business_id)}) on {formatDateTime(dispute.cancellation_notice.given_at)} with {noticeText(dispute.cancellation_notice.notice_days)}. It takes effect on {formatDayTime(dispute.cancellation_notice.effective_at)}.
                  </p>
                  <p>{dispute.cancellation_notice.reason}</p>
                </div>
              )}
            </div>
          </section>
        </aside>
      </div>
      {closing && <CloseDisputeDialog dispute={dispute} names={names} onCancel={() => setClosing(false)} onClosed={closed} onAlreadyClosed={alreadyClosed} />}
    </>
  )
}

function milestoneName(id: string, milestones: ExchangeMilestone[]): string {
  const milestone = milestones.find((item) => item.id === id)
  return milestone ? `Milestone ${milestone.sequence} · ${milestone.title}` : 'a milestone no longer in the exchange'
}

/** "Delivery 1", "Revision 2", "Revision 3 (beyond the agreed limit)": staff screens don't have the limit. */
function adminSubmissionLabel(submission: Submission): string {
  if (!submission.is_revision || submission.revision_number === null) return `Delivery ${submission.number}`
  return `Revision ${submission.revision_number}${submission.beyond_revision_limit ? ' (beyond the agreed limit)' : ''}`
}

/** One milestone with its status, who delivers it and its latest delivery; earlier ones on request. */
function AdminMilestone({ dispute, milestone, named }: { dispute: AdminDisputeDetail; milestone: ExchangeMilestone; named: boolean }) {
  const [earlier, setEarlier] = useState<Submission[] | 'loading' | 'error' | null>(null)
  const latest = milestone.latest_submission
  const from = businessName(dispute, milestone.responsible_business_id)
  const to = businessName(dispute, milestone.receiving_business_id)

  const showEarlier = async () => {
    setEarlier('loading')
    try {
      const items = await listAdminSubmissions(dispute.exchange_id, milestone.id)
      setEarlier(items.filter((item) => item.id !== latest?.id))
    } catch {
      setEarlier('error')
    }
  }

  return (
    <li className={`exchange-milestone ${named ? 'admin-milestone-named' : ''}`} aria-label={`Milestone ${milestone.sequence}: ${milestone.title}`}>
      <span className="exchange-milestone-number" aria-hidden="true">{milestone.sequence}</span>
      <div className="exchange-milestone-body">
        <div className="exchange-milestone-head">
          <h3>{milestone.title}</h3>
          <span className={`match-pill exchange-milestone-pill-${milestone.status}`}>{MILESTONE_STATUS_LABELS[milestone.status]}</span>
        </div>
        <p className="exchange-milestone-meta">
          <span><PackageCheck size={14} aria-hidden="true" /> {from} delivers to {to}</span>
          <span><CalendarDays size={14} aria-hidden="true" /> {milestone.due_date ? `Due ${formatFullDate(milestone.due_date)}` : 'No due date'}</span>
          {named && <span className="admin-tag admin-tag-flagged">Named in the dispute</span>}
        </p>
        {milestone.acceptance_criteria && <p className="exchange-milestone-criteria"><strong>Done when:</strong> {milestone.acceptance_criteria}</p>}
        {latest ? (
          <div className="exchange-deliveries">
            <AdminSubmission dispute={dispute} submission={latest} />
            {latest.number > 1 && !Array.isArray(earlier) && (
              earlier === 'error' ? (
                <p className="exchange-readonly-note" role="alert">
                  We couldn’t load the earlier deliveries. <button type="button" className="text-button exchange-inline-button" onClick={() => void showEarlier()}>Try again</button>
                </p>
              ) : (
                <button type="button" className="text-button exchange-earlier-button" onClick={() => void showEarlier()} disabled={earlier === 'loading'}>
                  {earlier === 'loading' ? 'Loading…' : latest.number === 2 ? 'Show the earlier delivery' : `Show the ${latest.number - 1} earlier deliveries`}
                </button>
              )
            )}
            {Array.isArray(earlier) && earlier.map((submission) => <AdminSubmission key={submission.id} dispute={dispute} submission={submission} />)}
          </div>
        ) : (
          <p className="exchange-readonly-note">Nothing delivered yet.</p>
        )}
      </div>
    </li>
  )
}

function AdminSubmission({ dispute, submission }: { dispute: AdminDisputeDetail; submission: Submission }) {
  const [busy, setBusy] = useState<string | null>(null)
  const label = adminSubmissionLabel(submission)

  const download = async (uploadId: string, name: string) => {
    setBusy(uploadId)
    const tab = window.open('', '_blank')
    if (tab) tab.opener = null
    try {
      const file = await getAdminAttachmentUrl(dispute.exchange_id, submission.milestone_id, submission.id, uploadId)
      if (tab) tab.location.href = file.url
      else window.open(file.url, '_blank', 'noopener')
    } catch (caught) {
      tab?.close()
      showErrorToast(`We couldn’t open ${name}. ${toApiError(caught).userMessage}`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <article className="exchange-submission" aria-label={label}>
      <header>
        <strong>{label}</strong>
        <small>
          {submission.submitted_by_user_name ?? 'A former team member'} ({businessName(dispute, submission.submitted_by_business_id)}) · <time dateTime={submission.submitted_at}>{formatDateTime(submission.submitted_at)}</time>
        </small>
      </header>
      <p className="exchange-submission-note">{submission.note}</p>
      {submission.links.length > 0 && (
        <ul className="exchange-submission-links" aria-label="Links">
          {submission.links.map((link, at) => (
            <li key={at}>
              <a href={link.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} aria-hidden="true" /> {link.label ?? link.url}</a>
            </li>
          ))}
        </ul>
      )}
      {submission.attachments.length > 0 && (
        <ul className="exchange-submission-files" aria-label="Files">
          {submission.attachments.map((file) => {
            const name = file.original_filename ?? 'the file'
            return (
              <li key={file.upload_id}>
                <button type="button" className="button button-secondary button-small" disabled={busy !== null} onClick={() => void download(file.upload_id, name)} aria-label={`Download ${name} (opens in a new tab)`}>
                  <FileDown size={14} aria-hidden="true" /> {busy === file.upload_id ? 'Opening…' : file.original_filename ?? 'File'}
                  <small>{formatBytes(file.size_bytes)}</small>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <SubmissionOutcome submission={submission} businessId={dispute.exchange.business_a.id} names={{ mine: dispute.exchange.business_a.display_name, other: dispute.exchange.business_b.display_name }} />
    </article>
  )
}

type HistoryState = { items: ExchangeEvent[]; nextCursor: string | null; loadingMore: boolean }

/** The exchange's history, newest first, with staff names shown; earlier entries from the admin history route. */
function AdminHistory({ dispute }: { dispute: AdminDisputeDetail }) {
  const [state, setState] = useState<HistoryState>({ items: dispute.history, nextCursor: dispute.history_next_cursor, loadingMore: false })

  useEffect(() => {
    setState({ items: dispute.history, nextCursor: dispute.history_next_cursor, loadingMore: false })
  }, [dispute])

  const loadMore = async () => {
    if (!state.nextCursor) return
    setState({ ...state, loadingMore: true })
    try {
      const page = await getAdminExchangeHistory(dispute.exchange_id, state.nextCursor)
      setState((current) => ({ items: [...current.items, ...page.items.filter((item) => !current.items.some((seen) => seen.id === item.id))], nextCursor: page.next_cursor, loadingMore: false }))
    } catch (error) {
      setState((current) => ({ ...current, loadingMore: false }))
      showErrorToast(`We couldn’t load more history. ${toApiError(error).userMessage}`)
    }
  }

  const { business_a: a, business_b: b } = dispute.exchange
  // Staff see both businesses by name, so "mine" is simply business A.
  const actor = (entry: ExchangeEvent) => historyActor(entry, a.id, { mine: a.display_name, other: b.display_name }, { showStaffName: true })

  return (
    <section className="admin-card" aria-labelledby="dispute-history-title">
      <div className="admin-card-head">
        <h2 id="dispute-history-title">Exchange history</h2>
        <p>Everything that happened in the exchange, newest first, as both businesses see it (they don’t see staff names).</p>
      </div>
      <div className="admin-card-body admin-dispute-history">
        {state.items.length === 0 ? (
          <p className="admin-muted">Nothing has happened in this exchange yet.</p>
        ) : (
          <HistoryList items={state.items} milestones={dispute.milestones} revisionLimit={null} actor={actor} />
        )}
        {state.nextCursor && (
          <button type="button" className="button button-secondary button-small" onClick={() => void loadMore()} disabled={state.loadingMore}>
            <History size={14} aria-hidden="true" /> {state.loadingMore ? 'Loading…' : 'Show earlier history'}
          </button>
        )}
      </div>
    </section>
  )
}

const RESOLUTION_OPTIONS: { value: DisputeResolution; label: string }[] = [
  { value: 'resolved_by_parties', label: 'Resolved by the businesses' },
  { value: 'mediation', label: 'Resolved through mediation' },
  { value: 'withdrawn', label: 'Withdrawn by the business that opened it' },
  { value: 'other', label: 'Other outcome' },
]

/** Close a dispute: how it ended and a note both businesses see. Changes nothing else. */
function CloseDisputeDialog({ dispute, names, onCancel, onClosed, onAlreadyClosed }: {
  dispute: AdminDisputeDetail
  names: string
  onCancel: () => void
  onClosed: (toast: string) => void
  onAlreadyClosed: () => void
}) {
  const id = useId()
  const dialogRef = useRef<HTMLFormElement>(null)
  const resolutionRef = useRef<HTMLSelectElement>(null)
  const noteRef = useRef<HTMLTextAreaElement>(null)
  const live = useRef(true)
  const [resolution, setResolution] = useState<DisputeResolution | ''>('')
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<{ resolution?: string; note?: string }>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    live.current = true
    const previous = document.activeElement as HTMLElement | null
    resolutionRef.current?.focus()
    return () => {
      live.current = false
      previous?.focus?.()
    }
  }, [])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    const found = {
      resolution: resolution ? undefined : 'Choose how the dispute ended.',
      note: note.trim() ? undefined : 'Write a note for both businesses.',
    }
    setErrors(found)
    if (found.resolution) return resolutionRef.current?.focus()
    if (found.note) return noteRef.current?.focus()
    setBusy(true)
    setFormError(null)
    try {
      await closeDispute(dispute.id, resolution as DisputeResolution, note.trim())
      onClosed('Dispute closed. Both businesses see the outcome and your note on the exchange.')
    } catch (caught) {
      const error = toApiError(caught)
      if (!live.current) return
      setBusy(false)
      if (error.code === 'invalid_dispute_status') return onAlreadyClosed()
      if (error.code === 'validation_error') {
        const field = (name: string) => error.fieldErrors.find((item) => item.field === name)?.message
        if (field('note') || field('resolution')) return setErrors({ resolution: field('resolution'), note: field('note') })
      }
      setFormError(`We couldn’t close the dispute. ${error.userMessage}`)
    }
  }

  return (
    <div className="modal-backdrop">
      <form
        className="admin-dialog exchange-form-dialog"
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
          <div><span>CLOSE DISPUTE</span><h2 id={`${id}-title`}>Close this dispute?</h2></div>
          <button type="button" className="icon-button" aria-label="Close" onClick={onCancel} disabled={busy}><X size={19} aria-hidden="true" /></button>
        </div>
        <div className="modal-body">
          <p className="admin-dialog-intro" id={`${id}-intro`}>
            Record how the dispute between {names} ended. Both businesses see the outcome and your note on the exchange, but not your name. Closing doesn’t change any milestone or the exchange, and it can’t be reopened.
          </p>
          <SelectField
            ref={resolutionRef}
            id={`${id}-resolution`}
            label="How did it end?"
            required
            placeholder="Choose one"
            options={RESOLUTION_OPTIONS}
            value={resolution}
            error={errors.resolution}
            onChange={(event) => {
              setResolution(event.target.value as DisputeResolution | '')
              if (event.target.value) setErrors((current) => ({ ...current, resolution: undefined }))
            }}
            disabled={busy}
          />
          <TextareaField
            ref={noteRef}
            id={`${id}-note`}
            label="Note for both businesses"
            required
            rows={5}
            maxLength={CLOSE_NOTE_MAX}
            hint={`Say what was agreed or what happened. Up to ${CLOSE_NOTE_MAX.toLocaleString('en-US')} characters.`}
            value={note}
            error={errors.note}
            onChange={(event) => {
              setNote(event.target.value)
              if (event.target.value.trim()) setErrors((current) => ({ ...current, note: undefined }))
            }}
            disabled={busy}
          />
          {formError && <p className="admin-notice admin-notice-error" role="alert">{formError}</p>}
        </div>
        <div className="modal-footer">
          <button type="button" className="button button-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="submit" className="button button-primary" disabled={busy}>{busy ? 'Closing…' : 'Close dispute'}</button>
        </div>
      </form>
    </div>
  )
}
