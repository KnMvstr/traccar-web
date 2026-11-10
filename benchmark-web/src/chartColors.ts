export const chartColors = ['#24735b', '#bc9251', '#788cb2'];
const fills = ['#dcebe3', '#f0e6d4', '#e0e6f0'];
const setupOrder = ['off', 'on', 'on-no-routing'];

export function setupStyle(id: string, fallback = 0) {
  const known = setupOrder.indexOf(id);
  const index = (known < 0 ? fallback : known) % chartColors.length;
  return { index, color: chartColors[index], fill: fills[index] };
}
