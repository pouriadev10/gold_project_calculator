import { beforeEach, describe, expect, it } from 'vitest';
import { UNIT_STORAGE_KEY, useUnitStore } from './unit-store';

beforeEach(() => {
  localStorage.clear();
  useUnitStore.setState({ unit: 'gold' });
});

describe('unit-store — پیش‌فرض', () => {
  it('پیش‌فرض طلاست، نه ریال', () => {
    expect(useUnitStore.getState().unit).toBe('gold');
  });
});

describe('unit-store — تغییر', () => {
  it('setUnit مقدار را عوض می‌کند', () => {
    useUnitStore.getState().setUnit('rial');
    expect(useUnitStore.getState().unit).toBe('rial');
  });

  it('toggleUnit بین دو حالت جابه‌جا می‌شود', () => {
    const { toggleUnit } = useUnitStore.getState();

    toggleUnit();
    expect(useUnitStore.getState().unit).toBe('rial');

    toggleUnit();
    expect(useUnitStore.getState().unit).toBe('gold');
  });
});

describe('unit-store — persistence', () => {
  it('تغییر بلافاصله در localStorage نوشته می‌شود تا refresh حفظش کند', () => {
    useUnitStore.getState().setUnit('rial');

    const raw = localStorage.getItem(UNIT_STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw ?? '{}')).toMatchObject({ state: { unit: 'rial' } });
  });
});
