import { cp, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptFile = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(scriptFile), '..');
const migrationNamePattern = /^\d{14}_[a-z0-9_]+\.sql$/;
const remoteSupabaseUrlPattern = /https:\/\/[a-z0-9-]+\.supabase\.co\b/i;
const jwtPattern = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/;

async function ensureEmptyTarget(target) {
  const resolved = path.resolve(target);
  if (resolved === projectRoot || projectRoot.startsWith(`${resolved}${path.sep}`)) {
    throw new Error('O projeto Supabase de CI deve ficar em um diretório temporário separado do repositório.');
  }
  try {
    const targetStat = await stat(resolved);
    if (!targetStat.isDirectory()) throw new Error('O destino da CI existe e não é um diretório.');
    if ((await readdir(resolved)).length) throw new Error('O diretório temporário da CI deve estar vazio.');
  } catch (error) {
    if (error && error.code === 'ENOENT') await mkdir(resolved, { recursive: true });
    else throw error;
  }
  return resolved;
}

function assertMigrationIsLocalSafe(name, source) {
  if (remoteSupabaseUrlPattern.test(source)) {
    throw new Error(`${name} contém URL remota do Supabase; externalize-a antes de executar migrations locais.`);
  }
  if (jwtPattern.test(source)) {
    throw new Error(`${name} contém JWT literal; migrations locais não podem carregar credenciais de outro ambiente.`);
  }
}

export async function prepareSupabaseCiProject(target) {
  const destination = await ensureEmptyTarget(target);
  const destinationSupabase = path.join(destination, 'supabase');
  const destinationMigrations = path.join(destinationSupabase, 'migrations');
  const destinationTests = path.join(destinationSupabase, 'tests');
  await mkdir(destinationMigrations, { recursive: true });
  await mkdir(destinationTests, { recursive: true });

  const sourceConfig = await readFile(path.join(projectRoot, 'supabase', 'config.toml'), 'utf8');
  const ciConfig = sourceConfig.replace(/^project_id\s*=\s*.*$/m, 'project_id = "ilha-app-ci"');
  await writeFile(path.join(destinationSupabase, 'config.toml'), ciConfig);

  await cp(
    path.join(projectRoot, 'supabase-schema.sql'),
    path.join(destinationMigrations, '20260801000000_schema_baseline.sql')
  );

  const bootstrapMigrations = [
    ['20260801001000_native_court_booking.sql', '20260816_native_court_booking.sql'],
    ['20260801002000_tournament_manager.sql', '20260812_tournament_manager.sql']
  ];
  for (const [targetName, sourceName] of bootstrapMigrations) {
    const source = await readFile(path.join(projectRoot, 'supabase', sourceName), 'utf8');
    assertMigrationIsLocalSafe(sourceName, source);
    await writeFile(path.join(destinationMigrations, targetName), source);
  }

  const sourceMigrations = path.join(projectRoot, 'supabase', 'migrations');
  const migrationNames = (await readdir(sourceMigrations))
    .filter((name) => name.endsWith('.sql'))
    .sort();
  if (!migrationNames.length || migrationNames.some((name) => !migrationNamePattern.test(name))) {
    throw new Error('As migrations canônicas devem usar nomes timestampados no formato esperado.');
  }
  if (new Set(migrationNames.map((name) => name.slice(0, 14))).size !== migrationNames.length) {
    throw new Error('Há timestamps duplicados nas migrations canônicas.');
  }
  for (const name of migrationNames) {
    const source = await readFile(path.join(sourceMigrations, name), 'utf8');
    assertMigrationIsLocalSafe(name, source);
    await writeFile(path.join(destinationMigrations, name), source);
  }

  const allowlistIndex = migrationNames.indexOf('20260821185000_create_protected_access_allowlist.sql');
  const hardeningIndex = migrationNames.indexOf('20260821190000_backend_security_integrity_hardening.sql');
  if (allowlistIndex < 0 || hardeningIndex !== allowlistIndex + 1) {
    throw new Error('A allowlist deve preceder imediatamente o hardening na cadeia canônica.');
  }

  await cp(
    path.join(projectRoot, 'test', 'supabase', 'fixtures', '20260821187500_ci_seed_protected_access.sql'),
    path.join(destinationMigrations, '20260821187500_ci_seed_protected_access.sql')
  );
  const sourceTests = path.join(projectRoot, 'test', 'supabase');
  const testNames = (await readdir(sourceTests))
    .filter((name) => name.endsWith('.test.sql'))
    .sort();
  if (!testNames.length) throw new Error('A CI local precisa de ao menos um contrato SQL do Supabase.');
  for (const name of testNames) {
    await cp(path.join(sourceTests, name), path.join(destinationTests, name));
  }

  return {
    destination,
    migrations: [
      '20260801000000_schema_baseline.sql',
      ...bootstrapMigrations.map(([targetName]) => targetName),
      ...migrationNames.slice(0, allowlistIndex + 1),
      '20260821187500_ci_seed_protected_access.sql',
      ...migrationNames.slice(hardeningIndex)
    ],
    tests: testNames
  };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === scriptFile;
if (invokedDirectly) {
  const target = process.argv[2];
  if (!target) throw new Error('Uso: node scripts/prepare-supabase-ci.mjs <diretório-temporário-vazio>');
  const result = await prepareSupabaseCiProject(target);
  console.log(`Projeto Supabase de CI preparado com ${result.migrations.length} migrations e dados exclusivamente sintéticos.`);
}
