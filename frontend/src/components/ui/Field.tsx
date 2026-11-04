import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'

interface Common {
  label: string
  error?: string
  hint?: string
}

const control =
  'block w-full rounded-lg border bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-royal-500 focus:outline-none focus:ring-2 focus:ring-royal-500/20 disabled:bg-slate-50'

function Wrapper({ id, label, error, hint, children }: Common & { id: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-slate-700">
        {label}
      </label>
      {children}
      {hint && !error && <p id={`${id}-hint`} className="mt-1 text-xs text-slate-500">{hint}</p>}
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-1 text-xs font-medium text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}

const describedBy = (id: string, error?: string, hint?: string) => (error ? `${id}-error` : hint ? `${id}-hint` : undefined)

export const TextField = forwardRef<HTMLInputElement, Common & InputHTMLAttributes<HTMLInputElement> & { prefix?: ReactNode }>(function TextField(
  { label, error, hint, prefix, className = '', ...rest },
  ref,
) {
  const id = useId()
  return (
    <Wrapper id={id} label={label} error={error} hint={hint}>
      <div className="flex">
        {prefix && <span className="inline-flex items-center rounded-l-lg border border-r-0 border-slate-300 bg-slate-50 px-3 text-sm text-slate-600">{prefix}</span>}
        <input
          id={id}
          ref={ref}
          aria-invalid={!!error}
          aria-describedby={describedBy(id, error, hint)}
          className={`${control} ${error ? 'border-red-400' : 'border-slate-300'} ${prefix ? 'rounded-l-none' : ''} ${className}`}
          {...rest}
        />
      </div>
    </Wrapper>
  )
})

export const SelectField = forwardRef<HTMLSelectElement, Common & SelectHTMLAttributes<HTMLSelectElement>>(function SelectField(
  { label, error, hint, className = '', children, ...rest },
  ref,
) {
  const id = useId()
  return (
    <Wrapper id={id} label={label} error={error} hint={hint}>
      <select id={id} ref={ref} aria-invalid={!!error} aria-describedby={describedBy(id, error, hint)} className={`${control} ${error ? 'border-red-400' : 'border-slate-300'} ${className}`} {...rest}>
        {children}
      </select>
    </Wrapper>
  )
})

export const TextAreaField = forwardRef<HTMLTextAreaElement, Common & TextareaHTMLAttributes<HTMLTextAreaElement>>(function TextAreaField(
  { label, error, hint, className = '', ...rest },
  ref,
) {
  const id = useId()
  return (
    <Wrapper id={id} label={label} error={error} hint={hint}>
      <textarea id={id} ref={ref} aria-invalid={!!error} aria-describedby={describedBy(id, error, hint)} className={`${control} ${error ? 'border-red-400' : 'border-slate-300'} ${className}`} {...rest} />
    </Wrapper>
  )
})
