import * as React from "react"

import { Modal } from "@/components/ui/modal"
import { Button } from "@/components/ui/button"

/**
 * ConfirmDialog + useConfirm — reemplazo tematizado de `window.confirm()`/`alert()`
 * (hoy 16 usos nativos en 13 archivos — design/01 · P3).
 *
 * Uso ergonómico:
 *   const { confirm, confirmDialog } = useConfirm()
 *   ...
 *   const ok = await confirm({ title: "¿Eliminar lead?", destructive: true })
 *   if (ok) doDelete()
 *   ...
 *   return (<>{...}{confirmDialog}</>)
 */
export type ConfirmOptions = {
  title: string
  description?: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** Usa el estilo de peligro (rojo) para acciones destructivas. */
  destructive?: boolean
}

function ConfirmDialog({
  open,
  onOpenChange,
  options,
  onConfirm,
  onCancel,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  options: ConfirmOptions
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        if (!o) onCancel()
        onOpenChange(o)
      }}
      title={options.title}
      description={options.description}
      className="max-w-sm"
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onCancel}>
            {options.cancelLabel ?? "Cancelar"}
          </Button>
          <Button
            variant={options.destructive ? "destructive" : "default"}
            size="sm"
            onClick={onConfirm}
          >
            {options.confirmLabel ?? "Confirmar"}
          </Button>
        </>
      }
    />
  )
}

/**
 * Hook que devuelve una función `confirm()` que resuelve a `Promise<boolean>`
 * y el elemento `confirmDialog` que debes renderizar una vez en el componente.
 */
function useConfirm() {
  const [state, setState] = React.useState<{
    options: ConfirmOptions
    resolve: (value: boolean) => void
  } | null>(null)

  const confirm = React.useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => setState({ options, resolve })),
    []
  )

  const settle = React.useCallback(
    (value: boolean) => {
      setState((prev) => {
        prev?.resolve(value)
        return null
      })
    },
    []
  )

  const confirmDialog = (
    <ConfirmDialog
      open={state !== null}
      onOpenChange={() => {}}
      options={state?.options ?? { title: "" }}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  )

  return { confirm, confirmDialog }
}

export { ConfirmDialog, useConfirm }
