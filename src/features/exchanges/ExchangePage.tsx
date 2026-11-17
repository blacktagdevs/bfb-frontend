import { useEffect, useState, type ReactNode } from 'react'
import { ArrowLeft, CalendarDays, FileSearch, Layers, PackageCheck, RotateCcw } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'

import { paths } from '../../app/router/paths'
import { EmptyState, ErrorState, LoadingState, showToast } from '../../components/feedback'
import { toApiError, type ApiError } from '../../lib/api/errors'
import { useActiveBusiness } from '../../lib/businesses/useActiveBusiness'
import { PublicProfileLink } from '../businesses/PublicProfileLink'
import { formatAmount } from '../listings/money'
import { MatchBusinessHeader } from '../matching/MatchCard'
import { formatMatchDate } from '../matching/matchInboxDisplay'
import { ServiceItem } from '../proposals/ProposalDocument'
import { CASH_TIMING_LABELS, days, formatFullDate } from '../proposals/proposalCopy'
import { canManageTeam } from '../team/teamPermissions'
import {
  conflictNotice,
  deliveryLine,
  EXCHANGE_STATUS_LABELS,
  MILESTONE_STATUS_LABELS,
  milestoneCount,
  nextStepText,
  progressText,
  reviewOverdue,
  type ExchangeAction,
  type Names,
} from './exchangeCopy'
import { CancellationNoticePanel, CancelledPanel } from './CancellationPanel'
import { CompletionPanel } from './CompletionPanel'
import { OpenDisputePanel, PastDisputes, SomethingWrongCard } from './DisputePanel'
import { ExchangeHistory } from './ExchangeHistory'
import { ProgressBar } from './ProgressBar'
import { getExchange, type Exchange, type ExchangeMilestone, type Submission } from './exchangesApi'
import { MilestoneDeliveries } from './MilestoneDeliveries'
import '../matching/MatchInbox.css'
import '../proposals/Proposals.css'
import '../proposals/ProposalReview.css'
import './ExchangesPage.css'

/**
 * `/exchanges/:id`: the exchange workspace. Where it stands and your next step, the milestones
 * with their statuses, what each business provides, and the full history. Both businesses see
 * the same exchange; delivery, review, completion and cancellation build on this page.
 */
export function ExchangePage() {
  const { exchangeId = '' } = useParams()
  return <ExchangeView key={exchangeId} exchangeId={exchangeId} />
}

function ExchangeView({ exchangeId }: { exchangeId: string }) {
  const business = useActiveBusiness()
  const [exchange, setExchange] = useState<Exchange | null>(null)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setLoadError(null)
    getExchange(business.id, exchangeId)
      .then((result) => {
        if (live) setExchange(result)
      })
      .catch((error: unknown) => {
        if (live) setLoadError(toApiError(error))
      })
    return () => {
      live = false
    }
  }, [business.id, exchangeId, reloadKey])

  const back = <Link className="back-button match-back" to={paths.exchanges}><ArrowLeft size={17} aria-hidden="true" /> Back to exchanges</Link>

  if (!exchange) {
    const notFound = loadError !== null && toApiError(loadError).code === 'not_found'
    return (
      <>
        {back}
        {notFound ? (
          <EmptyState
            icon={FileSearch}
            title="We couldn’t find this exchange"
            description={`Only the two businesses in an exchange can open it. Check the link, or whether you’re acting for the right business (you’re acting for ${business.name}).`}
            action={<Link className="button button-secondary button-small" to={paths.exchanges}>See your exchanges</Link>}
          />
        ) : loadError ? (
          <ErrorState title="We couldn’t load this exchange" error={loadError} onRetry={() => setReloadKey((key) => key + 1)} />
        ) : (
          <LoadingState label="Loading exchange…" />
        )}
      </>
    )
  }

  const other = exchange.other_business
  const names: Names = { mine: business.name, other: other.display_name }
  const mine = exchange.milestones.filter((milestone) => milestone.responsible_business_id === business.id).length
  const accepted = exchange.milestones_accepted
  const count = exchange.milestone_count
  const statusLabel = EXCHANGE_STATUS_LABELS[exchange.status]

  const submitted = (submission: Submission) => {
    setNotice(null)
    const review = submission.review_due_at ? ` ${other.display_name} has until ${formatFullDate(submission.review_due_at)} to review it.` : ''
    showToast(`${submission.is_revision ? 'Revision' : 'Delivery'} submitted.${review}`)
    setReloadKey((key) => key + 1)
  }

  const reviewed = (toast: string) => {
    setNotice(null)
    showToast(toast)
    setReloadKey((key) => key + 1)
  }

  /** A cancellation or dispute action worked: the exchange, its history and disputes reload. */
  const changed = (toast: string) => {
    setNotice(null)
    showToast(toast)
    setReloadKey((key) => key + 1)
  }

  const completionChanged = (updated: Exchange, toast: string) => {
    setNotice(null)
    setExchange(updated)
    showToast(toast)
    setReloadKey((key) => key + 1)
  }

  const conflict = (error: ApiError, action: ExchangeAction) => {
    setNotice(conflictNotice(error, action, names))
    setReloadKey((key) => key + 1)
  }
  const canAct = canManageTeam(business.role)

  return (
    <>
      {back}
      <div className="page-heading match-heading proposal-heading">
        <div>
          <span>EXCHANGE</span>
          <h1>{other.display_name}</h1>
          <p>Active since {formatMatchDate(exchange.activated_at)}, under the <Link to={paths.agreement(exchange.agreement_id)}>signed agreement</Link>.</p>
        </div>
        <div>
          <div className="match-card-pills">
            <span className={`match-pill exchange-pill-${exchange.status}`}>{statusLabel}</span>
          </div>
        </div>
      </div>
      <div className="match-layout proposal-review-layout">
        <div className="match-main">
          {/* Banner slot: a refused action's notice, then cancellation, an open dispute and completion. */}
          {notice && <p className="match-notice match-notice-error exchange-notice" role="alert">{notice}</p>}
          <CancelledPanel exchange={exchange} />
          <CancellationNoticePanel exchange={exchange} businessId={business.id} names={names} canAct={canAct} onDone={changed} onConflict={conflict} />
          <OpenDisputePanel exchange={exchange} businessId={business.id} names={names} canAct={canAct} onDone={changed} onConflict={conflict} />
          <CompletionPanel exchange={exchange} businessId={business.id} names={names} canAct={canAct} onExchange={completionChanged} onConflict={conflict} />
          <section className={`match-panel proposal-standing exchange-standing exchange-standing-${exchange.status}`} aria-labelledby="exchange-standing-title">
            <h2 id="exchange-standing-title" className="match-side-title">Where it stands</h2>
            <p>
              {exchange.status === 'active'
                ? 'Both businesses signed the agreement, so the exchange is active. '
                : exchange.status === 'completed'
                  ? `Both businesses confirmed the exchange is complete${exchange.completion.completed_at ? ` on ${formatMatchDate(exchange.completion.completed_at)}` : ''}. `
                  : exchange.status === 'cancelled'
                    ? `The exchange was cancelled on ${formatMatchDate(exchange.updated_at)}. `
                    : `The exchange is ${statusLabel.toLowerCase()}. `}
              {business.name} delivers {milestoneCount(mine)} and {other.display_name} delivers {milestoneCount(exchange.milestones.length - mine)}. {progressText(accepted, count)}.
            </p>
            <ProgressBar accepted={accepted} count={count} className="exchange-progress-bar" />
            <p className="exchange-next-step">
              <strong>Next step for {business.name}:</strong> {nextStepText(exchange, business.id, names, { canReview: canAct })}
            </p>
          </section>
          <section className="match-panel" aria-labelledby="exchange-milestones-title">
            <div className="match-panel-head">
              <h2 id="exchange-milestones-title">Milestones</h2>
              <p>As agreed in the accepted proposal, in order.</p>
            </div>
            <div className="match-panel-body">
              {exchange.milestones.length === 0 ? (
                <p className="exchange-readonly-note">This exchange has no milestones.</p>
              ) : (
                <ol className="exchange-milestones" aria-label="Milestones">
                  {exchange.milestones.map((milestone) => (
                    <MilestoneRow key={milestone.id} milestone={milestone} exchange={exchange} businessId={business.id} names={names}>
                      <MilestoneDeliveries exchange={exchange} milestone={milestone} businessId={business.id} names={names} canAct={canAct} onSubmitted={submitted} onReviewed={reviewed} onConflict={conflict} />
                    </MilestoneRow>
                  ))}
                </ol>
              )}
            </div>
          </section>
          <ProvidesSection exchange={exchange} businessId={business.id} names={names} />
          <PastDisputes exchange={exchange} businessId={business.id} names={names} reloadKey={reloadKey} />
          <ExchangeHistory exchange={exchange} businessId={business.id} names={names} reloadKey={reloadKey} />
        </div>
        <aside className="match-side">
          <section className="match-panel match-panel-body" aria-labelledby="exchange-status-title">
            <h2 id="exchange-status-title" className="match-side-title">Status</h2>
            <dl className="match-status-facts">
              <div><dt>Status</dt><dd>{statusLabel}</dd></div>
              <div><dt>Active since</dt><dd>{formatMatchDate(exchange.activated_at)}</dd></div>
              {exchange.completion.completed_at && <div><dt>Completed</dt><dd>{formatMatchDate(exchange.completion.completed_at)}</dd></div>}
              {exchange.status === 'cancelled' && <div><dt>Cancelled</dt><dd>{formatMatchDate(exchange.updated_at)}</dd></div>}
              <div><dt>Progress</dt><dd>{progressText(accepted, count)}</dd></div>
              <div><dt>Next due</dt><dd>{exchange.next_due_date ? formatMatchDate(exchange.next_due_date) : 'Nothing due'}</dd></div>
              <div><dt>Review period</dt><dd>{days(exchange.review_period_days)}</dd></div>
              <div><dt>Revisions</dt><dd>{exchange.revision_limit === 0 ? 'None included' : `Up to ${exchange.revision_limit}`}</dd></div>
              <div><dt>Cancellation</dt><dd>{exchange.cancellation_notice_days === 0 ? 'No notice' : `${days(exchange.cancellation_notice_days)}’ notice`}</dd></div>
              {exchange.status === 'active' && exchange.cancellation_notice && <div><dt>Cancels on</dt><dd>{formatMatchDate(exchange.cancellation_notice.effective_at)}</dd></div>}
              {exchange.open_dispute && <div><dt>Dispute</dt><dd>Open</dd></div>}
              <div><dt>Agreement</dt><dd><Link to={paths.agreement(exchange.agreement_id)}>Signed</Link></dd></div>
              <div><dt>Proposal</dt><dd><Link to={paths.proposal(exchange.proposal_id)}>Accepted</Link></dd></div>
            </dl>
          </section>
          <SomethingWrongCard exchange={exchange} businessId={business.id} names={names} canAct={canAct} onDone={changed} onConflict={conflict} />
          <section className="match-panel match-panel-body" aria-labelledby="exchange-other-title">
            <h2 id="exchange-other-title" className="match-side-title">The other business</h2>
            <MatchBusinessHeader business={other} as="h3" />
            <PublicProfileLink businessId={other.id} profileStatus={other.profile_status} />
          </section>
        </aside>
      </div>
    </>
  )
}

/** One milestone: number, title, status, who delivers to whom, dates, and an area for its actions. */
export function MilestoneRow({ milestone, exchange, businessId, names, children }: {
  milestone: ExchangeMilestone
  exchange: Exchange
  businessId: string
  names: Names
  /** The milestone's actions and deliveries (FE-6.2 onwards). */
  children?: ReactNode
}) {
  const delivery = deliveryLine(milestone, businessId, names)
  const service = milestone.service_key ? exchange.sides[milestone.responsible_side].services.find((item) => item.key === milestone.service_key) : undefined
  return (
    <li className={`exchange-milestone ${delivery.mine ? 'exchange-milestone-mine' : ''}`} aria-label={`Milestone ${milestone.sequence}: ${milestone.title}`}>
      <span className="exchange-milestone-number" aria-hidden="true">{milestone.sequence}</span>
      <div className="exchange-milestone-body">
        <div className="exchange-milestone-head">
          <h3>{milestone.title}</h3>
          <span className={`match-pill exchange-milestone-pill-${milestone.status}`}>{MILESTONE_STATUS_LABELS[milestone.status]}</span>
        </div>
        <p className="exchange-milestone-meta">
          <span><PackageCheck size={14} aria-hidden="true" /> <span><strong>{delivery.mine ? 'You deliver' : 'You receive'}</strong> · {delivery.text}</span></span>
          <span><CalendarDays size={14} aria-hidden="true" /> {milestone.due_date ? `Due ${formatFullDate(milestone.due_date)}` : 'No due date'}</span>
          {service && <span><Layers size={14} aria-hidden="true" /> Part of {service.title}</span>}
          {(milestone.revisions_used > 0 || milestone.status === 'changes_requested') && (
            <span><RotateCcw size={14} aria-hidden="true" /> {milestone.revisions_used > exchange.revision_limit ? `Revisions used: ${milestone.revisions_used}, beyond the ${exchange.revision_limit} agreed` : `Revisions used: ${milestone.revisions_used} of ${exchange.revision_limit}`}</span>
          )}
        </p>
        {milestone.status === 'submitted' && milestone.review_due_at && (
          <p className="exchange-milestone-review">
            {reviewOverdue(milestone)
              ? delivery.mine ? `${names.other}’s review was due by ${formatFullDate(milestone.review_due_at)}.` : `Your review was due by ${formatFullDate(milestone.review_due_at)}.`
              : delivery.mine ? `${names.other} reviews it by ${formatFullDate(milestone.review_due_at)}.` : `Review it by ${formatFullDate(milestone.review_due_at)}.`}
          </p>
        )}
        {milestone.description && <p>{milestone.description}</p>}
        {milestone.acceptance_criteria && <p className="exchange-milestone-criteria"><strong>Done when:</strong> {milestone.acceptance_criteria}</p>}
        {children ? <div className="exchange-milestone-actions">{children}</div> : null}
      </div>
    </li>
  )
}

function cashTiming(timing: string): string {
  const label = (CASH_TIMING_LABELS as Record<string, string | undefined>)[timing]
  return label ? ` ${label.toLowerCase()}` : ''
}

/** "What each business provides": both businesses' services with values (yours first), the totals and the cash adjustment. */
function ProvidesSection({ exchange, businessId, names }: { exchange: Exchange; businessId: string; names: Names }) {
  const mySide = exchange.my_side
  const otherSide = mySide === 'a' ? 'b' : 'a'
  const money = (minor: number) => formatAmount(minor, exchange.currency)
  const nameOf = (side: 'a' | 'b') => (exchange.sides[side].business_id === businessId ? names.mine : names.other)
  const cash = exchange.cash_adjustment

  return (
    <section className="match-panel" aria-labelledby="exchange-provides-title">
      <div className="match-panel-head">
        <h2 id="exchange-provides-title">What each business provides</h2>
        <p>The services and values in the signed agreement.</p>
      </div>
      <div className="match-panel-body exchange-provides">
        <div className="proposal-doc-sides">
          {([mySide, otherSide] as const).map((side) => {
            const terms = exchange.sides[side]
            return (
              <div key={side} className="proposal-doc-side" role="group" aria-label={`${nameOf(side)} provides`}>
                <h3 className="exchange-provides-title">{nameOf(side)} provides</h3>
                {terms.services.length === 0 ? (
                  <p className="exchange-readonly-note">No services listed.</p>
                ) : (
                  <ul className="proposal-doc-services">
                    {terms.services.map((service) => <ServiceItem key={service.key} service={service} money={money} />)}
                  </ul>
                )}
                <p className="proposal-doc-total"><span>Total value</span><strong>{money(terms.total_value_minor)}</strong></p>
              </div>
            )
          })}
        </div>
        <p className="proposal-doc-difference">
          {cash ? (
            <>
              Cash adjustment: <strong>{nameOf(cash.payer)} pays {nameOf(cash.payer === 'a' ? 'b' : 'a')} {money(cash.amount_minor)}</strong>
              {cashTiming(cash.timing)}.{cash.note ? ` ${cash.note}` : ''}
            </>
          ) : 'No cash changes hands.'}
        </p>
        <small className="proposal-values-foot">The values each business entered. BFB doesn’t move money or score the trade.</small>
      </div>
    </section>
  )
}
