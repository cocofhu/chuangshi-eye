import { formatWindSpeed, WIND_UNITS } from './inspection.js';

/** Reformat a captured sample; changing units never samples the map again. */
export function formatWindReading(reading, units) {
  if (!reading) return null;
  return {
    ...reading,
    units,
    scalarValue:
      reading.scalarKind === 'speed'
        ? formatWindSpeed(reading.speed, units)
        : reading.scalarValue,
    wind: Number.isFinite(reading.speed)
      ? `${formatWindSpeed(reading.speed, units)}${reading.from === '静风' ? ' · 静风' : ` 来自 ${reading.from}`}`
      : reading.wind,
  };
}

export function windUnitChips(units) {
  return Object.keys(WIND_UNITS).map((value) => ({
    id: `units-${value}`,
    label: value,
    active: units === value,
    params: { units: value },
    title: '风速单位',
  }));
}

/** Portable result block consumed by the WEATHER card. */
export function windReadingResult(reading) {
  return {
    id: 'reading',
    label: `中心风场 ${reading.coordinates.replace(' · ', ' ')}`,
    lines: [
      {
        id: 'wind',
        text: reading.wind,
      },
      {
        id: 'meta',
        text: `${reading.model} · 有效 ${reading.validTime?.replace(/^\d{4}-/, '')}`,
      },
      ...(reading.scalarValue
        ? [
            {
              id: 'scalar',
              text: `${reading.scalarLabel} · ${reading.scalarValue}`,
            },
          ]
        : []),
      { id: 'explanation', text: reading.explanation },
    ],
    clear: { params: { inspect: false } },
  };
}
