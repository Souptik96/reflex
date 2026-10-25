import readline from 'node:readline';

export type InputReader = () => Promise<string>;

export async function promptConfirmation(
  question: string,
  defaultValue: boolean = false,
  inputReader?: InputReader
): Promise<boolean> {
  if (inputReader) {
    const raw = (await inputReader()).trim().toLowerCase();
    if (raw === 'y' || raw === 'yes') return true;
    if (raw === 'n' || raw === 'no') return false;
    return defaultValue;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise<boolean>((resolve) => {
    const suffix = defaultValue ? ' [Y/n]: ' : ' [y/N]: ';
    rl.question(`${question}${suffix}`, (answer) => {
      rl.close();
      const trimmed = answer.trim().toLowerCase();
      if (!trimmed) {
        resolve(defaultValue);
      } else if (trimmed === 'y' || trimmed === 'yes') {
        resolve(true);
      } else if (trimmed === 'n' || trimmed === 'no') {
        resolve(false);
      } else {
        resolve(defaultValue);
      }
    });
  });
}
