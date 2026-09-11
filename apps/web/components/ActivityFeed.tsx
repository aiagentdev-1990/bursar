'use client'

import { useMemo, useState } from 'react'
import { Stat, StatRow } from './Stat'
import { PaymentStatusPill } from './StatusPill'
import { usd } from '@/lib/money'
import { dayHeading, paymentsByDay, sum, type Payment } from '@/lib/roster'

const ALL = 'all'

export function ActivityFeed({
  agents,
  payments,
  today,
  period,
}: {
  agents: Array<{ id: string; name: string }>
  payments: Payment[]
  today: string
  period: string
}) {
  const [filter, setFilter] = useState<string>(ALL)

  const visible = useMemo(
    () => (filter === ALL ? payments : payments.filter((p) => p.agentId === filter)),
    [filter, payments],
  )

  // Recomputed from whatever is on screen — filtering to one agent has to move these figures,
  // or the header is describing a different set than the rows below it.
  const settled = visible.filter((p) => p.status === 'settled')
  const settledTotal = sum(settled.map((p) => p.amount))
  const held = sum(visible.filter((p) => p.status === 'held').map((p) => p.amount))
  const rejected = sum(visible.filter((p) => p.status === 'rejected').map((p) => p.amount))
  const largest = settled.reduce((max, p) => (p.amount > max ? p.amount : max), 0n)

  const groups = paymentsByDay(visible)

  return (
    <>
      <div className="pagehead">
        <div>
          <span className="eyebrow">Activity · {period}</span>
          <div className="hero-line">
            <span className="hero">{usd(settledTotal)}</span>
            <span className="hero-note">
              settled across {settled.length} {settled.length === 1 ? 'transaction' : 'transactions'}
            </span>
          </div>
        </div>

        <StatRow>
          <Stat label="Held for approval">{usd(held)}</Stat>
          <Stat label="Rejected">{usd(rejected)}</Stat>
          <Stat label="Largest payment">{usd(largest)}</Stat>
        </StatRow>
      </div>

      <div className="filterbar">
        <div className="chips">
          <button type="button" className="chip" data-active={filter === ALL} onClick={() => setFilter(ALL)}>
            All agents
          </button>
          {agents.map((agent) => (
            <button
              key={agent.id}
              type="button"
              className="chip"
              data-active={filter === agent.id}
              onClick={() => setFilter(agent.id)}
            >
              {agent.name}
            </button>
          ))}
        </div>
        <span className="filter-note">Every payment an agent made, in order. Nothing here can be edited.</span>
      </div>

      {groups.length === 0 && (
        <p className="empty">{filter === ALL ? 'No payments on this roster yet.' : 'No payments from this agent yet.'}</p>
      )}

      {groups.map((group) => (
        <section className="daygroup" key={group.day}>
          <div className="dayhead">
            <span className="eyebrow">{dayHeading(group.day, today)}</span>
            <span className="day-settled">{usd(group.settled)} settled</span>
          </div>
          {group.items.map((payment) => (
            <PaymentRow key={payment.id} payment={payment} />
          ))}
        </section>
      ))}
    </>
  )
}

function PaymentRow({ payment }: { payment: Payment }) {
  return (
    <div className="prow">
      <span className="prow-time">{payment.time}</span>
      <span className="prow-agent col-agent">{payment.agentName}</span>
      <div>
        <div className="prow-payee">{payment.payee}</div>
        <div className="prow-memo">{payment.memo}</div>
      </div>
      <span className="cell-dim col-category">{payment.category}</span>
      <span className="prow-amount">{usd(payment.amount)}</span>
      <span className="prow-status col-status">
        <PaymentStatusPill status={payment.status} />
      </span>
    </div>
  )
}
