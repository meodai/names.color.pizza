const cache = new Map();

export function loadList(name = "default") {
  if (!cache.has(name)) {
    cache.set(
      name,
      // keyed by the list this site was built with: a new list, a fresh copy, not a day-old one
      fetch(`https://api.color.pizza/v1/?list=${name}&v=${__LIST_KEY__}`)
        .then((res) => res.json())
        .then((data) => data.colors || [])
        .catch((err) => {
          cache.delete(name); // so a later call retries
          throw err;
        }),
    );
  }
  return cache.get(name);
}
