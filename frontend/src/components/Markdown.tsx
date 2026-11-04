import { Fragment, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

/**
 * A deliberately small Markdown renderer for CMS pages (headings, paragraphs, lists, quotes,
 * **bold**, *italic* and links). It builds React elements directly and never uses
 * dangerouslySetInnerHTML, so content entered in the admin area can never inject HTML or scripts.
 * Link targets are restricted to internal paths, http(s) and mailto.
 */

const SAFE_LINK = /^(\/(?!\/)[^\s]*|https?:\/\/[^\s]+|mailto:[^\s]+)$/i

function renderLink(label: ReactNode, href: string, key: number) {
  if (!SAFE_LINK.test(href)) return <Fragment key={key}>{label}</Fragment> // unsafe scheme (javascript:, data:, …) → plain text
  const cls = 'font-semibold text-royal-600 underline hover:text-royal-700'
  if (href.startsWith('/')) return <Link key={key} to={href} className={cls}>{label}</Link>
  return <a key={key} href={href} className={cls} target="_blank" rel="noopener noreferrer nofollow">{label}</a>
}

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|\[[^\]]+\]\([^)\s]+\))/g
  let last = 0
  let i = 0
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const tok = m[0]
    if (tok.startsWith('**')) out.push(<strong key={i++} className="font-semibold text-navy-900">{inline(tok.slice(2, -2))}</strong>)
    else if (tok.startsWith('[')) {
      const close = tok.indexOf('](')
      out.push(renderLink(inline(tok.slice(1, close)), tok.slice(close + 2, -1), i++))
    } else out.push(<em key={i++}>{tok.slice(1, -1)}</em>)
    last = m.index + tok.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export function Markdown({ source }: { source: string }) {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let para: string[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  let quote: string[] = []
  let key = 0

  const flush = () => {
    if (para.length) { blocks.push(<p key={key++} className="leading-relaxed text-slate-700">{inline(para.join(' '))}</p>); para = [] }
    if (list) {
      const items = list.items.map((it, n) => <li key={n}>{inline(it)}</li>)
      blocks.push(list.ordered
        ? <ol key={key++} className="list-decimal space-y-1.5 pl-6 text-slate-700">{items}</ol>
        : <ul key={key++} className="list-disc space-y-1.5 pl-6 text-slate-700">{items}</ul>)
      list = null
    }
    if (quote.length) { blocks.push(<blockquote key={key++} className="rounded-r-lg border-l-4 border-accent-500 bg-accent-100/50 px-4 py-3 text-sm text-slate-800">{inline(quote.join(' '))}</blockquote>); quote = [] }
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    let m: RegExpMatchArray | null
    if (!line.trim()) { flush(); continue }
    if ((m = line.match(/^(#{1,3})\s+(.*)$/))) {
      flush()
      const level = m[1].length
      const text = inline(m[2])
      blocks.push(level === 1
        ? <h1 key={key++} className="text-3xl font-extrabold text-navy-900">{text}</h1>
        : level === 2
          ? <h2 key={key++} className="pt-4 text-xl font-bold text-navy-900">{text}</h2>
          : <h3 key={key++} className="pt-2 text-lg font-semibold text-navy-900">{text}</h3>)
    } else if ((m = line.match(/^\s*[-*]\s+(.*)$/))) {
      if (!list || list.ordered) { flush(); list = { ordered: false, items: [] } }
      list.items.push(m[1])
    } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
      if (!list || !list.ordered) { flush(); list = { ordered: true, items: [] } }
      list.items.push(m[1])
    } else if ((m = line.match(/^>\s?(.*)$/))) {
      if (!quote.length) flush()
      quote.push(m[1])
    } else {
      if (list || quote.length) flush()
      para.push(line.trim())
    }
  }
  flush()
  return <div className="space-y-4">{blocks}</div>
}
