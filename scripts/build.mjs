import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { exists, projectRoot } from './project-files.mjs';

const destination = path.join(projectRoot, 'dist');
const siteFiles = JSON.parse(await readFile(path.join(projectRoot, 'config/site-files.json'), 'utf8'));
if (!Array.isArray(siteFiles) || new Set(siteFiles).size !== siteFiles.length) throw new Error('Manifesto de publicação inválido.');
// A deploy from a dirty local directory must not silently replace a reviewed Git release.
if (process.env.VERCEL === '1' && (!/^[a-f0-9]{40}$/.test(process.env.VERCEL_GIT_COMMIT_SHA || '') || process.env.VERCEL_GIT_REPO_SLUG !== 'ilha-app' || process.env.VERCEL_GIT_REPO_OWNER !== 'leandrostrelow')) {
  throw new Error('Publique pelo GitHub conectado ao projeto Ilha. Deploy local sem commit verificado foi bloqueado.');
}

await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });

for (const file of siteFiles) {
  if (typeof file !== 'string' || file.startsWith('/') || file.split('/').some(part => !part || part.startsWith('.')) || /^(?:supabase|test|docs|scripts|config)\//.test(file) || /^(?:package|pnpm-lock|deno)\./.test(file)) throw new Error(`Arquivo não publicável: ${file}`);
  const target = path.join(destination, file);
  await mkdir(path.dirname(target), { recursive: true });
  await cp(path.join(projectRoot, file), target);
}

const versionFile = path.join(destination, 'app-version.json');
const version = JSON.parse(await readFile(versionFile, 'utf8'));
if (!/^\d{4}-\d{2}-\d{2}\.\d{4}$/.test(String(version.version || ''))) {
  throw new Error('app-version.json possui formato de versao invalido.');
}

// Keep lead forms and the administrative module in the same release.
for (const [page, assets] of [['aulas.html', ['aulas.js','aulas.css']], ['adm/index.html', ['adm/leads.js','adm/leads.css','adm/events.js','adm/events.css']], ['eventos/index.html', ['eventos/public.js','eventos/public.css']]]) {
  const file = path.join(destination, page);
  let html = await readFile(file, 'utf8');
  for (const asset of assets) {
    const hash = createHash('sha256').update(await readFile(path.join(destination, asset))).digest('hex').slice(0,16);
    html = html.replaceAll(`/${asset}"`, `/${asset}?v=${hash}"`);
  }
  await writeFile(file, html);
}

// New HTML must never run a previous cached Bet script or stylesheet.
const betHtmlPath = path.join(destination, 'bet/index.html');
let betHtml = await readFile(betHtmlPath, 'utf8');
for (const asset of ['app.js', 'styles.css']) {
  const content = await readFile(path.join(destination, 'bet', asset));
  const hash = createHash('sha256').update(content).digest('hex').slice(0, 16);
  betHtml = betHtml.replaceAll(`/bet/${asset}"`, `/bet/${asset}?v=${hash}"`);
}
await writeFile(betHtmlPath, betHtml);

// Keep the class-first form and its assets in the same release on installed PWAs.
for (const page of ['inscricao-pickleball.html', 'torneios/index.html']) {
  const file = path.join(destination, page);
  let html = await readFile(file, 'utf8');
  for (const asset of ['pickleball-registration.js', 'pickleball.css']) {
    const content = await readFile(path.join(destination, asset));
    const hash = createHash('sha256').update(content).digest('hex').slice(0, 16);
    html = html.replaceAll(`/${asset}"`, `/${asset}?v=${hash}"`);
  }
  await writeFile(file, html);
}

// Ship the exact same simulation used by the server-side score verifier.
await cp(path.join(projectRoot, 'supabase/functions/_shared/ilha-tennis-engine.js'), path.join(destination, 'games/engine.js'));
await cp(path.join(projectRoot, 'supabase/functions/_shared/ilha-tennis-engine-v1.js'), path.join(destination, 'games/ilha-tennis-engine-v1.js'));
const gamesHtmlPath = path.join(destination, 'games/index.html');
let gamesHtml = await readFile(gamesHtmlPath, 'utf8');
// Hash module imports as well as HTML assets to avoid mixed cached releases.
for (const asset of ['ambient-npcs.js', 'club-etiquette.js', 'abandoned-court.js', 'assisted-input.js', 'ilha-tennis-engine-v1.js', 'engine.js', 'scenery-data.js', 'club-scene.js', 'scenery-plants.js', 'scenery-buildings.js', 'game-brand.js', 'visual-style.js', 'scenery-lighting.js', 'scenery-life.js', 'scenery-renderer.js', 'sprite-frames.js', 'match-sprites.js', 'premium-avatars.js', 'characters.js', 'court-view.js', 'match-effects.js', 'render.js', 'world-model.js', 'campaign-props.js', 'club-rain.js', 'world.js', 'adventure.js', 'quick-play.js', 'quick-play-ui.js', 'medals.js', 'legado-story.js', 'campaign-story.js', 'campaign-save.js', 'save-ui.js', 'ending-film.js', 'ending-album.js', 'campaign-ending.js', 'legado-ui.js', 'lesson.js', 'racket-match.js', 'racket-lesson.js', 'lesson-tutorial.js', 'match-input.js', 'racket-renderer.js', 'pickleball-model.js', 'pickleball.js', 'audio.js', 'game-display.js', 'game-install.js', 'telemetry.js']) {
  const content = await readFile(path.join(destination, 'games', asset));
  const hash = createHash('sha256').update(content).digest('hex').slice(0, 16);
  for (const module of ['ambient-npcs.js', 'club-etiquette.js', 'medals.js', 'abandoned-court.js', 'engine.js', 'club-scene.js', 'scenery-plants.js', 'visual-style.js', 'scenery-lighting.js', 'scenery-life.js', 'scenery-renderer.js', 'match-sprites.js', 'premium-avatars.js', 'characters.js', 'court-view.js', 'match-effects.js', 'render.js', 'world-model.js', 'app.js', 'club-rain.js', 'world.js', 'campaign-props.js', 'adventure.js', 'quick-play.js', 'quick-play-ui.js', 'legado-story.js', 'campaign-story.js', 'campaign-save.js', 'save-ui.js', 'ending-film.js', 'ending-album.js', 'campaign-ending.js', 'legado-ui.js', 'lesson.js', 'racket-match.js', 'racket-lesson.js', 'match-input.js', 'racket-renderer.js', 'pickleball-model.js', 'pickleball.js', 'game-install.js']) {
    const modulePath = path.join(destination, 'games', module);
    const content = await readFile(modulePath, 'utf8');
    await writeFile(modulePath, content.replaceAll(`'./${asset}'`, `'./${asset}?v=${hash}'`));
  }
}
for (const asset of ['app.js', 'styles.css', 'world.css', 'tennis.css', 'adventure.css', 'legado.css', 'game-display.css', 'game-install.css', 'arcade-ui.css', 'campaign.css', 'lesson-tutorial.css', 'quick-play.css', 'game-polish.css', 'ending-album.css']) {
  const content = await readFile(path.join(destination, 'games', asset));
  const hash = createHash('sha256').update(content).digest('hex').slice(0, 16);
  gamesHtml = gamesHtml.replaceAll(`/games/${asset}"`, `/games/${asset}?v=${hash}"`);
}
await writeFile(gamesHtmlPath, gamesHtml);

// Halloween starts from an isolated copy of Legado. Same tennis code; new story/save/art.
for (const engine of ['ilha-tennis-engine.js','ilha-tennis-engine-v1.js']) {
  await cp(path.join(projectRoot,'supabase/functions/_shared',engine),path.join(destination,'game2',engine==='ilha-tennis-engine.js'?'engine.js':engine));
}
const halloweenFiles=await readdir(path.join(destination,'game2'));
const game2Version = JSON.parse(await readFile(path.join(projectRoot, 'config/site-release.json'), 'utf8')).game2Version;
for(const module of halloweenFiles.filter(name=>name.endsWith('.js'))){
  const file=path.join(destination,'game2',module);
  const source=await readFile(file,'utf8');
  await writeFile(file,source.replace(/(['"])\.\/([^'"]+\.js)\1/g,(_match,quote,name)=>quote+'./'+name+'?v='+game2Version+quote));
}
const halloweenHtmlPath=path.join(destination,'game2/index.html');
let halloweenHtml=await readFile(halloweenHtmlPath,'utf8');
for(const asset of halloweenFiles.filter(name=>/\.(js|css)$/.test(name))){
  const hash=createHash('sha256').update(await readFile(path.join(destination,'game2',asset))).digest('hex').slice(0,16);
  halloweenHtml=halloweenHtml.replaceAll('/game2/'+asset+'"','/game2/'+asset+'?v='+hash+'"');
}
await writeFile(halloweenHtmlPath,halloweenHtml);

await writeFile(path.join(destination, 'build-meta.json'), JSON.stringify({ version: version.version, timezone: 'America/Sao_Paulo' }, null, 2) + '\n');
console.log(`Build estatico concluido em dist/ (versao ${version.version}).`);
