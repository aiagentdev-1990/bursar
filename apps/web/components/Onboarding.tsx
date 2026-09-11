import { InfoIcon } from './Icons'
import { dismissHire } from '@/app/actions'
import { hireProgress, type Hire } from '@/lib/roster'

/** One row per hire still in flight, and per failure the owner hasn't dismissed. A finished hire
 *  drops out of this list and appears in the roster table. */
export function Onboarding({ hires }: { hires: Hire[] }) {
  if (hires.length === 0) return null

  return (
    <div className="onboarding">
      {hires.map((hire) => {
        const failed = hire.status === 'failed'
        return (
          <div className="banner" data-state={failed ? 'failed' : 'working'} key={hire.id}>
            <span className="banner-icon"><InfoIcon /></span>
            <div className="banner-body">
              <div className="banner-title">{failed ? `Hiring ${hire.name} failed` : `Hiring ${hire.name}`}</div>
              <div className="banner-sub">{hireProgress(hire)}</div>
            </div>
            {hire.traceUrl && (
              <a className="btn btn-quiet" href={hire.traceUrl} target="_blank" rel="noreferrer">
                {failed ? 'Open session' : 'Watch setup'}
              </a>
            )}
            {failed && (
              <form action={dismissHire.bind(null, hire.id)}>
                <button type="submit" className="btn btn-quiet">Dismiss</button>
              </form>
            )}
          </div>
        )
      })}
    </div>
  )
}
