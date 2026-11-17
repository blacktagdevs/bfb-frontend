import { apiGet, apiPost } from '../../lib/api/requests'
import type { components } from '../../lib/api/schema'

type Schemas = components['schemas']

export type AdminDispute = Schemas['AdminDisputeListItem']
export type AdminDisputeDetail = Schemas['AdminDisputeDetailResponse']
export type AdminDisputeList = Schemas['AdminDisputeListResponse']
export type ClosedDispute = Schemas['AdminDisputeResponse']
export type DisputeResolution = Schemas['DisputeResolution']
export type DisputeStatus = Schemas['DisputeStatus']

// Staff dispute routes (bfb-api docs/ADMIN.md, "Disputes"). Support and administrator users
// only. Staff see disputes with the evidence and record how each ended; they never change a
// milestone or the exchange.

export const DISPUTES_PAGE_SIZE = 20
export const ADMIN_HISTORY_PAGE_SIZE = 50
export const CLOSE_NOTE_MAX = 2000

/** Open disputes first (oldest first, a queue), then closed ones (most recently closed first). */
export function listAdminDisputes({ status, offset = 0 }: { status?: DisputeStatus; offset?: number } = {}): Promise<AdminDisputeList> {
  return apiGet('/admin/disputes', { query: { limit: DISPUTES_PAGE_SIZE, offset, ...(status ? { status } : {}) } })
}

/** The dispute with its exchange, every milestone and its latest delivery, a pending notice and the newest 50 history entries. */
export function getAdminDispute(disputeId: string): Promise<AdminDisputeDetail> {
  return apiGet('/admin/disputes/{dispute_id}', { path: { dispute_id: disputeId } })
}

/** Record the outcome. The note is shown to both businesses; nothing else changes. */
export function closeDispute(disputeId: string, resolution: DisputeResolution, note: string): Promise<ClosedDispute> {
  return apiPost('/admin/disputes/{dispute_id}/close', { resolution, note }, { path: { dispute_id: disputeId } })
}

/** Older history entries of an exchange, newest first. */
export function getAdminExchangeHistory(exchangeId: string, cursor: string) {
  return apiGet('/admin/exchanges/{exchange_id}/history', { path: { exchange_id: exchangeId }, query: { limit: ADMIN_HISTORY_PAGE_SIZE, cursor } })
}

/** Every delivery of a milestone, newest first. */
export async function listAdminSubmissions(exchangeId: string, milestoneId: string) {
  const page = await apiGet('/admin/exchanges/{exchange_id}/milestones/{milestone_id}/submissions', { path: { exchange_id: exchangeId, milestone_id: milestoneId } })
  return page.items
}

/** A fresh short-lived link to one delivered file. Never store it. */
export function getAdminAttachmentUrl(exchangeId: string, milestoneId: string, submissionId: string, uploadId: string) {
  return apiGet('/admin/exchanges/{exchange_id}/milestones/{milestone_id}/submissions/{submission_id}/attachments/{upload_id}', {
    path: { exchange_id: exchangeId, milestone_id: milestoneId, submission_id: submissionId, upload_id: uploadId },
  })
}
