const cache = new Map();

export function loadList(name = "default") {
  if (!cache.has(name)) {
    cache.set(
      name,
      fetch(`https://api.color.pizza/v1/?list=${name}`)
        .then((res) => res.json())
        .then((data) => data.colors || [])
        .catch((err) => {
          cache.delete(name); // so a later call retries
          throw err;
        })
    );
  }
  return cache.get(name);
}
