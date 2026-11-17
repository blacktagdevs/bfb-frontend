import type { ApiError } from '../../lib/api/errors'
import { formatMatchDate } from '../matching/matchInboxDisplay'
import type { Exchange, ExchangeEvent, ExchangeMilestone, ExchangeStatus, MilestoneStatus, Submission } from './exchangesApi'

// Copy for exchanges: the one place that turns exchange codes into words.

export const EXCHANGE_STATUS_LABELS: Record<ExchangeStatus, string> = {
  active: 'Active',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

export const MILESTONE_STATUS_LABELS: Record<MilestoneStatus, string> = {
  pending: 'Not started',
  submitted: 'Submitted',
  changes_requested: 'Changes requested',
  accepted: 'Accepted',
}

export interface Names {
  mine: string
  other: string
}

/** "3 milestones", "1 milestone". */
export function milestoneCount(count: number): string {
  return count === 1 ? '1 milestone' : `${count} milestones`
}

/** "1 of 3 milestones accepted". */
export function progressText(accepted: number, count: number): string {
  return `${accepted} of ${count === 1 ? '1 milestone' : `${count} milestones`} accepted`
}

/** Accepted milestones as a whole percentage, for a progress bar. */
export function progressPercent(accepted: number, count: number): number {
  return count > 0 ? Math.round((Math.min(accepted, count) / count) * 100) : 0
}

/** Who delivers a milestone to whom, from the active business's point of view. */
export function deliveryLine(milestone: ExchangeMilestone, myBusinessId: string, names: Names): { text: string; mine: boolean } {
  const mine = milestone.responsible_business_id === myBusinessId
  return mine
    ? { text: `${names.mine} delivers to ${names.other}`, mine }
    : { text: `${names.other} delivers to ${names.mine}`, mine }
}

const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' })

/** "20 Nov, 15:04" (with the year when it is not this year), in the viewer's time zone. */
export function formatDateTime(value: string, now = new Date()): string {
  return `${formatMatchDate(value, now)}, ${time.format(new Date(value))}`
}

const dayDate = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
const dayDateYear = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

/** "Friday 27 November at 10:00" (with the year when it is not this year), in the viewer's time zone. */
export function formatDayTime(value: string, now = new Date()): string {
  const date = new Date(value)
  const day = (date.getFullYear() === now.getFullYear() ? dayDate : dayDateYear).format(date).replace(',', '')
  return `${day} at ${time.format(date)}`
}

/** Whether the milestone's review period has ended with its delivery still undecided. */
export function reviewOverdue(milestone: ExchangeMilestone, now = new Date()): boolean {
  return milestone.status === 'submitted' && milestone.review_due_at !== null && new Date(milestone.review_due_at).getTime() <= now.getTime()
}

/** Whether the delivering business can send a reminder on the milestone now (owners and administrators). */
export function canRemind(exchange: Exchange, milestone: ExchangeMilestone, businessId: string, now = new Date()): boolean {
  return exchange.status === 'active' && milestone.responsible_business_id === businessId && reviewOverdue(milestone, now) && milestone.reminder_sent_at === null
}

/** Whether your business reviews the milestone's latest delivery now (owners and administrators). */
export function canReviewMilestone(exchange: Exchange, milestone: ExchangeMilestone, businessId: string): boolean {
  return exchange.status === 'active' && milestone.receiving_business_id === businessId && milestone.status === 'submitted' && milestone.latest_submission !== null
}

export type MilestoneAction = 'deliver' | 'accept' | 'request_changes' | 'remind'

const ACTION_NOTHING: Record<MilestoneAction, string> = {
  deliver: 'your delivery wasn’t submitted',
  accept: 'nothing was accepted',
  request_changes: 'your change request wasn’t sent',
  remind: 'no reminder was sent',
}

function detail(error: ApiError, key: string): unknown {
  return typeof error.details === 'object' && error.details !== null ? (error.details as Record<string, unknown>)[key] : undefined
}

/**
 * The red notice when an action on a milestone was refused because something changed: the page
 * reloads the exchange and says why, as proposals and agreements do (rows 103 and 146).
 */
export function conflictNotice(error: ApiError, action: MilestoneAction, names: Names): string {
  const nothing = ACTION_NOTHING[action]
  if (error.code === 'business_role_required') return `Only owners and administrators of ${names.mine} can do that, so ${nothing}. Your role may have changed.`
  if (error.code === 'exchange_party_not_allowed') {
    const required = detail(error, 'required')
    if (required === 'receiving_business') return `Only the business that receives this milestone can review it, so ${nothing}.`
    if (required === 'responsible_business') return `Only the business that delivers this milestone can do that, so ${nothing}.`
    return `That belongs to ${names.other}, so ${nothing}.`
  }
  if (error.code === 'invalid_exchange_transition') {
    switch (detail(error, 'reason')) {
      case 'not_latest_submission':
        return `${names.other} submitted a newer delivery since you opened the page, so ${nothing}. Review the latest one below.`
      case 'review_period_running':
        return `The review period hasn’t ended yet, so ${nothing}. You can send one once it ends.`
      case 'reminder_already_sent':
        return `A reminder was already sent for this delivery, so ${nothing}. The page now shows it.`
      case 'exchange_closed':
        return `This exchange is closed, so ${nothing}.`
    }
  }
  return `This milestone or exchange changed since you opened it, so ${nothing}. The page now shows where it stands.`
}

function earliest(milestones: ExchangeMilestone[]): ExchangeMilestone | undefined {
  return milestones[0]
}

/**
 * What your business does next on the exchange, in one or two sentences. Until notifications
 * arrive (Phase 7) it says what the other business needs to do, never that they were told.
 */
export function nextStepText(exchange: Exchange, businessId: string, names: Names, { canReview, now = new Date() }: { canReview: boolean; now?: Date }): string {
  if (exchange.status === 'completed') return 'The exchange is complete. There is nothing more to do.'
  if (exchange.status === 'cancelled') return 'The exchange was cancelled. There is nothing more to do.'
  if (exchange.milestones.length === 0) return 'This exchange has no milestones.'

  const ordered = [...exchange.milestones].sort((x, y) => x.sequence - y.sequence)
  const mine = ordered.filter((milestone) => milestone.responsible_business_id === businessId)
  const theirs = ordered.filter((milestone) => milestone.responsible_business_id !== businessId)
  const due = (milestone: ExchangeMilestone, prefix: string) => (milestone.due_date ? `${prefix}${formatMatchDate(milestone.due_date)}` : '')

  const toRedo = earliest(mine.filter((milestone) => milestone.status === 'changes_requested'))
  if (toRedo) return `Resubmit “${toRedo.title}”: ${names.other} asked for changes.`

  const toReview = earliest(theirs.filter((milestone) => milestone.status === 'submitted'))
  if (toReview) {
    const by = toReview.review_due_at ? ` by ${formatMatchDate(toReview.review_due_at)}` : ''
    const who = canReview ? '' : ` An owner or administrator of ${names.mine} does this.`
    return `Review “${toReview.title}” from ${names.other}${by}: accept it or ask for changes.${who}`
  }

  const toDeliver = earliest(mine.filter((milestone) => milestone.status === 'pending'))
  if (toDeliver) return `Deliver “${toDeliver.title}”${due(toDeliver, ' by ')}.`

  const overdue = earliest(mine.filter((milestone) => reviewOverdue(milestone, now)))
  if (overdue?.deemed_acceptance_at) {
    return `Nothing for you to do now. If ${names.other} doesn’t decide on “${overdue.title}” by ${formatMatchDate(overdue.deemed_acceptance_at)}, it is treated as accepted.`
  }
  if (overdue) {
    const who = canReview ? '' : ` An owner or administrator of ${names.mine} does this.`
    return `${names.other} didn’t review “${overdue.title}” in time. Send a reminder: if they still don’t decide within 5 business days, it is treated as accepted.${who}`
  }

  const inReview = earliest(mine.filter((milestone) => milestone.status === 'submitted'))
  if (inReview) {
    const by = inReview.review_due_at ? `, due by ${formatMatchDate(inReview.review_due_at)}` : ''
    return `Nothing for you to do now. ${names.other} needs to review “${inReview.title}”${by}.`
  }

  const theirNext = earliest(theirs.filter((milestone) => milestone.status === 'pending' || milestone.status === 'changes_requested'))
  if (theirNext) return `Nothing for you to do now. ${names.other} delivers “${theirNext.title}” next${due(theirNext, ', due ')}.`

  return 'Every milestone is accepted. Completing the exchange comes next.'
}

/** "milestone.reminder_sent" → "Reminder sent", for history types this screen doesn't know yet. */
export function humanizeCode(code: string): string {
  const last = code.split('.').pop() ?? code
  const words = last.replace(/_/g, ' ').trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : code
}

function statusWord(entry: ExchangeEvent, status: string): string {
  const labels: Record<string, string> = entry.milestone_id ? MILESTONE_STATUS_LABELS : EXCHANGE_STATUS_LABELS
  return labels[status] ?? humanizeCode(status)
}

function metaNumber(entry: ExchangeEvent, key: string): number | null {
  const value = entry.metadata[key]
  return typeof value === 'number' ? value : null
}

/** What a history entry records, as a short line. Unknown types read from their code. */
export function historyTitle(entry: ExchangeEvent, revisionLimit: number): string {
  switch (entry.type) {
    case 'exchange.activated':
      return 'Exchange started: both businesses signed the agreement'
    case 'exchange.completed':
      return 'Exchange completed'
    case 'exchange.cancelled':
      return 'Exchange cancelled'
    case 'milestone.submitted': {
      const revision = entry.metadata.is_revision === true ? metaNumber(entry, 'revision_number') : null
      if (revision === null) return 'Delivery submitted'
      return entry.metadata.beyond_revision_limit === true
        ? `Revision ${revision} submitted (beyond the ${revisionLimit} agreed)`
        : `Revision ${revision} submitted`
    }
    case 'milestone.accepted':
      return 'Delivery accepted'
    case 'milestone.deemed_accepted':
      return 'Treated as accepted under the agreement’s terms: no decision came within 5 business days of the reminder'
    case 'milestone.changes_requested':
      return 'Changes requested'
    case 'milestone.reminder_sent': {
      const deemed = entry.metadata.deemed_acceptance_at
      return typeof deemed === 'string' ? `Reminder sent: treated as accepted on ${formatMatchDate(deemed)} if there’s no decision by then` : 'Reminder sent'
    }
    default: {
      const title = humanizeCode(entry.type)
      if (entry.to_status && entry.from_status) return `${title}: ${statusWord(entry, entry.from_status)} to ${statusWord(entry, entry.to_status)}`
      if (entry.to_status) return `${title}: ${statusWord(entry, entry.to_status)}`
      return title
    }
  }
}

/** Who did it: "Dana Studio (Northstar Digital)", "BFB" for BFB itself, "BFB staff". */
export function historyActor(entry: ExchangeEvent, myBusinessId: string, names: Names): string {
  if (entry.actor_type === 'system') return 'BFB'
  if (entry.actor_type === 'staff') return entry.actor_user_name ? `${entry.actor_user_name}, BFB staff` : 'BFB staff'
  const business = entry.actor_business_id === myBusinessId ? names.mine : names.other
  return `${entry.actor_user_name ?? 'A former team member'} (${business})`
}

/** "Delivery 1", "Revision 1 of 2", "Revision 3 (beyond the 2 agreed)". */
export function submissionLabel(submission: Pick<Submission, 'number' | 'is_revision' | 'revision_number' | 'beyond_revision_limit'>, revisionLimit: number): string {
  if (!submission.is_revision || submission.revision_number === null) return `Delivery ${submission.number}`
  return submission.beyond_revision_limit
    ? `Revision ${submission.revision_number} (beyond the ${revisionLimit} agreed)`
    : `Revision ${submission.revision_number} of ${revisionLimit}`
}

/** "No rounds of changes are included", "1 round of changes", "2 rounds of changes". */
export function revisionsIncluded(limit: number): string {
  if (limit === 0) return 'no rounds of changes'
  return limit === 1 ? '1 round of changes' : `${limit} rounds of changes`
}

/** "482 KB", "1.2 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Whether your business can submit a delivery for the milestone now (any member). */
export function canDeliver(exchange: Exchange, milestone: ExchangeMilestone, businessId: string): boolean {
  return exchange.status === 'active' && milestone.responsible_business_id === businessId && (milestone.status === 'pending' || milestone.status === 'changes_requested')
}
