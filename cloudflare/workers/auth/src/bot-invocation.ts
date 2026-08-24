import {
  type BotInvocationKeyConfig,
  mintBotInvocationCredential,
  verifyBotInvocationCredential,
} from "@punks/core";

import type { AuthEnv } from "./env";

function keyConfig(env: AuthEnv): BotInvocationKeyConfig {
  return {
    environment: env.ENVIRONMENT,
    currentKid: env.BOT_INVOCATION_CURRENT_KID,
    currentSecret: env.BOT_INVOCATION_CURRENT_SECRET,
    ...(env.BOT_INVOCATION_PREVIOUS_KID === undefined
      ? {}
      : { previousKid: env.BOT_INVOCATION_PREVIOUS_KID }),
    ...(env.BOT_INVOCATION_PREVIOUS_SECRET === undefined
      ? {}
      : { previousSecret: env.BOT_INVOCATION_PREVIOUS_SECRET }),
  };
}

export function mintBotInvocation(
  input: unknown,
  env: AuthEnv,
  nowSeconds = Math.floor(Date.now() / 1_000),
) {
  return mintBotInvocationCredential(input, keyConfig(env), nowSeconds);
}

export function verifyBotInvocation(
  input: unknown,
  env: AuthEnv,
  nowSeconds = Math.floor(Date.now() / 1_000),
) {
  return verifyBotInvocationCredential(input, keyConfig(env), nowSeconds);
}
