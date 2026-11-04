import { Hammer } from 'lucide-react'
import { Link } from 'react-router-dom'

/** Route placeholder for modules that are on the roadmap but not built yet. */
export function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-24 text-center">
      <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-accent-100 text-accent-600">
        <Hammer className="h-6 w-6" />
      </span>
      <h1 className="mt-6 text-3xl font-extrabold text-navy-900">{title}</h1>
      <p className="mt-3 text-slate-600">This page is scheduled in the implementation roadmap and is not built yet.</p>
      <Link to="/" className="mt-8 inline-block font-semibold text-royal-600 hover:underline">
        Back to home
      </Link>
    </div>
  )
}
