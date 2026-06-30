import type { Meta, StoryObj } from "@storybook/react-vite";
import { VirtualList } from "./VirtualList";

/**
 * Demo de virtualización: 10.000 filas, pero el DOM solo monta las visibles.
 * Hace scroll fluido donde una lista normal con 10k nodos se arrastraría.
 */
type Row = { id: number; name: string; value: number };
const items: Row[] = Array.from({ length: 10000 }, (_, i) => ({
  id: i,
  name: `Contacto ${i + 1}`,
  value: Math.round(Math.abs(Math.sin(i)) * 1000),
}));

const meta: Meta<typeof VirtualList<Row>> = {
  title: "UI/VirtualList",
  component: VirtualList<Row>,
};
export default meta;

type Story = StoryObj<typeof VirtualList<Row>>;

export const TenThousandRows: Story = {
  render: () => (
    <div style={{ maxWidth: 480, padding: 16 }}>
      <div style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 8 }}>
        10.000 filas · solo se montan las visibles
      </div>
      <VirtualList
        items={items}
        rowHeight={44}
        height={360}
        renderRow={(it) => (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              height: 44,
              padding: "0 14px",
              borderBottom: "1px solid var(--border-1)",
              fontSize: 13,
              color: "var(--text-1)",
            }}
          >
            <span>{it.name}</span>
            <span className="mono" style={{ color: "var(--text-3)" }}>
              {it.value}
            </span>
          </div>
        )}
      />
    </div>
  ),
};
