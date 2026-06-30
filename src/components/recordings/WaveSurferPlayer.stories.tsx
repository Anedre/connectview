import type { Meta, StoryObj } from "@storybook/react-vite";
import { WaveSurferPlayer } from "./WaveSurferPlayer";

/**
 * Demo de wavesurfer con audio LOCAL generado (un tono con envolvente), así el
 * story funciona sin red ni CORS. En la app real el `src` sería la URL de la
 * grabación.
 */
function makeToneWavUrl(seconds = 5, freq = 200, sampleRate = 8000): string {
  const n = seconds * sampleRate;
  const buffer = new ArrayBuffer(44 + n * 2);
  const view = new DataView(buffer);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + n * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    // Envolvente para que la onda tenga "forma" visible (no una barra plana).
    const env = 0.25 + 0.75 * Math.abs(Math.sin((i / n) * Math.PI * 7));
    const v = Math.sin((2 * Math.PI * freq * i) / sampleRate) * env * 0.6;
    view.setInt16(44 + i * 2, v * 32767, true);
  }
  return URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
}

const meta: Meta<typeof WaveSurferPlayer> = {
  title: "Recordings/WaveSurferPlayer",
  component: WaveSurferPlayer,
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 520, padding: 16 }}>
        <Story />
      </div>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof WaveSurferPlayer>;

export const Demo: Story = {
  args: { src: makeToneWavUrl(), height: 80 },
};
