import { ActivityFeed } from '@/components/ActivityFeed'
import { Unavailable } from '@/components/Unavailable'
import { attempt, loadRoster } from '@/lib/load'
import { periodLabel } from '@/lib/org'

export const dynamic = 'force-dynamic'

/** Loaded on the server (the owner token never reaches the browser); filtering is client-side. */
export default async function Activity() {
  const period = periodLabel()
  const result = await attempt(() => loadRoster())

  if (!result.ok) {
    return (
      <>
        <span className="eyebrow">Activity · {period}</span>
        <Unavailable message={result.message} />
      </>
    )
  }

  const { agents, payments, today } = result.value
  return (
    <ActivityFeed
      agents={agents.map((a) => ({ id: a.id, name: a.name }))}
      payments={payments}
      today={today}
      period={period}
    />
  )
}
