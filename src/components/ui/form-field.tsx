import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * FormField — label real asociado + hint + error inline con `aria-invalid` /
 * `aria-describedby`. Reemplaza las 6 copias de `inputStyle`/`labelStyle` y el
 * antipatrón "placeholder como única etiqueta" (design/01 · P4, doc 03 · admin).
 *
 * API render-prop: el control recibe los atributos de accesibilidad ya armados.
 *   <FormField label="Email" error={err} required>
 *     {(a) => <input {...a} type="email" className="..." />}
 *   </FormField>
 */
function FormField({
  label,
  hint,
  error,
  required,
  className,
  children,
}: {
  label: string
  hint?: string
  error?: string
  required?: boolean
  className?: string
  children: (controlProps: {
    id: string
    "aria-invalid": true | undefined
    "aria-describedby": string | undefined
  }) => React.ReactNode
}) {
  const id = React.useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const describedBy = error ? errorId : hint ? hintId : undefined

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label
        htmlFor={id}
        className="text-sm font-medium"
        style={{ color: "var(--text-2)" }}
      >
        {label}
        {required && <span style={{ color: "var(--accent-red)" }}> *</span>}
      </label>

      {children({
        id,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": describedBy,
      })}

      {error ? (
        <span
          id={errorId}
          role="alert"
          className="text-xs"
          style={{ color: "var(--accent-red)" }}
        >
          {error}
        </span>
      ) : hint ? (
        <span id={hintId} className="text-xs" style={{ color: "var(--text-3)" }}>
          {hint}
        </span>
      ) : null}
    </div>
  )
}

export { FormField }
