/*
  color.pizza API — one memoized fetch per list, shared across sections
  so the big default list (31,912 colors) is only pulled once.
*/

const cache = new Map();

export function loadList(name = "default") {
  if (!cache.has(name)) {
    cache.set(
      name,
      fetch(`https://api.color.pizza/v1/?list=${name}`)
        .then((res) => res.json())
        .then((data) => data.colors || [])
        .catch((err) => {
          cache.delete(name); // let a later attempt retry
          throw err;
        })
    );
  }
  return cache.get(name);
}
