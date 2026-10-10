import { useEffect, useState } from "react";
import { isPlainDisplayValue } from "../engine/tableValueOverrides";

export function TableValueOverrideControls({ cellKey, sourceValue, overrideValue, onApply, onClear }: {
  cellKey: string; sourceValue: string; overrideValue?: string;
  onApply: (value: string) => void; onClear: () => void;
}) {
  const [value, setValue] = useState(overrideValue ?? "");
  useEffect(() => setValue(overrideValue ?? ""), [cellKey, overrideValue]);
  const valid = isPlainDisplayValue(value);
  return <div className="manual-table-value-override">
    <strong>Manual display override</strong>
    {overrideValue !== undefined && <p>Manual override active</p>}
    <p>Source value: {sourceValue}</p>
    {overrideValue !== undefined && <p>Override value: {overrideValue}</p>}
    <label>Override display value
      <input aria-label="Override display value" value={value} onChange={(event) => setValue(event.target.value)} />
    </label>
    <small>Overrides this cell in the report only. Source data is unchanged.</small>
    {!valid && <p role="alert">Enter plain display text, not a formula.</p>}
    <div className="button-row">
      <button type="button" disabled={!valid} onClick={() => onApply(value)}>Apply override</button>
      <button type="button" disabled={overrideValue === undefined} onClick={onClear}>Clear override / Revert to source</button>
    </div>
  </div>;
}
