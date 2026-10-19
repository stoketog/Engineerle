import { useSettings } from '@/hooks/useSettings';
import type { ThemePref } from '@/lib/settings';
import { Modal } from './Modal';
import { IconMute, IconSound } from './Icons';

function Switch({ checked, onChange, label, testId }: { checked: boolean; onChange: (v: boolean) => void; label: string; testId: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className="switch" data-on={checked} onClick={() => onChange(!checked)} data-testid={testId} data-silent>
      <span className="switch-knob" />
    </button>
  );
}

function Row({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-white">{title}</p>
        {hint && <p className="mt-0.5 text-xs leading-snug text-mist-500">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

const THEMES: Array<{ id: ThemePref; label: string }> = [
  { id: 'auto', label: 'Auto' },
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
];

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const { settings, set, play } = useSettings();
  return (
    <Modal title="Settings" onClose={onClose} testId="settings-modal">
      <section aria-label="Sound">
        <p className="eyebrow !text-[0.62rem]">Sound</p>
        <Row title="Sound effects" hint="Taps, the scribble of your answer, the engine and the splash of the barge.">
          <Switch checked={!settings.muted} onChange={(v) => { set({ muted: !v }); if (v) window.setTimeout(() => play('hit', 2), 40); }} label="Sound effects" testId="set-sound" />
        </Row>
        <div className={`flex items-center gap-3 pb-3 ${settings.muted ? 'opacity-45' : ''}`}>
          <IconMute size={18} className="shrink-0 text-mist-500" />
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={settings.volume}
            disabled={settings.muted}
            className="range flex-1"
            aria-label="Sound effects volume"
            data-testid="set-volume"
            data-silent
            style={{ ['--fill' as string]: `${settings.volume}%` }}
            onChange={(e) => set({ volume: Number(e.target.value) })}
            onPointerUp={() => play('hit', 2)}
            onKeyUp={() => play('hit', 1)}
          />
          <IconSound size={18} className="shrink-0 text-mist-300" />
          <span className="w-9 shrink-0 text-right font-mono text-xs text-mist-300" data-testid="set-volume-label">
            {settings.volume}%
          </span>
        </div>
      </section>

      <section aria-label="Appearance" className="hairline-t border-t border-white/10 pt-3">
        <p className="eyebrow !text-[0.62rem]">Appearance</p>
        <Row title="Theme" hint="Dark blueprint, light vellum, or follow your device.">
          <div className="seg" role="radiogroup" aria-label="Theme">
            {THEMES.map((t) => (
              <button key={t.id} type="button" role="radio" aria-checked={settings.theme === t.id} data-on={settings.theme === t.id} onClick={() => set({ theme: t.id })} data-testid={`set-theme-${t.id}`}>
                {t.label}
              </button>
            ))}
          </div>
        </Row>
      </section>

      <section aria-label="Performance" className="border-t border-white/10 pt-3">
        <p className="eyebrow !text-[0.62rem]">Performance</p>
        <Row title="Low CPU mode" hint="Flat 2.5D views drawn less often at a lower resolution, with no shadows. Good for older phones and laptops.">
          <Switch checked={settings.lowCpu} onChange={(v) => set({ lowCpu: v })} label="Low CPU mode" testId="set-lowcpu" />
        </Row>
        <Row title="Reduce motion" hint="Skips swings, collapses, shaking and writing animations and shows the result at once.">
          <Switch checked={settings.reduceMotion} onChange={(v) => set({ reduceMotion: v })} label="Reduce motion" testId="set-motion" />
        </Row>
      </section>

      <p className="mt-2 text-center text-xs text-mist-500">Settings are saved on this device.</p>
      <button className="btn-primary mt-4 w-full" onClick={onClose} data-testid="settings-close">
        Done
      </button>
    </Modal>
  );
}
