import path from 'node:path';
import { beforeAll } from 'vitest';
import { treeSitterCSharpRuntime } from '../TreeSitterCSharpRuntime';

beforeAll(async () => {
  const publicDir = path.resolve(process.cwd(), 'public');
  await treeSitterCSharpRuntime.initForNode(publicDir);
});
