import { periodLabel } from '@/lib/org'

/** The shell's nav has three items and the mockups draw two of them. This exists so Settings
 *  doesn't 404 during a demo; it is not a checkpoint-8 deliverable. */
export default function Settings() {
  return (
    <>
      <div className="pagehead">
        <div>
          <span className="eyebrow">Settings · {periodLabel()}</span>
          <div className="hero-line">
            <span className="hero">Nothing to configure yet</span>
          </div>
        </div>
      </div>
      <p className="prose">
        Funding, the payroll schedule, and the owner&rsquo;s own wallet live here once checkpoint 10 lands.
      </p>
    </>
  )
}
