// CSV rows include blank-name continuations used by the client's effect tables.
export function csvRows(text) {
  const rows = [];
  let row = [],
    field = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && (c === "," || c === "\n")) {
      row.push(field.replace(/\r$/, ""));
      field = "";
      if (c === "\n") {
        rows.push(row);
        row = [];
      }
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const headers = rows.shift();
  return rows
    .filter((r) => r[0] !== "string")
    .map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""])));
}
export function csvGroups(text) {
  const groups = {};
  let name;
  for (const row of csvRows(text)) {
    if (row.Name) name = row.Name;
    if (name) (groups[name] ??= []).push(row);
  }
  return groups;
}
