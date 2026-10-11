import { ENERGY_LABEL, ENERGY_SHORT, type EnergyLevel } from '../types'
import { Segmented } from './Segmented'

const LEVELS: EnergyLevel[] = [1, 2, 3]

/** Three big one-tap buttons: L / M / H. Colour plus letter plus word, never colour alone. */
export function EnergyPicker({ label, value, onPick }: { label: string; value: EnergyLevel | null; onPick: (l: EnergyLevel) => void }) {
  return (
    <Segmented
      label={label}
      value={value}
      onChange={onPick}
      className="grid grid-cols-3 gap-2"
      options={LEVELS.map((l) => ({
        value: l,
        ariaLabel: `${ENERGY_LABEL[l]} energy`,
        className: 'ps-energy-btn',
        data: { level: String(l) },
        label: (
          <>
            <span className="ps-energy-letter" aria-hidden="true">
              {ENERGY_SHORT[l]}
            </span>
            <span className="ps-energy-word" aria-hidden="true">
              {ENERGY_LABEL[l]}
            </span>
          </>
        ),
      }))}
    />
  )
}
