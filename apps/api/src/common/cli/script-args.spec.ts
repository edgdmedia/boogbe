import { describe, expect, it } from 'vitest';
import { scriptArgs } from './script-args';

describe('scriptArgs', () => {
  it('drops the literal "--" pnpm forwards before the script arguments', () => {
    expect(scriptArgs(['node', 'script.ts', '--', 'you@x.com', 'Name', '-'])).toEqual(['you@x.com', 'Name', '-']);
  });

  it('returns the arguments as-is when there is no leading "--"', () => {
    expect(scriptArgs(['node', 'script.ts', 'you@x.com', 'Name', 'pw'])).toEqual(['you@x.com', 'Name', 'pw']);
  });

  it('keeps a "--" that is not the first argument', () => {
    expect(scriptArgs(['node', 'script.ts', 'you@x.com', 'Name', '--'])).toEqual(['you@x.com', 'Name', '--']);
  });
});
