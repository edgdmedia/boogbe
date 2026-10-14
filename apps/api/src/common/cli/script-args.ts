/**
 * A script's own arguments. `pnpm <script> -- a b` forwards the `--` to the script as a literal
 * argument, so drop it when it comes first (it once turned the admin email into "--").
 */
export function scriptArgs(argv: readonly string[]): string[] {
  const args = argv.slice(2);
  return args[0] === '--' ? args.slice(1) : args;
}
