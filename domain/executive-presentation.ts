const axisNumber = new Intl.NumberFormat("en-CA", { notation: "compact", maximumFractionDigits: 2 });
const axisPercent = new Intl.NumberFormat("en-CA", { style: "percent", maximumFractionDigits: 1 });

/** Server-rendered source evidence must not depend on the machine's local time zone. */
export function formatRecordedTimestamp(value: string | null | undefined) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return `${new Date(timestamp).toISOString().slice(0,16).replace("T", " ")} UTC`;
}

/** Money uses integer cents; counts are quantities and percentages are ratios. */
export function formatExecutiveAxisValue(value: number, unit: "money" | "count" | "percent") {
  if (!Number.isFinite(value)) return "Not available";
  if (unit === "percent") return axisPercent.format(value);
  return axisNumber.format(unit === "money" ? value / 100 : value);
}

/** Readable axes include zero and every finite value without changing plotted records. */
export function executiveAxis(values: readonly number[]) {
  const finite = values.filter(Number.isFinite);
  const low = Math.min(0,...finite), high = Math.max(0,...finite);
  if (low === high) return {min:0,max:1,ticks:[0,.25,.5,.75,1]};
  const raw = (high-low)/4;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = ([1,2,2.5,5,10].find(n=>n*power>=raw) ?? 10)*power;
  const min = Math.floor(low/step)*step, max = Math.ceil(high/step)*step;
  const ticks = Array.from({length:Math.round((max-min)/step)+1},(_,i)=>Number((min+i*step).toPrecision(12)));
  return {min,max,ticks};
}
