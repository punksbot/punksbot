export async function switchLocalAccountWithRelaunch<T>(
  input: { accountId: string; expectedGeneration: number },
  dependencies: {
    close: () => void;
    relaunch: () => Promise<unknown>;
    switchAccount: (
      accountId: string,
      expectedGeneration: number,
    ) => Promise<T>;
  },
): Promise<T> {
  const result = await dependencies.switchAccount(
    input.accountId,
    input.expectedGeneration,
  );
  dependencies.close();
  await dependencies.relaunch();
  return result;
}
