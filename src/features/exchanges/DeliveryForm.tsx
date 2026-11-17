import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { FileText, Link2, Paperclip, Send, Trash2 } from 'lucide-react'

import { TextareaField, TextField } from '../../components/forms'
import { toApiError, type ApiError } from '../../lib/api/errors'
import { checkDeliveryFile, DELIVERY_UPLOAD_LIMITS, formatMegabytes, uploadFile } from '../businesses/uploadsApi'
import { formatBytes, revisionsIncluded, submissionLabel, type Names } from './exchangeCopy'
import { DELIVERY_LIMITS, submitDelivery, type Exchange, type ExchangeMilestone, type Submission } from './exchangesApi'

interface LinkRow {
  key: number
  url: string
  label: string
}

type FileRow =
  | { key: number; name: string; size: number; state: 'uploading'; percent: number }
  | { key: number; name: string; size: number; state: 'ready'; uploadId: string }
  | { key: number; name: string; size: number; state: 'failed'; message: string }

const ACCEPT = DELIVERY_UPLOAD_LIMITS.types.join(',')

function isWebUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * The "Submit delivery" form on a milestone your business delivers: a required note, up to 10
 * links and up to 10 files. Files upload as soon as they are chosen (the existing upload flow,
 * category `exchange_delivery`); the delivery is submitted with their IDs in order.
 */
export function DeliveryForm({ exchange, milestone, businessId, names, onCancel, onSubmitted, onConflict }: {
  exchange: Exchange
  milestone: ExchangeMilestone
  businessId: string
  names: Names
  onCancel: () => void
  onSubmitted: (submission: Submission) => void
  /** The milestone or exchange changed, or the action now belongs to the other business. */
  onConflict: (error: ApiError) => void
}) {
  const id = useId()
  const nextKey = useRef(0)
  const fileInput = useRef<HTMLInputElement>(null)
  const noteRef = useRef<HTMLTextAreaElement>(null)
  const live = useRef(true)
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState<string | undefined>()
  const [links, setLinks] = useState<LinkRow[]>([])
  const [linkErrors, setLinkErrors] = useState<Record<number, string>>({})
  const [files, setFiles] = useState<FileRow[]>([])
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    live.current = true
    noteRef.current?.focus()
    return () => {
      live.current = false
    }
  }, [])

  const isRevision = milestone.status === 'changes_requested'
  const nextRevision = milestone.revisions_used + 1
  const beyondLimit = isRevision && milestone.revisions_used >= exchange.revision_limit
  const heading = isRevision
    ? submissionLabel({ number: (milestone.latest_submission?.number ?? 0) + 1, is_revision: true, revision_number: nextRevision, beyond_revision_limit: beyondLimit }, exchange.revision_limit)
    : 'Submit delivery'

  const updateFile = (key: number, row: FileRow) => setFiles((current) => current.map((item) => (item.key === key ? row : item)))

  const addFiles = (chosen: File[]) => {
    setFormError(null)
    const room = DELIVERY_LIMITS.files - files.length
    if (chosen.length > room) setFormError(`You can attach up to ${DELIVERY_LIMITS.files} files. Share the rest as links.`)
    for (const file of chosen.slice(0, Math.max(room, 0))) {
      const key = nextKey.current++
      const problem = checkDeliveryFile(file)
      if (problem) {
        setFiles((current) => [...current, { key, name: file.name, size: file.size, state: 'failed', message: problem }])
        continue
      }
      setFiles((current) => [...current, { key, name: file.name, size: file.size, state: 'uploading', percent: 0 }])
      uploadFile(businessId, 'exchange_delivery', file, (fraction) => {
        if (live.current) updateFile(key, { key, name: file.name, size: file.size, state: 'uploading', percent: Math.round(fraction * 100) })
      })
        .then((upload) => {
          if (live.current) updateFile(key, { key, name: file.name, size: file.size, state: 'ready', uploadId: upload.id })
        })
        .catch((error: unknown) => {
          if (live.current) updateFile(key, { key, name: file.name, size: file.size, state: 'failed', message: `${file.name} didn’t upload. ${toApiError(error).userMessage}` })
        })
    }
  }

  const removeFile = (key: number) => setFiles((current) => current.filter((item) => item.key !== key))

  const validate = (): boolean => {
    let ok = true
    if (!note.trim()) {
      setNoteError('Write a note on what you delivered.')
      noteRef.current?.focus()
      ok = false
    } else setNoteError(undefined)
    const errors: Record<number, string> = {}
    for (const link of links) {
      const url = link.url.trim()
      if (!url && !link.label.trim()) continue
      if (!url) errors[link.key] = 'Add the web address, or remove this link.'
      else if (!isWebUrl(url)) errors[link.key] = 'Enter a full web address starting with https:// or http://.'
    }
    setLinkErrors(errors)
    if (Object.keys(errors).length > 0) ok = false
    if (files.some((file) => file.state === 'uploading')) {
      setFormError('Wait for the files to finish uploading.')
      ok = false
    } else if (files.some((file) => file.state === 'failed')) {
      setFormError('Remove the files that couldn’t be attached, or add them again.')
      ok = false
    } else setFormError(ok ? null : 'Check the highlighted fields.')
    return ok
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (submitting || !validate()) return
    setSubmitting(true)
    try {
      const submission = await submitDelivery(businessId, exchange.id, milestone.id, {
        note: note.trim(),
        links: links.filter((link) => link.url.trim()).map((link) => ({ url: link.url.trim(), label: link.label.trim() || null })),
        attachment_upload_ids: files.flatMap((file) => (file.state === 'ready' ? [file.uploadId] : [])),
      })
      onSubmitted(submission)
    } catch (caught) {
      const error = toApiError(caught)
      if (!live.current) return
      setSubmitting(false)
      if (error.code === 'invalid_exchange_transition' || error.code === 'exchange_party_not_allowed' || error.code === 'not_found') {
        onConflict(error)
      } else if (error.code === 'invalid_upload') {
        setFormError('One of the files can’t be attached any more. Remove it and add it again.')
      } else if (error.code === 'validation_error') {
        const noteProblem = error.fieldErrors.find((item) => item.field === 'note')
        if (noteProblem) setNoteError(noteProblem.message)
        setFormError(error.fieldErrors.filter((item) => item.field !== 'note').map((item) => item.message).join(' ') || 'Check the highlighted fields.')
      } else {
        setFormError(`We couldn’t submit the delivery. ${error.userMessage}`)
      }
    }
  }

  return (
    <form className="exchange-delivery-form" onSubmit={(event) => void submit(event)} aria-labelledby={`${id}-title`} noValidate>
      <h4 id={`${id}-title`}>{heading}</h4>
      <p className="exchange-delivery-intro">
        {names.other} reviews it against “Done when” and has {exchange.review_period_days === 1 ? '1 day' : `${exchange.review_period_days} days`} to accept it or ask for changes. A delivery can’t be changed once submitted.
      </p>
      {beyondLimit && (
        <p className="exchange-revision-note" role="note">
          You’ve made the {revisionsIncluded(exchange.revision_limit)} the agreement includes, so it doesn’t require this revision. You can still submit one.
        </p>
      )}
      <TextareaField
        ref={noteRef}
        id={`${id}-note`}
        label="Note"
        required
        rows={4}
        maxLength={DELIVERY_LIMITS.noteMax}
        hint="What you delivered and how it meets what the milestone needs."
        value={note}
        error={noteError}
        onChange={(event) => {
          setNote(event.target.value)
          if (noteError && event.target.value.trim()) setNoteError(undefined)
        }}
        disabled={submitting}
      />

      <fieldset className="exchange-delivery-group">
        <legend>Links <span>{links.length} of {DELIVERY_LIMITS.links}</span></legend>
        {links.map((link, at) => (
          <div key={link.key} className="exchange-delivery-link">
            <TextField
              label={`Link ${at + 1} address`}
              type="url"
              inputMode="url"
              placeholder="https://"
              maxLength={DELIVERY_LIMITS.urlMax}
              value={link.url}
              error={linkErrors[link.key]}
              disabled={submitting}
              onChange={(event) => {
                setLinks((current) => current.map((item) => (item.key === link.key ? { ...item, url: event.target.value } : item)))
                if (linkErrors[link.key]) setLinkErrors(({ [link.key]: _cleared, ...rest }) => rest)
              }}
            />
            <TextField
              label={`Link ${at + 1} label (optional)`}
              placeholder="Figma file"
              maxLength={DELIVERY_LIMITS.labelMax}
              value={link.label}
              disabled={submitting}
              onChange={(event) => setLinks((current) => current.map((item) => (item.key === link.key ? { ...item, label: event.target.value } : item)))}
            />
            <button type="button" className="exchange-icon-button exchange-delivery-remove" aria-label={`Remove link ${at + 1}`} disabled={submitting} onClick={() => setLinks((current) => current.filter((item) => item.key !== link.key))}>
              <Trash2 size={14} aria-hidden="true" />
            </button>
          </div>
        ))}
        <button
          type="button"
          className="button button-secondary button-small"
          disabled={submitting || links.length >= DELIVERY_LIMITS.links}
          onClick={() => setLinks((current) => [...current, { key: nextKey.current++, url: '', label: '' }])}
        >
          <Link2 size={14} aria-hidden="true" /> Add a link
        </button>
      </fieldset>

      <fieldset className="exchange-delivery-group">
        <legend>Files <span>{files.length} of {DELIVERY_LIMITS.files}</span></legend>
        {files.length > 0 && (
          <ul className="exchange-delivery-files" aria-label="Files to deliver">
            {files.map((file) => (
              <li key={file.key} className={`exchange-delivery-file exchange-delivery-file-${file.state}`}>
                <FileText size={16} aria-hidden="true" />
                <span className="exchange-delivery-file-name">
                  <strong>{file.name}</strong>
                  <small>
                    {file.state === 'uploading' ? `Uploading… ${file.percent}%` : file.state === 'ready' ? `${formatBytes(file.size)} · uploaded` : file.message}
                  </small>
                  {file.state === 'uploading' && (
                    <span className="exchange-upload-progress" role="progressbar" aria-label={`Uploading ${file.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={file.percent}>
                      <span style={{ width: `${Math.max(file.percent, 4)}%` }} />
                    </span>
                  )}
                </span>
                <button type="button" className="exchange-icon-button" aria-label={`Remove ${file.name}`} disabled={submitting} onClick={() => removeFile(file.key)}>
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <button type="button" className="button button-secondary button-small" disabled={submitting || files.length >= DELIVERY_LIMITS.files} onClick={() => fileInput.current?.click()}>
          <Paperclip size={14} aria-hidden="true" /> Add files
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          accept={ACCEPT}
          hidden
          aria-label="Choose files to deliver"
          onChange={(event) => {
            const chosen = Array.from(event.target.files ?? [])
            event.target.value = ''
            if (chosen.length > 0) addFiles(chosen)
          }}
        />
        <p className="form-field-hint">JPEG, PNG or WebP images, or PDFs, up to {formatMegabytes(DELIVERY_UPLOAD_LIMITS.maxBytes)} each. Share other formats or larger files as links.</p>
      </fieldset>

      {formError && <p className="match-notice match-notice-error" role="alert">{formError}</p>}
      <div className="exchange-delivery-actions">
        <button type="button" className="button button-secondary button-small" onClick={onCancel} disabled={submitting}>Cancel</button>
        <button type="submit" className="button button-primary button-small" disabled={submitting}>
          {submitting ? 'Submitting…' : <><Send size={14} aria-hidden="true" /> {isRevision ? 'Submit revision' : 'Submit delivery'}</>}
        </button>
      </div>
    </form>
  )
}
