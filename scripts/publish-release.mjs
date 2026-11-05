import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
if (args[0] === '--') args.shift();
const [deploymentId, expectedSha, confirmation] = args;
if (!/^dpl_[A-Za-z0-9]+$/.test(deploymentId || '') || !/^[a-f0-9]{40}$/.test(expectedSha || '') || confirmation !== '--confirm') {
  throw new Error('Uso: pnpm run release:publish -- <dpl_ID> <SHA completo aprovado> --confirm');
}
const project = 'prj_MUb9rh43OwQGAKYmnNzcWMsksagx';
const team = 'team_haAWLhBkXXQTkFqaQx150ARq';
const vc = (...args) => execFileSync('pnpm', ['dlx', 'vercel@65.11.0', ...args, '--scope', 'leandrostrelow'], {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, VERCEL_PROJECT_ID: project, VERCEL_ORG_ID: team }
}).trim();
const api = route => JSON.parse(vc('api', `${route}?teamId=${team}`));
const gh = async route => {
  const response = await fetch(`https://api.github.com/repos/leandrostrelow/ilha-app/${route}`, { headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } });
  if (!response.ok) throw new Error(`GitHub indisponível para conferência (${response.status}); publicação bloqueada.`);
  return response.json();
};
const deployment = api(`/v13/deployments/${deploymentId}`);
if (deployment.projectId !== project || deployment.target !== 'production' || deployment.readyState !== 'READY' || deployment.source !== 'git' || deployment.meta?.githubCommitSha !== expectedSha || deployment.meta?.githubCommitRef !== 'main' || deployment.meta?.githubRepo !== 'ilha-app' || deployment.meta?.githubOrg !== 'leandrostrelow') throw new Error('A publicação precisa ser um build Git pronto da main do Ilha e do commit aprovado.');
if ((await gh('git/ref/heads/main')).object.sha !== expectedSha) throw new Error('A main mudou; confira e aprove o build mais recente.');
const runs = (await gh(`commits/${expectedSha}/check-runs?per_page=100`)).check_runs;
for (const name of ['Lint, tipos, testes e build', 'Migrations em Postgres real e pgTAP', 'Publicação consistente']) {
  const check = runs.filter(run => run.name === name && run.app?.slug === 'github-actions').sort((a, b) => b.id - a.id)[0];
  if (!check || check.status !== 'completed' || check.conclusion !== 'success') throw new Error(`Verificação pendente ou reprovada: ${name}.`);
}
const temp = await mkdtemp(path.join(os.tmpdir(), 'ilha-promote-'));
const settings = path.join(temp, 'manual.json');
await writeFile(settings, JSON.stringify({ autoAssignCustomDomains: false }));
try {
  // Promotion re-enables auto-assignment on Vercel; always restore manual publication.
  try { vc('promote', deploymentId, '--yes'); }
  finally { vc('api', `/v9/projects/${project}?teamId=${team}`, '--method', 'PATCH', '--input', settings); }
  const alias = api('/v4/aliases/app.ilhatenis.com');
  const config = api(`/v9/projects/${project}`);
  if ((alias.deploymentId || alias.deployment?.id) !== deploymentId || config.autoAssignCustomDomains !== false) throw new Error('A conferência final não passou. Mantenha novas publicações suspensas e confira a Vercel.');
  console.log(`Publicado ${expectedSha.slice(0, 12)} em https://app.ilhatenis.com. Publicação automática permanece desativada.`);
} finally { await rm(temp, { recursive: true, force: true }); }
