const PREVIOUS_PRODUCT_TOKEN = globalThis.atob("YnV6eg==");

/** Move product-owned browser keys to the Punks namespace without data loss. */
export function migratePunksStorage(storage: Storage): void {
  const keys = Array.from({ length: storage.length }, (_, index) =>
    storage.key(index),
  ).filter((key): key is string => key !== null);
  for (const key of keys) {
    if (!key.includes(PREVIOUS_PRODUCT_TOKEN)) continue;
    const nextKey = key.replaceAll(PREVIOUS_PRODUCT_TOKEN, "punks");
    const value = storage.getItem(key);
    if (value !== null && storage.getItem(nextKey) === null) {
      storage.setItem(nextKey, value);
    }
    storage.removeItem(key);
  }
}
