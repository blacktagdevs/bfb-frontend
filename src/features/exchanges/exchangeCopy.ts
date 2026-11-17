import type { ApiError } from '../../lib/api/errors'
import { formatMatchDate } from '../matching/matchInboxDisplay'
import type { DisputeCategory, DisputeResolution, Exchange, ExchangeEvent, ExchangeMilestone, ExchangeStatus, ExchangeSummary, MilestoneStatus, Submission } from './exchangesApi'

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

/** Dispute categories (bfb-api docs/EXCHANGES.md, "Disputes"), in the order the form offers them. */
export const DISPUTE_CATEGORY_LABELS: Record<DisputeCategory, string> = {
  missed_deadline: 'A deadline was missed',
  rejected_delivery: 'A delivery was rejected',
  quality: 'The quality of the work',
  non_performance: 'Work not done as agreed',
  other: 'Something else',
}

/** How staff recorded a dispute's outcome. */
export const DISPUTE_RESOLUTION_LABELS: Record<DisputeResolution, string> = {
  resolved_by_parties: 'Resolved by the businesses',
  mediation: 'Resolved through mediation',
  withdrawn: 'Withdrawn',
  other: 'Other outcome',
}

function labelOf(labels: Record<string, string>, code: unknown): string | null {
  return typeof code === 'string' ? (labels[code] ?? humanizeCode(code)) : null
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
export type CompletionAction = 'request_completion' | 'confirm_completion' | 'withdraw_completion' | 'decline_completion' | 'completion_record'
export type CancellationAction = 'give_notice' | 'withdraw_notice' | 'agree_cancel'
export type DisputeAction = 'open_dispute' | 'respond_dispute' | 'withdraw_dispute'
export type ExchangeAction = MilestoneAction | CompletionAction | CancellationAction | DisputeAction

const ACTION_NOTHING: Record<ExchangeAction, string> = {
  deliver: 'your delivery wasn’t submitted',
  accept: 'nothing was accepted',
  request_changes: 'your change request wasn’t sent',
  remind: 'no reminder was sent',
  request_completion: 'the exchange wasn’t marked complete',
  confirm_completion: 'the exchange wasn’t completed',
  withdraw_completion: 'nothing was withdrawn',
  decline_completion: 'nothing was declined',
  completion_record: 'the completion record didn’t open',
  give_notice: 'no notice was given',
  withdraw_notice: 'the notice wasn’t withdrawn',
  agree_cancel: 'the exchange wasn’t cancelled',
  open_dispute: 'your dispute wasn’t opened',
  respond_dispute: 'your response wasn’t sent',
  withdraw_dispute: 'the dispute wasn’t withdrawn',
}

/** Why completion can't happen yet, as the end of a sentence. Unknown blockers read generically. */
export function blockerText(code: string): string {
  switch (code) {
    case 'milestones_not_accepted':
      return 'not every milestone is accepted yet'
    case 'dispute_open':
      return 'a dispute is open, and BFB staff need to close it first'
    default:
      return `something still needs resolving first (${humanizeCode(code).toLowerCase()})`
  }
}

/** Several blockers joined into one sentence, for "can’t be completed yet: …". */
export function blockersSentence(codes: string[]): string {
  const parts = codes.map(blockerText)
  return parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

function detail(error: ApiError, key: string): unknown {
  return typeof error.details === 'object' && error.details !== null ? (error.details as Record<string, unknown>)[key] : undefined
}

/**
 * The red notice when an action on a milestone was refused because something changed: the page
 * reloads the exchange and says why, as proposals and agreements do (rows 103 and 146).
 */
export function conflictNotice(error: ApiError, action: ExchangeAction, names: Names): string {
  const nothing = ACTION_NOTHING[action]
  if (error.code === 'business_role_required') return `Only owners and administrators of ${names.mine} can do that, so ${nothing}. Your role may have changed.`
  if (error.code === 'exchange_party_not_allowed') {
    const required = detail(error, 'required')
    if (required === 'receiving_business') return `Only the business that receives this milestone can review it, so ${nothing}.`
    if (required === 'responsible_business') return `Only the business that delivers this milestone can do that, so ${nothing}.`
    if (required === 'giving_business') return `Only the business that gave the cancellation notice can withdraw it, so ${nothing}.`
    if (required === 'opening_business') return `Only the business that opened the dispute can withdraw it, so ${nothing}.`
    if (required === 'other_business') {
      if (action === 'agree_cancel') return `Only ${names.other} can agree to the notice your business gave, so ${nothing}.`
      if (action === 'respond_dispute') return `Only ${names.other} can respond to the dispute your business opened, so ${nothing}.`
      return `Only ${names.other} can confirm the request your business made, so ${nothing}.`
    }
    return `That belongs to ${names.other}, so ${nothing}.`
  }
  if (error.code === 'dispute_already_open') return `A dispute is already open on this exchange, so ${nothing}. The page now shows it.`
  if (error.code === 'invalid_dispute_status') {
    if (detail(error, 'reason') === 'already_responded') return `Someone at ${names.mine} already responded to the dispute, so ${nothing}. The page now shows the response.`
    return `The dispute was closed since you opened the page, so ${nothing}. The page now shows where it stands.`
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
        return `This exchange is closed, so ${nothing}. The page now shows where it stands.`
      case 'completion_blocked': {
        const blockers = detail(error, 'blockers')
        const why = Array.isArray(blockers) && blockers.length > 0 ? blockersSentence(blockers.map(String)) : 'something still needs resolving'
        return `The exchange can’t be completed yet: ${why}. So ${nothing}.`
      }
      case 'completion_already_requested':
        return `Completion was already requested, so ${nothing}. The page now shows the request.`
      case 'no_completion_request':
        return `The completion request was withdrawn or declined since you opened the page, so ${nothing}.`
      case 'not_completed':
        return `The exchange isn’t completed yet, so ${nothing}.`
      case 'cancellation_pending':
        return `A cancellation notice is already running, so ${nothing}. The page now shows it.`
      case 'no_cancellation_notice':
        return `The cancellation notice was withdrawn or took effect since you opened the page, so ${nothing}. The page now shows where it stands.`
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

  const request = exchange.completion.request
  if (request?.status === 'pending') {
    if (request.requested_by_business_id === businessId) return `Nothing for you to do now. ${names.other} needs to confirm completion.`
    const who = canReview ? '' : ` An owner or administrator of ${names.mine} does this.`
    return `Confirm completion: ${names.other} marked the exchange complete.${who}`
  }
  const blockers = exchange.completion.blockers.filter((code) => code !== 'milestones_not_accepted')
  if (blockers.length > 0) return `Every milestone is accepted, but the exchange can’t be completed yet: ${blockersSentence(blockers)}.`
  const who = canReview ? '' : ` An owner or administrator of either business does this.`
  return `Every milestone is accepted. Mark the exchange complete; ${names.other} then confirms it.${who}`
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
/** `revisionLimit` is `null` where the screen doesn't have it (staff screens). */
export function historyTitle(entry: ExchangeEvent, revisionLimit: number | null): string {
  switch (entry.type) {
    case 'exchange.activated':
      return 'Exchange started: both businesses signed the agreement'
    case 'exchange.completed':
      // Confirming completion while a notice to cancel was pending ends the notice (API-6.6).
      return entry.metadata.superseded_cancellation_id
        ? 'Exchange completed: both businesses confirmed, which ended the notice to cancel'
        : 'Exchange completed: both businesses confirmed'
    case 'exchange.completion_requested':
      return 'Completion requested'
    case 'exchange.completion_withdrawn':
      return entry.metadata.by_requesting_business === false ? 'Completion request declined' : 'Completion request withdrawn'
    case 'exchange.cancelled':
      if (entry.metadata.how === 'agreed') return 'Exchange cancelled: both businesses agreed to cancel now'
      if (entry.metadata.how === 'notice') return 'Exchange cancelled: the notice period ended'
      return 'Exchange cancelled'
    case 'exchange.cancellation_noticed': {
      const effective = entry.metadata.effective_at
      return typeof effective === 'string' && metaNumber(entry, 'notice_days') !== 0
        ? `Notice to cancel given: the exchange is cancelled on ${formatMatchDate(effective)} unless it’s withdrawn`
        : 'Notice to cancel given'
    }
    case 'exchange.cancellation_withdrawn':
      return 'Cancellation notice withdrawn'
    case 'dispute.opened': {
      const category = labelOf(DISPUTE_CATEGORY_LABELS, entry.metadata.category)
      return category ? `Dispute opened: ${category.charAt(0).toLowerCase()}${category.slice(1)}` : 'Dispute opened'
    }
    case 'dispute.responded':
      return 'Response to the dispute added'
    case 'dispute.withdrawn':
      return 'Dispute withdrawn'
    case 'dispute.closed': {
      const resolution = labelOf(DISPUTE_RESOLUTION_LABELS, entry.metadata.resolution)
      return resolution ? `Dispute closed by BFB staff: ${resolution.charAt(0).toLowerCase()}${resolution.slice(1)}` : 'Dispute closed by BFB staff'
    }
    case 'milestone.submitted': {
      const revision = entry.metadata.is_revision === true ? metaNumber(entry, 'revision_number') : null
      if (revision === null) return 'Delivery submitted'
      return entry.metadata.beyond_revision_limit === true
        ? `Revision ${revision} submitted (beyond the ${revisionLimit ?? 'agreed limit'}${revisionLimit === null ? '' : ' agreed'})`
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

/**
 * Who did it: "Dana Studio (Northstar Digital)", "BFB" for BFB itself, "BFB staff". Businesses
 * aren't told which staff member acted, so the name shows only on staff screens (`showStaffName`).
 */
export function historyActor(entry: ExchangeEvent, myBusinessId: string, names: Names, { showStaffName = false }: { showStaffName?: boolean } = {}): string {
  if (entry.actor_type === 'system') return 'BFB'
  if (entry.actor_type === 'staff') return showStaffName && entry.actor_user_name ? `${entry.actor_user_name}, BFB staff` : 'BFB staff'
  const business = entry.actor_business_id === myBusinessId ? names.mine : names.other
  return `${entry.actor_user_name ?? 'A former team member'} (${business})`
}

/** "14 days’ notice", "1 day’s notice", "no notice". */
export function noticeText(days: number): string {
  if (days === 0) return 'no notice'
  return days === 1 ? '1 day’s notice' : `${days} days’ notice`
}

/** When a notice given now would take effect: `days` calendar days later (bfb-api counts calendar days). */
export function noticeEffectiveAt(days: number, now = new Date()): Date {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000)
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

/** When a closed exchange closed (`completed_at` or `cancelled_at`, API-6.6); `null` while it is active. */
export function closedAt(exchange: Pick<ExchangeSummary, 'status' | 'completed_at' | 'cancelled_at'>): string | null {
  if (exchange.status === 'completed') return exchange.completed_at
  if (exchange.status === 'cancelled') return exchange.cancelled_at
  return null
}

/** The IP option's section in the Exchange Terms. */
export const IP_TERMS_SECTIONS: Record<NonNullable<Exchange['ip_terms']>, string> = {
  transfer_on_payment_and_completion: '6.2',
  license_to_use: '6.3',
  each_keeps_own: '6.4',
}

/**
 * What accepting a delivery means for who owns the work, under the agreement's IP option
 * (Exchange Terms 6.2 to 6.4). `names.mine` receives the work and `names.other` delivers it.
 * Wording goes through legal review with rows 76 and 95 (DESIGN_SIGNOFFS.md row 215).
 */
export function acceptOwnershipText(exchange: Pick<Exchange, 'ip_terms' | 'ip_terms_label'>, names: Names): string {
  const { ip_terms: option } = exchange
  if (!option) {
    return `The agreement’s terms on who owns or may use the work apply to it (Exchange Terms section 6).`
  }
  const named = `The agreement uses “${exchange.ip_terms_label ?? option}” (Exchange Terms ${IP_TERMS_SECTIONS[option]}):`
  const once = `once it’s accepted and ${names.mine} has given ${names.other} everything it owes under the agreement`
  switch (option) {
    case 'transfer_on_payment_and_completion':
      return `${named} ownership of this work passes to ${names.mine} ${once}.`
    case 'license_to_use':
      return `${named} ${names.other} keeps ownership, and ${once}, ${names.mine} may use it for its own business purposes.`
    case 'each_keeps_own':
      return `${named} ${names.other} keeps ownership, and ${once}, ${names.mine} may use it only for the purpose set out in the agreement.`
  }
}
