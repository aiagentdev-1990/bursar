import { InfoIcon } from './Icons'

/** Shown in place of live data when apps/api can't be reached or refuses the request. Says what
 *  is wrong rather than rendering an empty roster, which would read as "no agents". */
export function Unavailable({ message }: { message: string }) {
  return (
    <div className="banner" role="alert">
      <span className="banner-icon"><InfoIcon /></span>
      <div className="banner-body">
        <div className="banner-title">Live roster data is unavailable</div>
        <div className="banner-sub">{message}</div>
      </div>
    </div>
  )
}
