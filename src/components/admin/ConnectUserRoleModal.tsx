import { useState } from "react";
import { toast } from "sonner";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";
import { Modal } from "@/components/ui/modal";

interface Profile {
  id: string;
  name: string;
}

interface EditableUser {
  userId: string;
  username: string;
  firstName?: string;
  lastName?: string;
  groupIds: string[];
}

interface Props {
  user: EditableUser;
  available: Profile[];
  onClose: () => void;
  onSaved: () => void;
}

/**
 * ConnectUserRoleModal — permite a un Admin cambiar los perfiles de seguridad
 * (Admin / Agent / CallCenterManager / …) de un agente de Amazon Connect SIN
 * salir de ARIA. Hace PUT a list-users, que llama UpdateUserSecurityProfiles en
 * la instancia del tenant. Acción privilegiada: el backend re-verifica que el
 * que llama sea Admin.
 */
export function ConnectUserRoleModal({ user, available, onClose, onSaved }: Props) {
  const [selected, setSelected] = useState<string[]>(user.groupIds || []);
  const [saving, setSaving] = useState(false);

  const name =
    user.firstName || user.lastName
      ? `${user.firstName || ""} ${user.lastName || ""}`.trim()
      : user.username;

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const save = async () => {
    if (selected.length === 0) {
      toast.error("El agente necesita al menos un perfil de seguridad.");
      return;
    }
    setSaving(true);
    try {
      const ep = getApiEndpoints();
      if (!ep?.listUsers) throw new Error("API no configurada");
      const r = await authedFetch(ep.listUsers, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.userId,
          securityProfileIds: selected,
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${r.status}`);
      }
      toast.success(`Perfiles de ${name} actualizados`);
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo actualizar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="Perfiles de seguridad"
      className="max-w-md"
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button
            className="btn btn--primary"
            onClick={save}
            disabled={saving || selected.length === 0}
          >
            {saving ? "Guardando…" : "Guardar"}
          </button>
        </>
      }
    >
      <div style={{ color: "var(--text-3)", fontSize: 12.5, marginTop: 2 }}>
        {name} · {user.username}
      </div>
      <div
        style={{
          color: "var(--text-3)",
          fontSize: 11.5,
          marginTop: 8,
          marginBottom: 12,
        }}
      >
        Qué perfiles de Amazon Connect tiene este agente. Define qué puede ver y hacer en el contact
        center.
      </div>

      {available.length === 0 ? (
        <div style={{ fontSize: 12.5, color: "var(--text-3)", padding: "12px 0" }}>
          No se pudieron cargar los perfiles disponibles.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {available.map((p) => (
            <label
              key={p.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "9px 8px",
                borderRadius: 8,
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              <input
                type="checkbox"
                checked={selected.includes(p.id)}
                onChange={() => toggle(p.id)}
              />
              {p.name}
            </label>
          ))}
        </div>
      )}
    </Modal>
  );
}
