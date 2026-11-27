'use client'

import type { AssistantAnswer } from '@ecokart/core'
import { useEffect, useId, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, Notice } from '@/components/ui/feedback'
import { Field, Textarea } from '@/components/ui/form-controls'
import { ProductGrid } from './product-card'
import { apiRequest, ApiError } from '@/lib/api-client'
import {
  assistantCards,
  assistantHistory,
  namedProductIds,
  type AssistantTurn,
} from '@/lib/assistant-report'
import { useClientReady } from '@/lib/use-client-ready'

export function ShoppingAssistant({
  productIds,
}: {
  productIds: readonly string[]
}) {
  const id = useId()
  const ready = useClientReady()
  const active = useRef<AbortController | null>(null)
  const [question, setQuestion] = useState('')
  const [turns, setTurns] = useState<AssistantTurn[]>([])
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const latest = turns.at(-1)?.answer
  useEffect(() => () => active.current?.abort(), [])
  return (
    <details className="min-w-0 rounded-xl border bg-surface p-5">
      <summary className="cursor-pointer py-2 text-lg font-semibold">
        Shopping assistant
      </summary>
      <div className="mt-4 grid min-w-0 gap-4">
        <p className="text-sm text-muted">
          Ask about the products here or compare two products. Answers use
          catalogue facts and may be unable to answer. Keep personal and payment
          details out of your question. This conversation stays in this page's
          memory.
        </p>
        <form
          className="grid gap-3"
          aria-label="Ask the shopping assistant"
          onSubmit={async (event) => {
            event.preventDefault()
            if (active.current || !ready) return
            const text = question.trim()
            if (!text) {
              setProblem('Enter a shopping question first.')
              return
            }
            const controller = new AbortController()
            active.current = controller
            setBusy(true)
            setProblem('')
            try {
              const answer = await apiRequest<AssistantAnswer>(
                '/api/assistant',
                {
                  method: 'POST',
                  json: {
                    question: text,
                    history: assistantHistory(turns),
                    productIds: namedProductIds(productIds),
                  },
                  signal: AbortSignal.any([
                    controller.signal,
                    AbortSignal.timeout(20000),
                  ]),
                },
              )
              if (!controller.signal.aborted) {
                setTurns((current) =>
                  [...current, { question: text, answer }].slice(-3),
                )
                setQuestion('')
              }
            } catch (cause) {
              if (!controller.signal.aborted)
                setProblem(
                  cause instanceof ApiError && cause.status === 429
                    ? 'The question limit is reached. Wait before trying again. You can keep shopping.'
                    : cause instanceof ApiError && cause.status === 503
                      ? 'The shopping assistant is unavailable right now. Your question is kept, and you can keep shopping.'
                      : 'The assistant could not finish. Your question is kept. Try again or continue shopping.',
                )
            } finally {
              if (active.current === controller) {
                active.current = null
                setBusy(false)
              }
            }
          }}
        >
          <Field
            label="Your shopping question"
            htmlFor={`${id}-question`}
            required
          >
            <Textarea
              value={question}
              maxLength={500}
              required
              disabled={!ready || busy}
              onChange={(event) => setQuestion(event.target.value)}
            />
          </Field>
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={!ready || busy}>
              {busy ? 'Asking...' : 'Ask assistant'}
            </Button>
            <Button
              variant="secondary"
              disabled={busy || !turns.length}
              onClick={() => {
                setTurns([])
                setProblem('')
              }}
            >
              Clear conversation
            </Button>
          </div>
        </form>
        {busy ? <output>Checking product facts...</output> : null}
        {problem ? (
          <Notice tone="warning" title="Assistant could not answer">
            {problem}
          </Notice>
        ) : null}
        {turns.length ? (
          <section
            aria-label="Assistant conversation"
            className="grid min-w-0 gap-3"
          >
            <h2 className="text-lg font-semibold">Conversation</h2>
            {turns.map((turn, index) => (
              <Card key={index} className="grid min-w-0 gap-2">
                <p className="whitespace-pre-wrap break-words">
                  <strong>You:</strong> {turn.question}
                </p>
                <p className="whitespace-pre-wrap break-words">
                  <strong>Assistant:</strong> {turn.answer.answer}
                </p>
                {turn.answer.declined ? (
                  <p className="text-sm text-muted">
                    The assistant could not answer from the available product
                    facts.
                  </p>
                ) : null}
              </Card>
            ))}
          </section>
        ) : null}
        {latest && assistantCards(latest).length ? (
          <section
            aria-label="Products cited by the assistant"
            className="grid gap-3"
          >
            <h2 className="text-lg font-semibold">Cited products</h2>
            <ProductGrid products={assistantCards(latest)} />
          </section>
        ) : null}
        {latest?.comparison ? (
          <section
            aria-label="Product comparison"
            className="grid min-w-0 gap-3"
          >
            <h2 className="text-lg font-semibold">Product comparison</h2>
            <p className="break-words">
              {latest.comparison.products[0].title} and{' '}
              {latest.comparison.products[1].title}
            </p>
            <ul className="grid min-w-0 gap-3">
              {latest.comparison.points.map((point, index) => (
                <li key={index}>
                  <Card className="grid min-w-0 gap-3">
                    <h3 className="font-semibold break-words">
                      {point.aspect}
                    </h3>
                    <dl className="grid min-w-0 gap-3 md:grid-cols-2">
                      <div className="min-w-0">
                        <dt className="text-sm font-medium break-words">
                          {latest.comparison!.products[0].title}
                        </dt>
                        <dd className="mt-1 whitespace-pre-wrap break-words">
                          {point.first}
                        </dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-sm font-medium break-words">
                          {latest.comparison!.products[1].title}
                        </dt>
                        <dd className="mt-1 whitespace-pre-wrap break-words">
                          {point.second}
                        </dd>
                      </div>
                    </dl>
                  </Card>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </details>
  )
}
