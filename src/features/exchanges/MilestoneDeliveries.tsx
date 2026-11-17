import { useState } from 'react'
import { ExternalLink, FileDown, Send } from 'lucide-react'

import { showErrorToast } from '../../components/feedback'
import { toApiError, type ApiError } from '../../lib/api/errors'
import { canDeliver, formatBytes, formatDateTime, revisionsIncluded, submissionLabel, type MilestoneAction, type Names } from './exchangeCopy'
import { DeliveryForm } from './DeliveryForm'
import { MilestoneReview, SubmissionOutcome } from './MilestoneReview'
import { getAttachmentUrl, listSubmissions, type Exchange, type ExchangeMilestone, type Submission } from './exchangesApi'

type Earlier =
  | { kind: 'hidden' }
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; items: Submission[] }

/**
 * A milestone's action area: its deliveries (the latest first, earlier ones on request) with
 * the decision on each; for the business that delivers it, "Submit delivery" with the form
 * (the receiving business never sees it); and the review: accept or ask for changes, or a
 * reminder once the review period has ended.
 */
export function MilestoneDeliveries({ exchange, milestone, businessId, names, canAct, onSubmitted, onReviewed, onConflict }: {
  exchange: Exchange
  milestone: ExchangeMilestone
  businessId: string
  names: Names
  /** Owners and administrators review, remind and complete; any member delivers. */
  canAct: boolean
  onSubmitted: (submission: Submission) => void
  /** A review action worked: show the toast and reload. */
  onReviewed: (toast: string) => void
  onConflict: (error: ApiError, action: MilestoneAction) => void
}) {
  const [formOpen, setFormOpen] = useState(false)
  const [earlier, setEarlier] = useState<Earlier>({ kind: 'hidden' })
  const latest = milestone.latest_submission
  const mine = milestone.responsible_business_id === businessId
  const deliverable = canDeliver(exchange, milestone, businessId)
  const delivererName = mine ? names.mine : names.other

  const showEarlier = async () => {
    setEarlier({ kind: 'loading' })
    try {
      const items = await listSubmissions(businessId, exchange.id, milestone.id)
      setEarlier({ kind: 'ready', items: items.filter((item) => item.id !== latest?.id) })
    } catch {
      setEarlier({ kind: 'error' })
    }
  }

  return (
    <>
      {latest && (
        <div className="exchange-deliveries" role="group" aria-label={`Deliveries for ${milestone.title}`}>
          <SubmissionCard submission={latest} exchange={exchange} businessId={businessId} names={names} delivererName={delivererName} />
          {latest.number > 1 && earlier.kind !== 'ready' && (
            earlier.kind === 'error' ? (
              <p className="exchange-readonly-note" role="alert">
                We couldn’t load the earlier deliveries. <button type="button" className="text-button exchange-inline-button" onClick={() => void showEarlier()}>Try again</button>
              </p>
            ) : (
              <button type="button" className="text-button exchange-earlier-button" onClick={() => void showEarlier()} disabled={earlier.kind === 'loading'}>
                {earlier.kind === 'loading' ? 'Loading…' : latest.number === 2 ? 'Show the earlier delivery' : `Show the ${latest.number - 1} earlier deliveries`}
              </button>
            )
          )}
          {earlier.kind === 'ready' && earlier.items.map((submission) => (
            <SubmissionCard key={submission.id} submission={submission} exchange={exchange} businessId={businessId} names={names} delivererName={delivererName} />
          ))}
        </div>
      )}
      {deliverable && (formOpen ? (
        <DeliveryForm
          exchange={exchange}
          milestone={milestone}
          businessId={businessId}
          names={names}
          onCancel={() => setFormOpen(false)}
          onSubmitted={(submission) => {
            setFormOpen(false)
            setEarlier({ kind: 'hidden' })
            onSubmitted(submission)
          }}
          onConflict={(error) => {
            setFormOpen(false)
            onConflict(error, 'deliver')
          }}
        />
      ) : (
        <div className="exchange-milestone-cta">
          <button type="button" className="button button-primary button-small" onClick={() => setFormOpen(true)}>
            <Send size={14} aria-hidden="true" /> {milestone.status === 'changes_requested' ? 'Submit revision' : 'Submit delivery'}
          </button>
          <span>Any member of {names.mine} can submit it.</span>
        </div>
      ))}
      <MilestoneReview
        exchange={exchange}
        milestone={milestone}
        businessId={businessId}
        names={names}
        canAct={canAct}
        onDone={(toast) => {
          setEarlier({ kind: 'hidden' })
          onReviewed(toast)
        }}
        onConflict={onConflict}
      />
    </>
  )
}

/** One delivery: its label, who submitted it and when, the note, links and files. */
function SubmissionCard({ submission, exchange, businessId, names, delivererName }: {
  submission: Submission
  exchange: Exchange
  businessId: string
  names: Names
  delivererName: string
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const label = submissionLabel(submission, exchange.revision_limit)
  const business = submission.submitted_by_business_id === businessId ? names.mine : names.other

  const download = async (uploadId: string, name: string) => {
    setBusy(uploadId)
    // Open the tab while the click still counts as the user's, so popup blockers allow it,
    // then point it at a fresh link once the API returns one (row 148).
    const tab = window.open('', '_blank')
    if (tab) tab.opener = null
    try {
      const file = await getAttachmentUrl(businessId, exchange.id, submission.milestone_id, submission.id, uploadId)
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
          {submission.submitted_by_user_name ?? 'A former team member'} ({business}) · <time dateTime={submission.submitted_at}>{formatDateTime(submission.submitted_at)}</time>
        </small>
      </header>
      <p className="exchange-submission-note">{submission.note}</p>
      {submission.links.length > 0 && (
        <ul className="exchange-submission-links" aria-label="Links">
          {submission.links.map((link, at) => (
            <li key={at}>
              <a href={link.url} target="_blank" rel="noopener noreferrer">
                <ExternalLink size={13} aria-hidden="true" /> {link.label ?? link.url}
              </a>
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
      {submission.beyond_revision_limit && (
        <p className="exchange-revision-note">
          The agreement includes {revisionsIncluded(exchange.revision_limit)}, so it didn’t require {delivererName} to make this revision.
        </p>
      )}
      <SubmissionOutcome submission={submission} businessId={businessId} names={names} />
    </article>
  )
}
