import { Markdown } from '@/components/Markdown'
import { ButtonLink } from '@/components/ui/Button'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/feedback'
import { useContentPage } from '@/features/account/hooks'
import { usePageTitle } from '@/hooks/usePageTitle'
import { formatDate } from '@/lib/format'

/** About / FAQ / Terms / Privacy: text comes from the content API so staff can edit it without a deploy. */
export function ContentPage({ slug, fallbackTitle }: { slug: string; fallbackTitle: string }) {
  const { data, isPending, isError, error, refetch } = useContentPage(slug)
  usePageTitle(data?.title ?? fallbackTitle)

  if (isPending) return <div className="mx-auto max-w-3xl space-y-4 px-4 py-12"><Skeleton className="h-10 w-2/3" /><Skeleton className="h-4" /><Skeleton className="h-4" /><Skeleton className="h-4 w-5/6" /></div>
  if (isError) {
    return (error as { status?: number }).status === 404
      ? <EmptyState title={fallbackTitle} text="This page has not been published yet." action={<ButtonLink to="/">Back to home</ButtonLink>} />
      : <ErrorState onRetry={() => void refetch()} />
  }
  return (
    <article className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
      <Markdown source={data.body} />
      <p className="mt-10 border-t border-slate-200 pt-4 text-xs text-slate-400">Last updated {formatDate(data.updatedAt)}</p>
    </article>
  )
}
