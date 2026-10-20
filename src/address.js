// The wall's address: what it shows, in its query (model, view, list, c). Read and written here
// only, so no part of the wall can write over another's part of it.

export function readAddress() {
  const p = new URLSearchParams(location.search);
  return { model: p.get("model"), view: p.get("view"), list: p.get("list"), c: p.get("c") };
}

// changes: { key: value }, a value of null leaves the key out. The history entry stays the one
// it is, its state with it (a color page counts its own steps in it)
export function writeAddress(changes) {
  try {
    const url = new URL(location.href);
    for (const [key, value] of Object.entries(changes)) {
      if (value == null) url.searchParams.delete(key);
      else url.searchParams.set(key, value);
    }
    if (url.href !== location.href) history.replaceState(history.state, "", url);
  } catch {}
}
