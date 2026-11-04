import { MapPin, Pencil, Plus, Star, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/feedback'
import { AddressForm } from '@/features/orders/AddressForm'
import { useAddresses, useCreateAddress, useDeleteAddress, useUpdateAddress } from '@/features/orders/hooks'
import { usePageTitle } from '@/hooks/usePageTitle'
import { errorMessage } from '@/lib/api'
import { useToast } from '@/lib/toast'
import type { Address } from '@/types/api'

export function AddressesPage() {
  usePageTitle('Delivery addresses')
  const toast = useToast()
  const { data, isPending, isError, refetch } = useAddresses()
  const create = useCreateAddress()
  const update = useUpdateAddress()
  const remove = useDeleteAddress()
  const [editing, setEditing] = useState<Address | 'new' | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const fail = (e: unknown) => toast.error(errorMessage(e))

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold text-navy-900 sm:text-3xl">Delivery addresses</h1>
        {editing === null && <Button icon={<Plus className="h-4 w-4" aria-hidden />} onClick={() => setEditing('new')}>Add address</Button>}
      </div>

      {editing !== null && (
        <section aria-label={editing === 'new' ? 'New address' : 'Edit address'} className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="mb-4 font-bold text-navy-900">{editing === 'new' ? 'New address' : 'Edit address'}</h2>
          <AddressForm
            key={editing === 'new' ? 'new' : editing.id}
            defaultValues={editing === 'new' ? undefined : { ...editing, region: editing.region ?? '', postalCode: editing.postalCode ?? '' }}
            submitLabel={editing === 'new' ? 'Add address' : 'Save changes'}
            onCancel={() => setEditing(null)}
            onSubmit={async (v) => {
              try {
                if (editing === 'new') await create.mutateAsync(v)
                else await update.mutateAsync({ id: editing.id, ...v })
                toast.success('Address saved.')
                setEditing(null)
              } catch (e) {
                fail(e)
              }
            }}
          />
        </section>
      )}

      <div className="mt-6">
        {isPending ? <div className="grid gap-4 sm:grid-cols-2"><Skeleton className="h-36" /><Skeleton className="h-36" /></div> : isError ? <ErrorState onRetry={() => void refetch()} /> : data.length === 0 && editing === null ? (
          <EmptyState icon={<MapPin className="h-6 w-6" />} title="No saved addresses" text="Add a delivery address to check out faster." action={<Button onClick={() => setEditing('new')}>Add address</Button>} />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {data.map((a) => (
              <li key={a.id} className={`rounded-2xl border bg-white p-5 text-sm ${a.isDefault ? 'border-navy-900 ring-1 ring-navy-900' : 'border-slate-200'}`}>
                <div className="flex items-center justify-between">
                  <p className="flex items-center gap-2 font-bold text-navy-900"><MapPin className="h-4 w-4" aria-hidden />{a.label}</p>
                  {a.isDefault && <span className="rounded bg-royal-100 px-2 py-0.5 text-[10px] font-bold uppercase text-royal-700">Default</span>}
                </div>
                <address className="mt-3 not-italic text-slate-700">{a.recipientName}<br />{a.street}<br />{a.city}{a.region ? `, ${a.region}` : ''}{a.postalCode ? ` ${a.postalCode}` : ''}<br />{a.country}<br /><span className="text-slate-500">{a.phone}</span></address>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" icon={<Pencil className="h-3.5 w-3.5" aria-hidden />} onClick={() => setEditing(a)}>Edit</Button>
                  {!a.isDefault && <Button size="sm" variant="outline" icon={<Star className="h-3.5 w-3.5" aria-hidden />} loading={update.isPending && update.variables?.id === a.id} onClick={() => update.mutate({ id: a.id, isDefault: true }, { onSuccess: () => toast.success('Default address updated.'), onError: fail })}>Make default</Button>}
                  {confirmDelete === a.id ? (
                    <>
                      <Button size="sm" variant="danger" loading={remove.isPending} onClick={() => remove.mutate(a.id, { onSuccess: () => { toast.info('Address deleted.'); setConfirmDelete(null) }, onError: fail })}>Confirm delete</Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(null)}>Keep</Button>
                    </>
                  ) : <Button size="sm" variant="ghost" className="text-red-600 hover:bg-red-50" icon={<Trash2 className="h-3.5 w-3.5" aria-hidden />} onClick={() => setConfirmDelete(a.id)}>Delete</Button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
