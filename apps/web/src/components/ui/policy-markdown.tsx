import Markdown from 'react-markdown'
import type { Components } from 'react-markdown'

const components: Components = {
  h1: ({ children }) => <h2>{children}</h2>,
}

export function PolicyMarkdown({ children }: { children: string }) {
  return (
    <div className="policy-markdown min-w-0 break-words">
      <Markdown
        skipHtml
        allowedElements={[
          'h1',
          'h2',
          'h3',
          'h4',
          'h5',
          'h6',
          'p',
          'a',
          'strong',
          'em',
          'blockquote',
          'ul',
          'ol',
          'li',
          'hr',
          'br',
          'pre',
          'code',
        ]}
        components={components}
      >
        {children}
      </Markdown>
    </div>
  )
}
