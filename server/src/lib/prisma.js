import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbUrl = process.env.DATABASE_URL
  ?? `file:${path.resolve(__dirname, '../../prisma/rh-data.db')}`;
const finalUrl = dbUrl.startsWith('file:') && !path.isAbsolute(dbUrl.slice(5))
  ? `file:${path.resolve(process.cwd(), dbUrl.slice(5))}`
  : dbUrl;

console.log('[PRISMA] DB:', finalUrl);
const adapter = new PrismaBetterSqlite3({ url: finalUrl });
export const prisma = new PrismaClient({ adapter });
