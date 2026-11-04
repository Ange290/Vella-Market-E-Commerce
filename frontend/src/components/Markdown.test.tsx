import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { Markdown } from './Markdown'

const html = (md: string) => renderToStaticMarkup(<MemoryRouter><Markdown source={md} /></MemoryRouter>)

describe('Markdown (CMS content renderer)', () => {
  it('renders headings, paragraphs, lists, quotes and emphasis', () => {
    const out = html('# Title\n\nHello **bold** and *soft*.\n\n- one\n- two\n\n1. first\n2. second\n\n> note')
    expect(out).toContain('<h1')
    expect(out).toContain('<strong')
    expect(out).toContain('<em>soft</em>')
    expect(out.match(/<li>/g)).toHaveLength(4)
    expect(out).toContain('<ul')
    expect(out).toContain('<ol')
    expect(out).toContain('<blockquote')
  })

  it('never emits raw HTML: tags in the source are escaped as text', () => {
    const out = html('<script>alert(1)</script> and <img src=x onerror=alert(1)>')
    expect(out).not.toContain('<script')
    expect(out).not.toContain('<img')
    expect(out).toContain('&lt;script&gt;')
  })

  it('drops links with unsafe schemes and keeps only their text', () => {
    for (const href of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,x', 'vbscript:x', '//evil.com']) {
      const out = html(`[click me](${href})`)
      expect(out).not.toContain('<a')
      expect(out).not.toContain('href')
      expect(out).toContain('click me')
    }
  })

  it('renders safe links: internal paths stay in-app, external ones open safely', () => {
    const internal = html('[Shop](/shop)')
    expect(internal).toContain('href="/shop"')
    expect(internal).not.toContain('target=')

    const external = html('[Docs](https://example.com/a?b=1)')
    expect(external).toContain('href="https://example.com/a?b=1"')
    expect(external).toContain('target="_blank"')
    expect(external).toContain('rel="noopener noreferrer nofollow"')

    expect(html('[Mail](mailto:help@example.com)')).toContain('href="mailto:help@example.com"')
  })

  it('handles empty and odd input without throwing', () => {
    expect(() => html('')).not.toThrow()
    expect(() => html('**unclosed [link](')).not.toThrow()
    expect(html('\n\n\n')).not.toContain('<p')
  })
})
