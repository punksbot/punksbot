export interface ProjectionShardEnv {
  D1_SHARD_COUNT: "4";
  PROJECTION_DB_0: D1Database;
  PROJECTION_DB_1: D1Database;
  PROJECTION_DB_2: D1Database;
  PROJECTION_DB_3: D1Database;
}

/** Returns the sole global catalogue binding; global records are never hashed. */
export function globalProjectionDatabase(env: ProjectionShardEnv): D1Database {
  return env.PROJECTION_DB_0;
}

export function shardIndex(workspaceId: string, shardCount: number): number {
  if (shardCount !== 4) {
    throw new RangeError("D1 uses a fixed four-shard ring");
  }

  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(workspaceId)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % shardCount;
}

export function projectionDatabase(
  env: ProjectionShardEnv,
  workspaceId: string,
): D1Database {
  if (env.D1_SHARD_COUNT !== "4") {
    throw new RangeError("D1 uses a fixed four-shard ring");
  }
  const databases = [
    env.PROJECTION_DB_0,
    env.PROJECTION_DB_1,
    env.PROJECTION_DB_2,
    env.PROJECTION_DB_3,
  ];
  const index = shardIndex(workspaceId, 4);
  const database = databases[index];
  if (database === undefined) {
    throw new Error(`D1 projection shard ${index} is not bound`);
  }
  return database;
}
