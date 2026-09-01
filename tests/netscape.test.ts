import { describe, expect, it } from 'vitest'
import { parseNetscape, countTokens } from '../src/parser/netscape'
import { exportNetscape } from '../src/exporter/netscape'

const SAMPLE = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3 ADD_DATE="1780363655" LAST_MODIFIED="1787661392" PERSONAL_TOOLBAR_FOLDER="true">Bookmarks bar</H3>
    <DL><p>
        <DT><A HREF="https://mail.google.com/mail/u/0/#inbox" ADD_DATE="1592913435" ICON="data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==">Inbox</A>
        <DT><H3 ADD_DATE="1656936440">Favs</H3>
        <DL><p>
            <DT><A HREF="https://example.com/page?utm_source=x&a=1&a=2" ADD_DATE="1700000000">Example</A>
            <DT><A HREF="about:blank">Blank</A>
        </DL><p>
    </DL><p>
    <DT><H3 ADD_DATE="1656936440">Other &amp; Things</H3>
    <DL><p>
        <DT><A HREF="https://www.wikipedia.org/">Wikipedia</A>
        <DT><A HREF="https://multi.lines.example.com/a/b/">Multi
Line name</A>
    </DL><p>
</DL><p>
`

describe('parseNetscape', () => {
  it('parses folders, links, attributes and nesting', () => {
    const r = parseNetscape(SAMPLE)
    expect(r.links).toBe(5)
    expect(r.folders).toBe(3)
    expect(r.droppedIcons).toBe(1)

    const bar = r.root.children[0]
    expect(bar.type).toBe('folder')
    expect(bar.name).toBe('Bookmarks bar')
    expect(bar.attrs?.PERSONAL_TOOLBAR_FOLDER).toBe('true')
    expect(bar.addDate).toBe(1780363655)

    const inbox = bar.children[0]
    expect(inbox.type).toBe('link')
    expect(inbox.url).toBe('https://mail.google.com/mail/u/0/#inbox')
    expect(inbox.addDate).toBe(1592913435)
    expect(inbox.attrs?.ICON).toBeUndefined()

    // entity decoding in names
    expect(r.root.children[1].name).toBe('Other & Things')

    // multiline names are captured and collapsed
    const wiki = r.root.children[1].children[1]
    expect(wiki.name).toContain('Multi')
    expect(wiki.name).not.toContain('\n')
  })

  it('preserves every unique URL', () => {
    const urls = new Set<string>()
    const walk = (n: any) => {
      if (n.type === 'link') urls.add(n.url)
      for (const c of n.children) walk(c)
    }
    walk(parseNetscape(SAMPLE).root)
    expect(urls.size).toBe(5)
  })
})

describe('export → parse round-trip', () => {
  it('produces an equivalent tree', () => {
    const first = parseNetscape(SAMPLE).root
    const html = exportNetscape(first, 'Bookmarks')
    const second = parseNetscape(html).root

    expect(countTokens(html)).toEqual({ links: 5, folders: 3 })

    const flat = (root: any): any[] => {
      const out: any[] = []
      const walk = (n: any) => {
        out.push({ name: n.name, url: n.url, type: n.type, addDate: n.addDate })
        for (const c of n.children) walk(c)
      }
      walk(root)
      return out
    }
    expect(flat(second)).toEqual(flat(first))
  })
})

describe('countTokens', () => {
  it('counts DT tokens', () => {
    expect(countTokens(SAMPLE)).toEqual({ links: 5, folders: 3 })
  })
})