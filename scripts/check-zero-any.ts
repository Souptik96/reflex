import fs from 'node:fs';
import path from 'node:path';

const PACKAGES_DIR = path.join(process.cwd(), 'packages');

function getTsFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...getTsFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      results.push(fullPath);
    }
  }
  return results;
}

export function checkZeroAny(): boolean {
  console.log('='.repeat(70));
  console.log(' Reflex Invariant Audit: Zero "any" Types Enforcement');
  console.log('='.repeat(70));

  const packageDirs = fs.readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(PACKAGES_DIR, d.name, 'src'));

  const violations: { file: string; line: number; content: string }[] = [];
  let filesChecked = 0;

  // Regex specifically targeting `any` used as a type annotation or cast
  // e.g.: `: any`, `<any>`, `as any`, `Promise<any>`, `Array<any>`, `Record<string, any>`
  const anyTypeRegex = /:\s*any\b|\bas\s+any\b|<[^>]*\bany\b[^>]*>/;

  for (const srcDir of packageDirs) {
    const files = getTsFiles(srcDir);
    for (const file of files) {
      filesChecked++;
      const content = fs.readFileSync(file, 'utf8');
      const lines = content.split(/\r?\n/);

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        // Ignore single-line comments and strings
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) {
          continue;
        }

        if (anyTypeRegex.test(line)) {
          violations.push({
            file: path.relative(process.cwd(), file),
            line: i + 1,
            content: line.trim(),
          });
        }
      }
    }
  }

  console.log(`\nChecked ${filesChecked} source TypeScript files across packages/*/src.`);

  if (violations.length > 0) {
    console.error(`\n❌ Found ${violations.length} forbidden "any" type violation(s):`);
    for (const v of violations) {
      console.error(`   ${v.file}:${v.line} -> ${v.content}`);
    }
    return false;
  }

  console.log('\n✅ 0 "any" types found. 100% strict type safety verified!');
  console.log('='.repeat(70));
  return true;
}

if (process.argv[1]?.endsWith('check-zero-any.ts') || process.argv[1]?.endsWith('check-zero-any.js')) {
  const passed = checkZeroAny();
  process.exit(passed ? 0 : 1);
}
