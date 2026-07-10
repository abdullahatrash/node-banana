import { createInterface } from "node:readline";

/**
 * Read a secret from the terminal without echoing keystrokes. Used for the API
 * token in `nb auth login` when `--token` is not supplied, so the token never
 * lands in shell history or on-screen. Falls back gracefully on a non-TTY.
 */
export function promptSecret(question: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  // Suppress echo of typed characters while still showing the prompt text.
  const mutable = rl as unknown as {
    output?: { write: (chunk: string) => void };
    _writeToOutput?: (chunk: string) => void;
  };
  mutable._writeToOutput = (chunk: string) => {
    if (chunk.includes(question)) {
      mutable.output?.write(chunk);
    }
  };

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}
