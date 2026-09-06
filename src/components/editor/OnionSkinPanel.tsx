import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { ONION_MAX_DEPTH, ONION_MIN_OPACITY, type PixelEditorEngine } from '@/hooks/usePixelEditor';
import { useLanguage } from '@/lib/i18n';
import type { OnionColorMode } from '@/lib/types';

/** Its own panel rather than three more rows inside PreviewPanel: onion skin is about the *canvas*
 *  (which neighbouring frames show through while drawing), not about the animation preview it used to
 *  be bolted onto, and the settings only make sense together - "how far back", "how far forward",
 *  "how strongly", "in what color". The old UI offered one shared depth of 1-2 with a fixed opacity,
 *  which is why the frames after the current one were easy to miss entirely. */
export function OnionSkinPanel({ engine }: { engine: PixelEditorEngine }) {
  const { t } = useLanguage();
  const multiFrame = engine.current.frames.length > 1;
  return (
    <div className="onion-panel">
      <span className="panel-title">{t('onion.title')}</span>
      <label className="mini-toggle" title={t('onion.enableTitle')}>
        <Checkbox checked={engine.onionSkin} onCheckedChange={(v) => engine.setOnionSkin(!!v)} />
        <Label>{t('onion.enable')}</Label>
      </label>
      {/* Not hidden when a sprite has a single frame - the controls would vanish and reappear as frames
          are added, and there's nothing wrong with setting this up before animating. Said plainly
          instead. */}
      {engine.onionSkin && !multiFrame && <span className="onion-hint">{t('onion.singleFrame')}</span>}
      {engine.onionSkin && (
        <>
          <div className="onion-depths">
            <DepthStepper
              label={t('onion.before')}
              title={t('onion.beforeTitle')}
              swatch="onion-swatch-before"
              value={engine.onionBefore}
              onChange={(v) => engine.setOnionBefore(v)}
            />
            <DepthStepper
              label={t('onion.after')}
              title={t('onion.afterTitle')}
              swatch="onion-swatch-after"
              value={engine.onionAfter}
              onChange={(v) => engine.setOnionAfter(v)}
            />
          </div>
          <div className="onion-row" title={t('onion.opacityTitle')}>
            <Label htmlFor="onion-opacity">{t('onion.opacity')}</Label>
            <input
              id="onion-opacity"
              type="range"
              min={ONION_MIN_OPACITY}
              max={1}
              step={0.05}
              value={engine.onionOpacity}
              onChange={(e) => engine.setOnionOpacity(Number(e.target.value))}
            />
            <span className="onion-value">{Math.round(engine.onionOpacity * 100)}%</span>
          </div>
          <div className="onion-row" title={t('onion.colorModeTitle')}>
            <Label htmlFor="onion-color-mode">{t('onion.colorMode')}</Label>
            <select
              id="onion-color-mode"
              className="retro onion-select"
              value={engine.onionColorMode}
              onChange={(e) => engine.setOnionColorMode(e.target.value as OnionColorMode)}
            >
              <option value="tint">{t('onion.colorMode.tint')}</option>
              <option value="original">{t('onion.colorMode.original')}</option>
            </select>
          </div>
        </>
      )}
    </div>
  );
}

/** A 0..ONION_MAX_DEPTH stepper. 0 is a real value here - "show nothing on this side" - which is what
 *  makes the two directions independently switchable without a second checkbox each. */
function DepthStepper({
  label,
  title,
  swatch,
  value,
  onChange,
}: {
  label: string;
  title: string;
  swatch: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="onion-depth" title={title}>
      <span className={`onion-swatch ${swatch}`} aria-hidden />
      <span className="onion-depth-label">{label}</span>
      <div className="onion-stepper">
        <button type="button" className="retro" disabled={value <= 0} onClick={() => onChange(value - 1)} aria-label={`${label} -`}>
          −
        </button>
        <span className="onion-value">{value}</span>
        <button
          type="button"
          className="retro"
          disabled={value >= ONION_MAX_DEPTH}
          onClick={() => onChange(value + 1)}
          aria-label={`${label} +`}
        >
          +
        </button>
      </div>
    </div>
  );
}
