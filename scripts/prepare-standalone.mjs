import { cpSync, existsSync, mkdirSync } from 'node:fs';

const standalone = '.next/standalone';
if (!existsSync(standalone)) throw new Error('Standalone Next.js output is missing; run next build first');

mkdirSync(`${standalone}/.next`, { recursive: true });
cpSync('.next/static', `${standalone}/.next/static`, { recursive: true });
if (existsSync('public')) cpSync('public', `${standalone}/public`, { recursive: true });
console.log('Prepared standalone static and public assets.');
