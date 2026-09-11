import type { Agent } from '@/lib/roster'
import { usd, usdWhole, pctOfCap } from '@/lib/money'
import { AgentStatusPill } from './StatusPill'
import { Sparkline } from './Sparkline'

function AgentRow({ agent }: { agent: Agent }) {
  const fill = pctOfCap(agent.periodSpend, agent.perPeriodCap)

  return (
    <div className="trow">
      <div>
        <div className="agent-name">{agent.name}</div>
        <div className="agent-role">{agent.role}</div>
      </div>

      <div className="cell-dim col-category">{agent.category}</div>

      <div className="col-trend">
        <Sparkline series={agent.trend} />
      </div>

      <div>
        <div className="spend-row">
          {/* Transaction-scale figure: always two decimals. The cap beside it is a round
              secondary figure, so it renders bare. docs/mockups/README.md, "Money". */}
          <span className="spend-amount">{usd(agent.periodSpend)}</span>
          <span className="spend-cap">{usdWhole(agent.perPeriodCap)} cap</span>
        </div>
        <div className="bar">
          <div className="bar-fill" style={{ width: `${fill}%` }} />
        </div>
      </div>

      <div className="col-status">
        <AgentStatusPill status={agent.status} />
      </div>

      <div className="cell-dim col-activity">{agent.lastActivity}</div>

      <button type="button" className="overflow col-overflow" aria-label={`More actions for ${agent.name}`}>
        …
      </button>
    </div>
  )
}

export function AgentTable({ agents }: { agents: Agent[] }) {
  return (
    <div className="table">
      <div className="trow thead">
        <span className="eyebrow">Agent</span>
        <span className="eyebrow col-category">Category</span>
        <span className="eyebrow col-trend">Trend</span>
        <span className="eyebrow">Spent this period</span>
        <span className="eyebrow col-status">Status</span>
        <span className="eyebrow col-activity">Last activity</span>
        <span className="col-overflow" />
      </div>
      <div className="tbody">
        {agents.length === 0 && <p className="empty">No agents on this roster yet. Hire one to get started.</p>}
        {agents.map((agent) => (
          <AgentRow key={agent.id} agent={agent} />
        ))}
      </div>
    </div>
  )
}
