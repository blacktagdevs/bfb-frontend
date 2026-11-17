import { apiGet } from '../../lib/api/requests'
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

export const EXCHANGES_PAGE_SIZE = 20
export const HISTORY_PAGE_SIZE = 50

/** The business's active exchanges, newest first. */
export function listActiveExchanges(businessId: string, { limit = EXCHANGES_PAGE_SIZE, cursor }: { limit?: number; cursor?: string | null } = {}) {
  return apiGet('/businesses/{business_id}/exchanges', {
    path: { business_id: businessId },
    query: { status: 'active', limit, ...(cursor ? { cursor } : {}) },
  })
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
