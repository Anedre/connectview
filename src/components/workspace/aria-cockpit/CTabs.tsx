/* ============================================================
   ARIA · Cockpit · CTabs (tira de contactos)
   Portado de aria-agent.jsx. Solo MODO DEMO (data mock).
   ============================================================ */
import { Av, Icon } from "@/components/aria";
import { CH_META, type DemoContact } from "./mockData";

export function CTabs({
  contacts,
  activeId,
  setActiveId,
}: {
  contacts: DemoContact[];
  activeId: string;
  setActiveId: (id: string) => void;
}) {
  return (
    <div className="ctabs">
      {contacts.map((c) => {
        const m = CH_META[c.channel];
        return (
          <div
            key={c.id}
            className={"ctab" + (c.id === activeId ? " ctab--active" : "")}
            onClick={() => setActiveId(c.id)}
          >
            <div style={{ position: "relative" }}>
              <Av name={c.name} size={30} color={c.channel === "voz" ? "var(--cyan)" : "var(--green)"} />
              <span
                style={{
                  position: "absolute",
                  right: -3,
                  bottom: -3,
                  width: 15,
                  height: 15,
                  borderRadius: "50%",
                  background: m.color,
                  display: "grid",
                  placeItems: "center",
                  color: "#fff",
                  border: "2px solid var(--bg-1)",
                }}
              >
                <Icon name={m.icon} size={8} />
              </span>
            </div>
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="trunc" style={{ fontWeight: 700, fontSize: 12.5 }}>
                {c.name}
              </div>
              <div className="dim" style={{ fontSize: 10.5 }}>
                {c.prog}
              </div>
            </div>
            {c.unread ? (
              <span className="sb__count sb__count--accent">{c.unread}</span>
            ) : (
              <span className="ctab__x">
                <Icon name="x" size={13} />
              </span>
            )}
          </div>
        );
      })}
      <button className="ctab" style={{ minWidth: 0, justifyContent: "center", color: "var(--text-3)" }}>
        <Icon name="plus" size={16} />
      </button>
    </div>
  );
}
