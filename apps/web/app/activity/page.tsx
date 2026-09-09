'use client'

import { useMemo, useState } from 'react'
import { Stat, StatRow } from '@/components/Stat'
import { PaymentStatusPill } from '@/components/StatusPill'
import { usd } from '@/lib/money'
import { agents, payments, paymentsByDay, dayHeading, findAgent, PERIOD_LABEL, type Payment } from '@/lib/mock-data'

const ALL = 'all'

const sum = (xs: bigint[]): bigint => xs.reduce((a, b) => a + b, 0n)

export default function Activity() {
  const [filter, setFilter] = useState<string>(ALL)

  const visible = useMemo(
    () => (filter === ALL ? payments : payments.filter((p) => p.agentId === filter)),
    [filter],
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
          <span className="eyebrow">Activity · {PERIOD_LABEL}</span>
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

      {groups.length === 0 && <p className="empty">No payments from this agent yet.</p>}

      {groups.map((group) => (
        <section className="daygroup" key={group.day}>
          <div className="dayhead">
            <span className="eyebrow">{dayHeading(group.day)}</span>
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
  const agent = findAgent(payment.agentId)

  return (
    <div className="prow">
      <span className="prow-time">{payment.time}</span>
      <span className="prow-agent col-agent">{agent?.name ?? '—'}</span>
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
