import { smokeApi } from "./smoke-local.mjs";

const result = await smokeApi("https://staging.punks.bot", "staging");
process.stdout.write(`${JSON.stringify(result)}\n`);
