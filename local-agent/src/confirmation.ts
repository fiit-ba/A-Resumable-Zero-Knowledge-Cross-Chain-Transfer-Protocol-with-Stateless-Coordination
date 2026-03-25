import readline from "node:readline";

/**
 * Prints a summary of the incoming job and asks the user to confirm (y/n)
 * via the terminal before the agent begins proof computation.
 * Resolves to `true` if confirmed, `false` if rejected or stdin is closed.
 */
export async function promptConfirmation(summary: {
  txId: string;
  sourceProfile: string;
  destinationProfile: string;
  sourceConnector: string;
  destinationConnector: string;
}): Promise<boolean> {
  if (!process.stdin.isTTY) {
    // Non-interactive (e.g. piped / CI). Auto-confirm with a warning.
    console.warn(
      "[agent] stdin is not a TTY – auto-confirming job (non-interactive mode)."
    );
    return true;
  }

  console.log("\n┌─────────────────────────────────────────────────────");
  console.log("│ Trustless Agent – New relay job received");
  console.log("├─────────────────────────────────────────────────────");
  console.log(`│  Transaction ID  : ${summary.txId}`);
  console.log(`│  Source          : ${summary.sourceProfile}`);
  console.log(`│  Destination     : ${summary.destinationProfile}`);
  console.log(`│  Src connector   : ${summary.sourceConnector}`);
  console.log(`│  Dst connector   : ${summary.destinationConnector}`);
  console.log("└─────────────────────────────────────────────────────");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question("Proceed with relay? [y/N] ", (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });

    rl.on("close", () => resolve(false));
  });
}
