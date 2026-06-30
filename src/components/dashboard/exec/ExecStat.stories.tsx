import type { Meta, StoryObj } from "@storybook/react-vite";
import { Headset, Smiley, Lightning } from "@phosphor-icons/react";
import { ExecStat } from "./ExecStat";

/**
 * Story de ejemplo (PoC de Storybook) sobre un componente real del proyecto.
 * El decorator envuelve el KPI en `.exec` para que estén definidas las
 * variables de tema (--e-*) que usa el componente.
 */
const meta: Meta<typeof ExecStat> = {
  title: "Exec/ExecStat",
  component: ExecStat,
  decorators: [
    (Story) => (
      <div className="exec" style={{ padding: 24, maxWidth: 280 }}>
        <Story />
      </div>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof ExecStat>;

export const Contactos: Story = {
  args: {
    label: "Contactos",
    value: 184,
    accent: "var(--e-cyan)",
    delta: 23,
    icon: Headset,
  },
};

export const SentimentPositivo: Story = {
  args: {
    label: "Sentiment +",
    value: 62,
    unit: "%",
    accent: "var(--e-green)",
    note: "del total analizado",
    icon: Smiley,
  },
};

export const Leads: Story = {
  args: {
    label: "Leads",
    value: 47,
    accent: "var(--e-amber)",
    delta: -12,
    icon: Lightning,
  },
};
