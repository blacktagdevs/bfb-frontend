import { progressPercent, progressText } from './exchangeCopy'

/** Milestones accepted out of all, as a thin bar that reads as "1 of 3 accepted". */
export function ProgressBar({ accepted, count, className }: { accepted: number; count: number; className: string }) {
  return (
    <div className={className} role="progressbar" aria-label="Milestones accepted" aria-valuemin={0} aria-valuemax={count} aria-valuenow={accepted} aria-valuetext={progressText(accepted, count)}>
      <span style={{ width: `${progressPercent(accepted, count)}%` }} />
    </div>
  )
}
