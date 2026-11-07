// Pone el skill al día con la versión de GitHub antes de cada corrida, sin preguntar.
// Si algo falla, como no tener internet, sigue con la versión instalada: nunca frena el /spy.
// Uso: node actualizar.mjs. Imprime un JSON; si "actualizado" es true, el SKILL.md cambió y hay que releerlo.
import { execFileSync, execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = 'paidbyfacu/spy';
const RAMA = 'main';
const ESTADO = path.join(SKILL, '.actualizacion.json');
// Lo que es de cada usuario y no viene de GitHub: nunca se pisa ni se borra.
const PROPIO = /^(\.git|marcas|scripts[\\/]node_modules|\.actualizacion\.json|\.sin-actualizar)([\\/]|$)/;

const salida = { actualizado: false };
// fin() corta con una excepción y no con process.exit, para que los finally borren la carpeta temporal.
class Listo { constructor(extra) { this.extra = extra; } }
const fin = (extra = {}) => { throw new Listo(extra); };

// Sin ventanas de usuario y contraseña: si GitHub las pidiera, falla callado y sigue.
const git = (...a) => execFileSync('git', ['-C', SKILL, ...a], {
  encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'ignore'],
  env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
}).trim();
const hash = (f) => { try { return crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex'); } catch { return null; } };
const leerJSON = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

// Si cambiaron las dependencias, las vuelve a instalar.
function dependencias(cambiados) {
  if (!cambiados.some((f) => /^scripts[\\/]package(-lock)?\.json$/.test(f))) return;
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  try {
    execSync(`${npm} install --prefix "${path.join(SKILL, 'scripts')}" --no-audit --no-fund --loglevel=error`, { stdio: 'ignore', timeout: 300000 });
    salida.dependencias = 'instaladas';
  } catch {
    salida.dependencias = 'fallaron';
  }
}

// Instalado con git clone: avanza solo si la copia está limpia y atrás de GitHub, así nunca pisa cambios de quien edita el skill.
function conGit() {
  if (git('branch', '--show-current') !== RAMA) fin({ motivo: `no está en ${RAMA}` });
  git('fetch', '--quiet', 'origin', RAMA);
  const local = git('rev-parse', 'HEAD');
  const remoto = git('rev-parse', `origin/${RAMA}`);
  if (local === remoto) fin({ motivo: 'al día' });
  if (git('status', '--porcelain', '--untracked-files=no')) fin({ motivo: 'tiene cambios sin guardar' });
  if (git('merge-base', 'HEAD', remoto) !== local) fin({ motivo: 'tiene commits que no están en GitHub' });
  const cambiados = git('diff', '--name-only', local, remoto).split('\n').filter(Boolean);
  git('merge', '--ff-only', '--quiet', remoto);
  Object.assign(salida, { actualizado: true, desde: local.slice(0, 7), hasta: remoto.slice(0, 7), archivos: cambiados.length });
  dependencias(cambiados);
  fin();
}

function listar(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const abs = path.join(dir, e.name);
    const rel = path.relative(base, abs);
    if (PROPIO.test(rel)) return [];
    return e.isDirectory() ? listar(abs, base) : [rel];
  });
}

// Instalado desde el ZIP, sin git: compara con el último commit de GitHub, baja esa versión y reemplaza solo los archivos que cambiaron.
async function sinGit() {
  const estado = leerJSON(ESTADO) || {};
  const r = await fetch(`https://api.github.com/repos/${REPO}/commits/${RAMA}`, {
    headers: { accept: 'application/vnd.github.sha', 'user-agent': 'spy-skill' },
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) fin({ motivo: `GitHub respondió ${r.status}` });
  const sha = (await r.text()).trim();
  if (!/^[0-9a-f]{40}$/.test(sha)) fin({ motivo: 'GitHub no devolvió la versión' });
  if (sha === estado.sha) fin({ motivo: 'al día' });

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spy-'));
  try {
    const tgz = await fetch(`https://codeload.github.com/${REPO}/tar.gz/${sha}`, { signal: AbortSignal.timeout(60000) });
    if (!tgz.ok) fin({ motivo: `GitHub respondió ${tgz.status}` });
    fs.writeFileSync(path.join(tmp, 'spy.tgz'), Buffer.from(await tgz.arrayBuffer()));
    // En Windows, el tar del sistema; el de Git Bash confunde las rutas con letra de unidad.
    const tarWin = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    const tar = process.platform === 'win32' && fs.existsSync(tarWin) ? tarWin : 'tar';
    execFileSync(tar, ['-xzf', 'spy.tgz'], { cwd: tmp, stdio: 'ignore', timeout: 60000 });
    const nueva = fs.readdirSync(tmp, { withFileTypes: true }).find((e) => e.isDirectory());
    if (!nueva) fin({ motivo: 'no pude abrir la versión nueva' });
    const raiz = path.join(tmp, nueva.name);
    const archivos = listar(raiz);
    if (!archivos.includes('SKILL.md')) fin({ motivo: 'la versión nueva no trae SKILL.md' });

    const cambiados = archivos.filter((f) => hash(path.join(raiz, f)) !== hash(path.join(SKILL, f)));
    for (const f of cambiados) {
      fs.mkdirSync(path.dirname(path.join(SKILL, f)), { recursive: true });
      fs.copyFileSync(path.join(raiz, f), path.join(SKILL, f));
    }
    // Borra solo lo que trajo una actualización anterior y ya no está en GitHub.
    const borrados = (estado.archivos || []).filter((f) => !archivos.includes(f) && !PROPIO.test(f));
    for (const f of borrados) fs.rmSync(path.join(SKILL, f), { force: true });

    fs.writeFileSync(ESTADO, JSON.stringify({ sha, fecha: new Date().toISOString(), archivos }, null, 1));
    if (cambiados.length || borrados.length) {
      Object.assign(salida, { actualizado: true, desde: estado.sha?.slice(0, 7) || 'zip', hasta: sha.slice(0, 7), archivos: cambiados.length + borrados.length });
      dependencias(cambiados);
    }
    fin({ motivo: cambiados.length || borrados.length ? undefined : 'al día' });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

try {
  if (process.env.SPY_SIN_ACTUALIZAR || fs.existsSync(path.join(SKILL, '.sin-actualizar'))) fin({ motivo: 'desactivado' });
  if (fs.existsSync(path.join(SKILL, '.git'))) conGit();
  else await sinGit();
} catch (e) {
  const extra = e instanceof Listo ? e.extra : { motivo: `no se pudo revisar: ${String(e?.message || e).split('\n')[0].slice(0, 120)}` };
  console.log(JSON.stringify({ ...salida, ...extra }));
}
