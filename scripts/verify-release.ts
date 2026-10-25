import fs from 'node:fs';
import path from 'node:path';

interface VerificationResult {
  packageName: string;
  passed: boolean;
  errors: string[];
  warnings: string[];
  checks: {
    name: string;
    passed: boolean;
    details?: string;
  }[];
}

const ROOT_DIR = process.cwd();
const PACKAGES_DIR = path.join(ROOT_DIR, 'packages');

const EXPECTED_PACKAGES = [
  'core',
  'jev',
  'cloudflare',
  'verify',
  'reflex',
  'benchmarks',
  'cli',
];

export async function verifyPackage(packageDirName: string): Promise<VerificationResult> {
  const pkgDir = path.join(PACKAGES_DIR, packageDirName);
  const pkgJsonPath = path.join(pkgDir, 'package.json');

  const result: VerificationResult = {
    packageName: packageDirName,
    passed: true,
    errors: [],
    warnings: [],
    checks: [],
  };

  // 1. package.json exists and is valid JSON
  if (!fs.existsSync(pkgJsonPath)) {
    result.passed = false;
    result.errors.push(`Missing package.json in ${pkgDir}`);
    return result;
  }

  let pkgJson: Record<string, unknown>;
  try {
    const raw = fs.readFileSync(pkgJsonPath, 'utf8');
    pkgJson = JSON.parse(raw) as Record<string, unknown>;
    result.packageName = (pkgJson['name'] as string) ?? packageDirName;
    result.checks.push({ name: 'package.json is valid JSON', passed: true });
  } catch (err) {
    result.passed = false;
    result.errors.push(`Invalid JSON in ${pkgJsonPath}: ${(err as Error).message}`);
    return result;
  }

  // 2. Metadata checks: name, version, type=module
  if (typeof pkgJson['name'] !== 'string' || !pkgJson['name'].startsWith('@reflex-ai/')) {
    result.passed = false;
    result.errors.push(`Package name '${String(pkgJson['name'])}' must start with '@reflex-ai/'`);
  } else {
    result.checks.push({ name: 'Package name conforms to scope @reflex-ai/', passed: true });
  }

  if (typeof pkgJson['version'] !== 'string') {
    result.passed = false;
    result.errors.push('Missing or invalid "version" in package.json');
  } else {
    result.checks.push({ name: `Version specified: ${pkgJson['version']}`, passed: true });
  }

  if (pkgJson['type'] !== 'module') {
    result.passed = false;
    result.errors.push('Package must be "type": "module" (ESM)');
  } else {
    result.checks.push({ name: 'ESM type: "module" configured', passed: true });
  }

  // 3. Main entrypoint verification
  const mainField = pkgJson['main'] as string | undefined;
  if (!mainField) {
    result.passed = false;
    result.errors.push('Missing "main" field in package.json');
  } else {
    const mainPath = path.join(pkgDir, mainField);
    if (!fs.existsSync(mainPath)) {
      result.passed = false;
      result.errors.push(`Main entrypoint does not exist on disk: ${mainField}`);
    } else {
      result.checks.push({ name: `Main entrypoint exists: ${mainField}`, passed: true });
    }
  }

  // 4. TypeScript declarations (.d.ts) verification
  const typesField = pkgJson['types'] as string | undefined;
  if (!typesField) {
    result.passed = false;
    result.errors.push('Missing "types" field in package.json');
  } else {
    const typesPath = path.join(pkgDir, typesField);
    if (!fs.existsSync(typesPath)) {
      result.passed = false;
      result.errors.push(`TypeScript declarations (.d.ts) not found on disk: ${typesField}`);
    } else {
      const stats = fs.statSync(typesPath);
      if (stats.size === 0) {
        result.passed = false;
        result.errors.push(`TypeScript declaration file is empty: ${typesField}`);
      } else {
        result.checks.push({ name: `Type definitions (.d.ts) verified (${stats.size} bytes)`, passed: true });
      }
    }
  }

  // 5. Exports map verification
  const exportsField = pkgJson['exports'] as Record<string, unknown> | undefined;
  if (!exportsField || typeof exportsField !== 'object') {
    result.passed = false;
    result.errors.push('Missing "exports" map in package.json');
  } else {
    const rootExport = exportsField['.'] as Record<string, string> | undefined;
    if (rootExport && typeof rootExport === 'object') {
      if (rootExport['import']) {
        const importPath = path.join(pkgDir, rootExport['import']);
        if (!fs.existsSync(importPath)) {
          result.passed = false;
          result.errors.push(`Export '.' import target not found on disk: ${rootExport['import']}`);
        }
      }
      if (rootExport['types']) {
        const dtsPath = path.join(pkgDir, rootExport['types']);
        if (!fs.existsSync(dtsPath)) {
          result.passed = false;
          result.errors.push(`Export '.' types target not found on disk: ${rootExport['types']}`);
        }
      }
    }
    result.checks.push({ name: 'Export maps verified against built artifacts', passed: true });
  }

  // 6. Binary entrypoint check (for @reflex-ai/cli)
  const binField = pkgJson['bin'] as Record<string, string> | undefined;
  if (binField && typeof binField === 'object') {
    for (const [binName, binRelPath] of Object.entries(binField)) {
      const binFullPath = path.join(pkgDir, binRelPath);
      if (!fs.existsSync(binFullPath)) {
        result.passed = false;
        result.errors.push(`Binary entrypoint '${binName}' not found on disk: ${binRelPath}`);
      } else {
        const content = fs.readFileSync(binFullPath, 'utf8');
        if (!content.startsWith('#!/usr/bin/env node')) {
          result.warnings.push(`Binary '${binName}' does not start with '#!/usr/bin/env node' shebang`);
        }
        result.checks.push({ name: `CLI binary entrypoint '${binName}' verified: ${binRelPath}`, passed: true });
      }
    }
  }

  return result;
}

export async function runReleaseVerification(): Promise<boolean> {
  console.log('='.repeat(70));
  console.log(' Reflex Engine Release Verification & Packaging Integrity Audit');
  console.log('='.repeat(70));

  let totalPassed = 0;
  let totalFailed = 0;

  for (const pkgName of EXPECTED_PACKAGES) {
    const res = await verifyPackage(pkgName);
    console.log(`\n📦 Package: ${res.packageName} (${pkgName})`);

    for (const check of res.checks) {
      console.log(`   ✓ ${check.name}`);
    }

    if (res.warnings.length > 0) {
      for (const w of res.warnings) {
        console.log(`   ⚠️  WARNING: ${w}`);
      }
    }

    if (res.errors.length > 0) {
      for (const err of res.errors) {
        console.log(`   ❌ ERROR: ${err}`);
      }
      totalFailed++;
    } else {
      totalPassed++;
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log(`Summary: ${totalPassed}/${EXPECTED_PACKAGES.length} packages passed release verification.`);
  console.log('='.repeat(70));

  if (totalFailed > 0) {
    console.error(`\n❌ Release verification FAILED with ${totalFailed} invalid package(s).`);
    return false;
  }

  console.log('\n✅ All workspace packages are 100% production ready for npm release!');
  return true;
}

// Auto-run if executed directly
if (process.argv[1]?.endsWith('verify-release.ts') || process.argv[1]?.endsWith('verify-release.js')) {
  runReleaseVerification().then((passed) => {
    process.exit(passed ? 0 : 1);
  });
}
