export function zonedParts(date = new Date(), timezone = 'Asia/Bangkok') {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(value.year), month: Number(value.month), day: Number(value.day),
    hour: Number(value.hour), minute: Number(value.minute), second: Number(value.second)
  };
}

export function sheetTimestamp(date = new Date(), timezone = 'Asia/Bangkok') {
  const p = zonedParts(date, timezone);
  const pad = (v) => String(v).padStart(2, '0');
  return `${pad(p.day)}/${pad(p.month)}/${p.year} ${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
}

export function displayTimestamp(date = new Date(), timezone = 'Asia/Bangkok') {
  const p = zonedParts(date, timezone);
  const pad = (v) => String(v).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)} (${timezone})`;
}

