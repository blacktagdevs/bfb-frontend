import { apiGet, apiPost } from '../../lib/api/requests'
import type { components } from '../../lib/api/schema'

type Schemas = components['schemas']

// Exchanges (bfb-api docs/EXCHANGES.md). An exchange exists once both businesses signed its
// agreement, with the services each business provides and the milestones each delivers, copied
// from the accepted terms. Any member of either business can read one and its history; anyone
// else gets `404 not_found`.

export type ExchangeSummary = Schemas['ExchangeListItem']
export type Exchange = Schemas['ExchangeResponse']
export type ExchangeMilestone = Schemas['ExchangeMilestoneResponse']
export type ExchangeStatus = Schemas['ExchangeStatus']
export type MilestoneStatus = Schemas['MilestoneStatus']
export type ExchangeService = Schemas['ExchangeServiceResponse']
export type ExchangeEvent = Schemas['ExchangeEventResponse']
export type ExchangeHistoryPage = Schemas['ExchangeHistoryResponse']
export type Submission = Schemas['SubmissionResponse']
export type SubmissionAttachment = Schemas['SubmissionAttachmentResponse']
export type NewSubmission = Schemas['NewSubmissionBody']
export type Decision = Schemas['DecisionResponse']
export type ExchangeCompletion = Schemas['ExchangeCompletionResponse']
export type CompletionRequest = Schemas['CompletionRequestResponse']
export type Reminder = Schemas['ReminderResponse']
export type CancellationNotice = Schemas['CancellationNoticeResponse']
export type Dispute = Schemas['DisputeResponse']
export type DisputeCategory = Schemas['DisputeCategory']
export type DisputeResolution = Schemas['DisputeResolution']
export type NewDispute = Schemas['NewDisputeBody']

/** Limits on cancellation and disputes (bfb-api docs/EXCHANGES.md). The server checks again. */
export const CANCELLATION_LIMITS = { reasonMax: 2000 }
export const DISPUTE_LIMITS = { descriptionMax: 5000, responseMax: 5000, milestones: 50 }

/** Limits on a change request's reason (bfb-api docs/EXCHANGES.md, "Review"). */
export const REVIEW_LIMITS = { reasonMax: 5000 }

/** Limits on a delivery (bfb-api docs/EXCHANGES.md, "Delivery"). The server checks again. */
export const DELIVERY_LIMITS = { noteMax: 5000, links: 10, urlMax: 2000, labelMax: 200, files: 10 }

export const EXCHANGES_PAGE_SIZE = 20
export const HISTORY_PAGE_SIZE = 50

/** The business's exchanges with one status, newest first. */
export function listExchanges(businessId: string, status: ExchangeStatus, { limit = EXCHANGES_PAGE_SIZE, cursor }: { limit?: number; cursor?: string | null } = {}) {
  return apiGet('/businesses/{business_id}/exchanges', {
    path: { business_id: businessId },
    query: { status, limit, ...(cursor ? { cursor } : {}) },
  })
}

/** The business's active exchanges, newest first. */
export function listActiveExchanges(businessId: string, options: { limit?: number; cursor?: string | null } = {}) {
  return listExchanges(businessId, 'active', options)
}

/** One exchange with the agreed services, terms and its milestones, in order. */
export function getExchange(businessId: string, exchangeId: string): Promise<Exchange> {
  return apiGet('/businesses/{business_id}/exchanges/{exchange_id}', { path: { business_id: businessId, exchange_id: exchangeId } })
}

/** The exchange's history, newest first. */
export function getExchangeHistory(businessId: string, exchangeId: string, cursor?: string | null): Promise<ExchangeHistoryPage> {
  return apiGet('/businesses/{business_id}/exchanges/{exchange_id}/history', {
    path: { business_id: businessId, exchange_id: exchangeId },
    query: { limit: HISTORY_PAGE_SIZE, ...(cursor ? { cursor } : {}) },
  })
}

/**
 * Submit a delivery for a milestone your business delivers (any member). Upload files first
 * (category `exchange_delivery`) and pass their IDs in display order.
 */
export function submitDelivery(businessId: string, exchangeId: string, milestoneId: string, body: NewSubmission): Promise<Submission> {
  return apiPost('/businesses/{business_id}/exchanges/{exchange_id}/milestones/{milestone_id}/submissions', body, {
    path: { business_id: businessId, exchange_id: exchangeId, milestone_id: milestoneId },
  })
}

/** Every delivery of a milestone, newest first. */
export async function listSubmissions(businessId: string, exchangeId: string, milestoneId: string): Promise<Submission[]> {
  const page = await apiGet('/businesses/{business_id}/exchanges/{exchange_id}/milestones/{milestone_id}/submissions', {
    path: { business_id: businessId, exchange_id: exchangeId, milestone_id: milestoneId },
  })
  return page.items
}

/** A fresh short-lived link to one delivered file. Never store it. */
export function getAttachmentUrl(businessId: string, exchangeId: string, milestoneId: string, submissionId: string, uploadId: string) {
  return apiGet('/businesses/{business_id}/exchanges/{exchange_id}/milestones/{milestone_id}/submissions/{submission_id}/attachments/{upload_id}', {
    path: { business_id: businessId, exchange_id: exchangeId, milestone_id: milestoneId, submission_id: submissionId, upload_id: uploadId },
  })
}

function milestonePath(businessId: string, exchangeId: string, milestoneId: string) {
  return { business_id: businessId, exchange_id: exchangeId, milestone_id: milestoneId }
}

/**
 * Accept the milestone's latest delivery (an owner or administrator of the receiving business).
 * `submissionId` is the delivery the reviewer looked at; a newer one makes the API refuse.
 */
export function acceptMilestone(businessId: string, exchangeId: string, milestoneId: string, submissionId: string): Promise<ExchangeMilestone> {
  return apiPost('/businesses/{business_id}/exchanges/{exchange_id}/milestones/{milestone_id}/accept', { submission_id: submissionId }, {
    path: milestonePath(businessId, exchangeId, milestoneId),
  })
}

/** Ask for changes on the latest delivery, saying which acceptance criteria are not met. */
export function requestChanges(businessId: string, exchangeId: string, milestoneId: string, submissionId: string, reason: string): Promise<ExchangeMilestone> {
  return apiPost('/businesses/{business_id}/exchanges/{exchange_id}/milestones/{milestone_id}/request-changes', { submission_id: submissionId, reason }, {
    path: milestonePath(businessId, exchangeId, milestoneId),
  })
}

/**
 * Remind the receiving business once its review period has ended (an owner or administrator of
 * the delivering business, once per delivery). Sets when the milestone is treated as accepted.
 */
export function remindReviewer(businessId: string, exchangeId: string, milestoneId: string): Promise<ExchangeMilestone> {
  return apiPost('/businesses/{business_id}/exchanges/{exchange_id}/milestones/{milestone_id}/remind', undefined, {
    path: milestonePath(businessId, exchangeId, milestoneId),
  })
}

function exchangePath(businessId: string, exchangeId: string) {
  return { business_id: businessId, exchange_id: exchangeId }
}

/** Ask to complete the exchange once every milestone is accepted (an owner or administrator). */
export function requestCompletion(businessId: string, exchangeId: string): Promise<Exchange> {
  return apiPost('/businesses/{business_id}/exchanges/{exchange_id}/completion', undefined, { path: exchangePath(businessId, exchangeId) })
}

/** Confirm the other business's completion request: the exchange becomes completed. */
export function confirmCompletion(businessId: string, exchangeId: string): Promise<Exchange> {
  return apiPost('/businesses/{business_id}/exchanges/{exchange_id}/completion/confirm', undefined, { path: exchangePath(businessId, exchangeId) })
}

/** Withdraw the pending completion request (for the business that didn't make it, this declines it). */
export function withdrawCompletion(businessId: string, exchangeId: string): Promise<Exchange> {
  return apiPost('/businesses/{business_id}/exchanges/{exchange_id}/completion/withdraw', undefined, { path: exchangePath(businessId, exchangeId) })
}

/** A fresh short-lived link to the completion record. Never store it. */
export function getCompletionRecord(businessId: string, exchangeId: string) {
  return apiGet('/businesses/{business_id}/exchanges/{exchange_id}/completion-record', { path: exchangePath(businessId, exchangeId) })
}

/**
 * Give notice to cancel (Exchange Terms 13.1; an owner or administrator of either business).
 * It takes effect `cancellation_notice_days` calendar days later; with 0 days, at once.
 */
export function giveCancellationNotice(businessId: string, exchangeId: string, reason: string): Promise<CancellationNotice> {
  return apiPost('/businesses/{business_id}/exchanges/{exchange_id}/cancellation', { reason }, { path: exchangePath(businessId, exchangeId) })
}

/** Withdraw the pending notice (the business that gave it). */
export function withdrawCancellationNotice(businessId: string, exchangeId: string): Promise<CancellationNotice> {
  return apiPost('/businesses/{business_id}/exchanges/{exchange_id}/cancellation/withdraw', undefined, { path: exchangePath(businessId, exchangeId) })
}

/** Agree to the other business's notice: the exchange is cancelled now. */
export function agreeToCancellation(businessId: string, exchangeId: string): Promise<CancellationNotice> {
  return apiPost('/businesses/{business_id}/exchanges/{exchange_id}/cancellation/agree', undefined, { path: exchangePath(businessId, exchangeId) })
}

/** The exchange's disputes, newest first (any member of either business). */
export async function listDisputes(businessId: string, exchangeId: string): Promise<Dispute[]> {
  const page = await apiGet('/businesses/{business_id}/exchanges/{exchange_id}/disputes', { path: exchangePath(businessId, exchangeId) })
  return page.items
}

/** Open a dispute (Exchange Terms 15; an owner or administrator). One may be open at a time. */
export function openDispute(businessId: string, exchangeId: string, body: NewDispute): Promise<Dispute> {
  return apiPost('/businesses/{business_id}/exchanges/{exchange_id}/disputes', body, { path: exchangePath(businessId, exchangeId) })
}

/** Respond to the other business's dispute, once. */
export function respondToDispute(businessId: string, exchangeId: string, disputeId: string, response: string): Promise<Dispute> {
  return apiPost('/businesses/{business_id}/exchanges/{exchange_id}/disputes/{dispute_id}/response', { response }, {
    path: { ...exchangePath(businessId, exchangeId), dispute_id: disputeId },
  })
}

/** Withdraw the dispute your business opened: it closes with the resolution `withdrawn`. */
export function withdrawDispute(businessId: string, exchangeId: string, disputeId: string): Promise<Dispute> {
  return apiPost('/businesses/{business_id}/exchanges/{exchange_id}/disputes/{dispute_id}/withdraw', undefined, {
    path: { ...exchangePath(businessId, exchangeId), dispute_id: disputeId },
  })
}
