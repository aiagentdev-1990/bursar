import Link from 'next/link'
import { ArrowLeft } from '@/components/Icons'

export default function NotFound() {
  return (
    <>
      <div className="pagehead">
        <div>
          <span className="eyebrow">Not found</span>
          <div className="hero-line">
            <span className="hero">No such record</span>
          </div>
        </div>
      </div>
      <p className="prose">That request or agent isn&rsquo;t on this roster.</p>
      <Link className="backlink" href="/" style={{ marginTop: 24 }}>
        <ArrowLeft /> Roster
      </Link>
    </>
  )
}
