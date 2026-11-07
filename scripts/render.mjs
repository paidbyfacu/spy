// Arma el informe a partir de lo que bajó scrape.mjs y del análisis que escribe Claude.
//
//   node render.mjs <carpeta> --modo html       → <carpeta>/informe.html, documento completo para abrir o mandar
//   node render.mjs <carpeta> --modo artifact   → <carpeta>/artifact/informe.html, sin esqueleto, para publicar como Artifact
//
// Lee <carpeta>/analisis.json, paginas/*.json, marca.json si existe e img/*.jpg.
// Es una página con cinco vistas: Resumen, Tu marca, Competencia, Anuncios y Qué hacer.
// Cada imagen va embebida una sola vez: las miniaturas copian la de su anuncio con JS.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(process.argv[2] || '.');
const modo = process.argv.includes('--modo') ? process.argv[process.argv.indexOf('--modo') + 1] : 'html';
const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const existe = (f) => fs.existsSync(path.join(dir, f));
const leer = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));

if (!existe('analisis.json')) {
  console.error(`Falta ${path.join(dir, 'analisis.json')}: Claude lo escribe antes de armar el informe.`);
  process.exit(1);
}
const A = leer('analisis.json');
const M = existe('marca.json') ? leer('marca.json') : null;
const todas = existe('paginas') ? fs.readdirSync(path.join(dir, 'paginas')).filter((f) => f.endsWith('.json')).map((f) => leer(`paginas/${f}`)) : [];
const propia = todas.find((p) => p.propia) || null;
// Si el análisis trae `orden`, solo se muestran esos competidores: así Claude descarta los que no son directos.
const orden = (A.orden || []).map(String);
const competidores = orden.length
  ? orden.map((id) => todas.find((p) => !p.propia && p.page_id === id)).filter(Boolean)
  : todas.filter((p) => !p.propia).sort((a, b) => activos(b) - activos(a));
const paginas = [propia, ...competidores].filter(Boolean);
const paisCod = paginas[0]?.pais || M?.pais_probable || 'ALL';

// ---------- utilidades ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const br = (s) => esc(s).replace(/\n/g, '<br>');
const miles = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const num = (n) => (n == null ? 's/d' : miles(n));
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const fechaCorta = (iso, conAnio = true) => { if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${+d} ${MESES[+m - 1]}${conAnio ? ` ${y}` : ''}`; };
const diasTxt = (n) => (n == null ? 's/d' : n === 0 ? 'menos de un día' : n === 1 ? '1 día' : `${miles(n)} días`);
const urlSegura = (u) => (/^https:\/\//.test(u || '') ? esc(u) : '#');
const PAISES = { ALL: 'Todos los países', AR: 'Argentina', MX: 'México', ES: 'España', CO: 'Colombia', CL: 'Chile', PE: 'Perú', UY: 'Uruguay', US: 'Estados Unidos', GB: 'Reino Unido', BR: 'Brasil', EC: 'Ecuador', PY: 'Paraguay', BO: 'Bolivia', VE: 'Venezuela', DE: 'Alemania', FR: 'Francia', IT: 'Italia' };
function activos(p) { return p.activos_total ?? p.stats?.activos_total ?? p.stats?.muestra_activos ?? 0; }
const activosTxt = (p) => (p.activos_total ?? p.stats?.activos_total) != null ? num(p.activos_total ?? p.stats.activos_total) : `${num(p.stats?.muestra_activos || 0)}+`;
const lanzados = (s) => `${num(s.lanzados_7d)}${s.lanzados_7d_es_minimo ? '+' : ''}`;
// "ENFAF - Escuela Nacional de…" pasa a "ENFAF" en chips y tabla; el nombre completo queda en la ficha.
const corto = (n = '') => n.split(/\s+[-|–]\s+|-\s+/)[0].trim() || n;
const nombreDe = (p) => (p.propia ? 'Tu marca' : corto(p.page_name));

const imgCache = {};
function dataUri(rel, base = dir) {
  if (!rel) return null;
  const f = path.isAbsolute(rel) ? rel : path.join(base, rel);
  if (imgCache[f] !== undefined) return imgCache[f];
  if (!fs.existsSync(f)) return (imgCache[f] = null);
  const ext = path.extname(f).slice(1).toLowerCase();
  const mime = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', svg: 'image/svg+xml' }[ext] || 'image/jpeg';
  return (imgCache[f] = `data:${mime};base64,${fs.readFileSync(f).toString('base64')}`);
}
const META = dataUri(path.join(SKILL, 'assets', 'meta.webp'));
const metaLogo = (clase = 'meta-logo') => (META ? `<img class="${clase}" src="${META}" alt="Meta">` : '<strong>Meta</strong>');

const FORMATOS = {
  VIDEO: ['Video', 'video'], DCO_VIDEO: ['Video dinámico', 'video'], DPA_VIDEO: ['Catálogo', 'otro'],
  IMAGE: ['Imagen', 'imagen'], DCO_IMAGEN: ['Imagen dinámica', 'imagen'], DPA_IMAGEN: ['Catálogo', 'otro'],
  CARRUSEL: ['Carrusel', 'carrusel'], MULTI_VIDEOS: ['Varios videos', 'video'], TEXT: ['Texto', 'otro'],
};
const formato = (f) => FORMATOS[f] || [f ? f.toLowerCase().replace(/_/g, ' ') : 'Otro', 'otro'];
const ganchoDe = (t) => (t || '').split(/\n|(?<=[.!?])\s/)[0].slice(0, 160);

function sinRepetir(lista, n) {
  const vistos = new Set();
  const out = [];
  for (const a of lista) {
    // Mismo gancho = mismo anuncio en otro país o con otro recorte: se muestra una vez.
    const k = (ganchoDe(a.texto) || a.id).toLowerCase().slice(0, 50);
    if (vistos.has(k)) continue;
    vistos.add(k);
    out.push(a);
    if (out.length >= n) break;
  }
  return out;
}

// ---------- avatares ----------
const avatarDe = {};
for (const p of paginas) avatarDe[p.page_id] = dataUri(p.avatar);
const avatarMarca = dataUri(M?.instagram?.avatar) || (propia && avatarDe[propia.page_id]) || null;
const nombreMarca = M?.instagram?.nombre || propia?.page_name || A.marca || 'Tu marca';
const tono = (id) => `t${[...String(id)].reduce((a, c) => a + c.charCodeAt(0), 0) % 5}`;
function avatar(nombre, src, id, clase = '') {
  return src
    ? `<span class="av ${clase}"><img src="${src}" alt=""></span>`
    : `<span class="av av-ini ${tono(id || nombre)} ${clase}" aria-hidden="true">${esc((nombre || '?').trim().charAt(0).toUpperCase())}</span>`;
}

// ---------- anuncios de la galería ----------
// Por marca: los ganadores con más puntaje, lo que están probando, lo que apagaron rápido y los de creadores.
// Más todo anuncio que el análisis cite, para que cada miniatura abra su tarjeta.
const ADS = new Map();
const fuente = new Map();
for (const p of paginas) {
  for (const [lista, tipo] of [['ganadores', 'ganador'], ['nuevos', 'nuevo'], ['apagados', 'apagado'], ['creadores', 'creador']]) {
    for (const a of p[lista] || []) if (!fuente.has(a.id)) fuente.set(a.id, { a, p, tipo });
  }
}
function sumar(p, a, tipo) {
  if (!a?.id) return;
  let e = ADS.get(a.id);
  // `scrape.mjs imagenes` baja después las imágenes de los citados: se usan aunque la página no las anote.
  const img = a.img || (existe(`img/${a.id}.jpg`) ? `img/${a.id}.jpg` : null);
  if (!e) ADS.set(a.id, (e = { ...a, img, pid: p.page_id, marca: p.page_name, propia: !!p.propia, tipos: new Set() }));
  e.tipos.add(tipo);
}
for (const p of paginas) {
  sinRepetir([...(p.ganadores || [])].sort((a, b) => (b.puntaje || 0) - (a.puntaje || 0)).filter((a) => a.img), 8).forEach((a) => sumar(p, a, 'ganador'));
  sinRepetir((p.nuevos || []).filter((a) => a.dias <= 14 && a.img), 5).forEach((a) => sumar(p, a, 'nuevo'));
  sinRepetir((p.apagados || []).filter((a) => a.dias <= 7 && a.img), 5).forEach((a) => sumar(p, a, 'apagado'));
  const vistos = new Set();
  (p.creadores || []).filter((a) => a.img && !vistos.has(a.creador) && vistos.add(a.creador)).slice(0, 4).forEach((a) => sumar(p, a, 'creador'));
}
const citados = new Set();
(function recoger(o) {
  if (Array.isArray(o)) return o.forEach(recoger);
  if (!o || typeof o !== 'object') return;
  for (const [k, v] of Object.entries(o)) {
    if ((k === 'anuncios' || k === 'inspirado_en') && Array.isArray(v)) v.forEach((id) => citados.add(String(id)));
    else recoger(v);
  }
})(A);
Object.keys(A.notas || {}).forEach((id) => citados.add(id));
for (const id of citados) {
  if (ADS.has(id) || !fuente.has(id)) continue;
  const { a, p, tipo } = fuente.get(id);
  sumar(p, a, tipo === 'ganador' && a.dias != null && a.dias <= 14 ? 'nuevo' : tipo);
}
// Copias: el mismo gancho subido varias veces por la marca. Sale de resumen.json, que es lo que leyó Claude.
if (existe('resumen.json')) {
  const listas = ['ganadores', 'nuevos', 'apagados_rapido', 'creadores'];
  for (const p of leer('resumen.json').paginas || []) for (const l of listas) for (const g of p[l] || []) {
    if (!(g.copias > 1)) continue;
    for (const id of [g.id, ...(g.otros_ids || [])]) { const e = ADS.get(String(id)); if (e) e.copias = Math.max(e.copias || 0, g.copias); }
  }
}
const galeria = [...ADS.values()].sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999) || (b.dias || 0) - (a.dias || 0));
const porMarca = (pid) => galeria.filter((e) => e.pid === pid).length;

const TIPOS = { ganador: 'Ganador', nuevo: 'Nuevo', apagado: 'Apagado rápido', creador: 'Con creador' };
function notaAuto(e) {
  if (e.tipos.has('apagado')) return `Lo apagaron a los ${diasTxt(e.dias)}, el ${fechaCorta(e.fin)}. Cuando un anuncio dura tan poco, casi siempre es una prueba que no rindió.`;
  if (e.tipos.has('creador')) return `Sale desde la cuenta de ${e.creador || e.page_name}, en partnership con ${e.marca}.`;
  if (e.tipos.has('ganador') && e.rank) return `Es el número ${e.rank} en impresiones de ${e.propia ? 'tu cuenta' : e.marca} y lleva ${diasTxt(e.dias)} activo${e.versiones > 1 ? `, en ${e.versiones} versiones` : ''}.`;
  if (e.tipos.has('nuevo')) return `Salió el ${fechaCorta(e.inicio)}: ${e.propia ? 'lo estás probando' : `${e.marca} lo está probando`} ahora.`;
  return `Lleva ${diasTxt(e.dias)} activo.`;
}

function itemAnuncio(e) {
  const s = dataUri(e.img);
  const [fmt, grupo] = formato(e.formato);
  const nota = (A.notas || {})[e.id];
  const hechos = [];
  if (e.rank && e.estado !== 'apagado') hechos.push(`#${e.rank} en impresiones`);
  hechos.push(e.estado === 'apagado' ? `Duró ${diasTxt(e.dias)}` : `${diasTxt(e.dias)} activo`);
  if (e.inicio) hechos.push(`Desde el ${fechaCorta(e.inicio)}`);
  if (e.copias > 1) hechos.push(`${e.copias} copias`);
  if (e.versiones > 1) hechos.push(`${e.versiones} versiones`);
  hechos.push(fmt);
  const texto = e.texto || '';
  const largo = texto.length > 180 || (texto.match(/\n/g) || []).length > 3;
  const quien = e.page_name || e.marca;
  const av = e.page_id === e.pid || !e.page_id ? avatarDe[e.pid] : null;
  return `<article class="item" id="ad-${esc(e.id)}" data-marca="${esc(e.pid)}" data-tipos="${[...e.tipos].join(' ')}" data-rank="${e.rank ?? 9999}" data-dias="${e.dias ?? 0}" data-inicio="${(e.inicio || '').replace(/-/g, '') || 0}">
  <div class="item-nota">
    <div class="item-top">${[...e.tipos].map((t) => `<span class="tb tb-${t}">${TIPOS[t]}</span>`).join('')}<span class="item-marca">${esc(e.propia ? 'Tu marca' : e.marca)}</span></div>
    <p>${esc(nota || notaAuto(e))}</p>
    <ul class="hechos">${hechos.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>
  </div>
  <div class="fb">
    <header class="fb-head">${avatar(quien, av, e.pid)}<div class="fb-quien"><strong>${esc(quien)}</strong><span>Publicidad${e.creador && quien !== e.marca ? ` · con ${esc(e.marca)}` : ''}</span></div><span class="fb-dots" aria-hidden="true">···</span></header>
    ${texto ? `<div class="fb-texto${largo ? ' largo' : ''}"><p>${br(texto)}</p>${largo ? '<button type="button" class="vermas">Ver más</button>' : ''}</div>` : ''}
    <a class="fb-media fmt-${grupo}" href="${urlSegura(e.biblioteca)}" target="_blank" rel="noopener" aria-label="Abrir el anuncio en la biblioteca">${s ? `<img src="${s}" alt="Creatividad del anuncio de ${esc(quien)}">` : `<span class="fb-vacio">${esc(fmt)}</span>`}${grupo === 'video' ? '<span class="play" aria-hidden="true"></span>' : ''}${grupo === 'carrusel' ? '<span class="fmt-tag">Carrusel</span>' : ''}</a>
    ${e.titulo || e.cta ? `<div class="fb-link"><div class="fb-link-txt">${e.dominio ? `<span class="dom">${esc(e.dominio.toUpperCase())}</span>` : ''}${e.titulo ? `<strong>${esc(e.titulo)}</strong>` : ''}${e.descripcion ? `<span class="desc">${esc(e.descripcion)}</span>` : ''}</div>${e.cta ? `<span class="fb-cta">${esc(e.cta)}</span>` : ''}</div>` : ''}
  </div>
  <footer class="item-pie"><span>ID ${esc(e.id)}</span><a href="${urlSegura(e.biblioteca)}" target="_blank" rel="noopener">Ver en la biblioteca ↗</a></footer>
</article>`;
}

// Miniatura que abre la tarjeta del anuncio en una ventana. La imagen la copia el script.
function miniaturas(ids = []) {
  const ok = ids.map(String).filter((id) => ADS.has(id)).slice(0, 5);
  if (!ok.length) return '';
  return `<div class="minis">${ok.map((id) => {
    const e = ADS.get(id);
    return `<button type="button" class="mini" data-ad="${esc(id)}" title="${esc(ganchoDe(e.texto) || e.titulo || 'Ver anuncio')}"><img data-de="${esc(id)}" alt=""><span class="mini-fmt">${esc(formato(e.formato)[0])}</span><em>${e.dias ?? '?'} d</em></button>`;
  }).join('')}</div>`;
}

function puntos(items = [], clase = '') {
  if (!items.length) return '';
  return `<ul class="puntos ${clase}">${items.map((it) => {
    const t = typeof it === 'string' ? { texto: it } : it;
    return `<li><p>${esc(t.texto)}</p>${miniaturas(t.anuncios)}</li>`;
  }).join('')}</ul>`;
}

function barraFormatos(f = {}) {
  const grupos = {};
  for (const [k, v] of Object.entries(f)) { const g = formato(k)[1]; grupos[g] = (grupos[g] || 0) + v; }
  const total = Object.values(grupos).reduce((a, b) => a + b, 0) || 1;
  const nombres = { video: 'Video', imagen: 'Imagen', carrusel: 'Carrusel', otro: 'Otro' };
  const partes = ['video', 'imagen', 'carrusel', 'otro'].filter((g) => grupos[g]);
  if (!partes.length) return '<span class="tenue">Sin datos</span>';
  const pct = (g) => Math.round((100 * grupos[g]) / total);
  return `<div class="fbar crece" role="img" aria-label="${partes.map((g) => `${nombres[g]} ${pct(g)}%`).join(', ')}">${partes.map((g) => `<span class="seg f-${g}" style="flex-grow:${grupos[g]}"></span>`).join('')}</div>
  <p class="fbar-ley">${partes.map((g) => `<span><i class="dot f-${g}"></i>${nombres[g]} ${pct(g)}%</span>`).join('')}</p>`;
}

// Meta solo muestra los apagados más recientes, y nada fuera de Europa: es una muestra, no el total.
const apagadosRapido = (p) => ((p.apagados || []).length ? `${p.stats.apagados_en_7_dias} de ${p.apagados.length}` : 'Sin datos');
const ctaPrincipal = (s) => Object.entries(s.ctas || {}).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
const destinoPrincipal = (s) => Object.entries(s.dominios || {}).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
const verAnuncios = (p, texto, clase = 'btn') => (porMarca(p.page_id) ? `<a class="${clase}" href="#anuncios" data-marca="${esc(p.page_id)}">${esc(texto)}</a>` : '');
const enBiblioteca = (p) => `https://www.facebook.com/ads/library/?active_status=active&amp;ad_type=all&amp;country=${esc(p.pais || paisCod)}&amp;search_type=page&amp;view_all_page_id=${esc(p.page_id)}`;

// ---------- vista: resumen ----------
const fecha = new Date().toISOString().slice(0, 10);
const totalActivos = competidores.reduce((a, p) => a + activos(p), 0);
const algunoSinTotal = competidores.some((p) => (p.activos_total ?? p.stats?.activos_total) == null);
const lanzadosComp = competidores.reduce((a, p) => a + (p.stats?.lanzados_7d || 0), 0);
const tituloCorto = A.titulo_corto || `Espía de anuncios ${competidores[0]?.page_name || ''}`.trim();

function vistaResumen() {
  const kpis = [
    [competidores.length, '', competidores.length === 1 ? 'competidor analizado' : 'competidores analizados'],
    [totalActivos, algunoSinTotal ? '+' : '', 'anuncios activos de la competencia'],
    [lanzadosComp, '', 'anuncios nuevos de la competencia en 7 días'],
  ];
  if (propia) kpis.push([activos(propia), '', 'anuncios activos tuyos']);
  else kpis.push([galeria.length, '', 'anuncios para mirar en detalle']);
  const max = Math.max(1, ...paginas.map(activos));
  const conCreadores = paginas.some((p) => p.stats?.anuncios_de_creadores);
  const filas = paginas.map((p) => {
    const s = p.stats || {};
    return `<tr${p.propia ? ' class="propia"' : ''}>
  <th scope="row"><a class="t-marca" href="#${p.propia ? 'marca' : 'competencia'}" data-a="${p.propia ? '' : `comp-${esc(p.page_id)}`}">${avatar(p.page_name, avatarDe[p.page_id], p.page_id, 'av-s')}<span title="${esc(p.page_name)}">${esc(corto(p.page_name))}${p.propia ? '<em>Tu marca</em>' : ''}</span></a></th>
  <td class="t-activos"><span class="t-num">${activosTxt(p)}</span><span class="t-barra"><i class="crece" style="--k:${(activos(p) / max).toFixed(3)}"></i></span></td>
  <td>${lanzados(s)}</td>
  <td>${num(s.mediana_dias_activos)}</td>
  <td>${num(s.pct_mas_de_30_dias)}%</td>
  <td>${apagadosRapido(p)}</td>
  ${conCreadores ? `<td>${num(s.anuncios_de_creadores)}</td>` : ''}
  <td class="t-fmt">${barraFormatos(s.formatos)}</td>
  <td class="t-ver">${verAnuncios(p, 'Ver anuncios', 'btn-chico')}</td>
</tr>`;
  }).join('');
  const hallazgos = (A.veredicto || []).map((v, i, arr) => {
    const ultima = i === arr.length - 1 && arr.length > 1;
    return `<article class="hallazgo rv${ultima ? ' clave' : ''}"><span class="hn">${ultima ? 'Acción número uno' : String(i + 1).padStart(2, '0')}</span><p>${esc(v)}</p>${ultima ? '<a class="btn btn-blanco" href="#plan">Ver qué hacer</a>' : ''}</article>`;
  }).join('');
  return `<section class="vista" id="v-resumen">
  <div class="hero"><div class="wrap">
    <p class="fuente-linea">${metaLogo('meta-chico')}<span>Biblioteca de anuncios</span><span class="sep"></span><span>${esc(PAISES[paisCod] || paisCod)}</span><span class="sep"></span><span>${fechaCorta(fecha)}</span></p>
    <h1>${esc(A.titulo || tituloCorto)}</h1>
    ${A.bajada ? `<p class="bajada">${esc(A.bajada)}</p>` : ''}
    <div class="hero-kpis">${kpis.map(([n, suf, t]) => `<div class="hk rv"><strong data-n="${n}" data-suf="${suf}">${miles(n)}${suf}</strong><span>${esc(t)}</span></div>`).join('')}</div>
    <div class="acciones"><a class="btn" href="#anuncios">Ver los anuncios</a><a class="btn-sec" href="#plan">Qué hacer en tu cuenta</a></div>
  </div></div>
  ${hallazgos ? `<div class="sec"><div class="wrap">
    <div class="sec-head"><h2>${esc(A.titulo_veredicto || 'Lo más importante')}</h2></div>
    <div class="hallazgos h${Math.min((A.veredicto || []).length - 1, 4)}">${hallazgos}</div>
  </div></div>` : ''}
  <div class="sec sec-gris"><div class="wrap">
    <div class="sec-head"><h2>Cómo anuncia cada marca</h2><p>Anuncios activos hoy, cuántos lanzaron en la última semana y cuánto los dejan correr.</p></div>
    <div class="tabla-wrap rv"><table class="mercado">
      <thead><tr><th scope="col">Marca</th><th scope="col">Anuncios activos</th><th scope="col">Nuevos en 7 días</th><th scope="col">Mediana de días</th><th scope="col">Con más de 30 días</th><th scope="col">Apagados en 7 días o menos</th>${conCreadores ? '<th scope="col">Creadores</th>' : ''}<th scope="col">Formatos</th><th scope="col"><span class="sr">Acciones</span></th></tr></thead>
      <tbody>${filas}</tbody>
    </table></div>
  </div></div>
  ${A.patrones?.length ? `<div class="sec"><div class="wrap">
    <div class="sec-head"><h2>Lo que se repite en el mercado</h2><p>Ideas que aparecen en más de una marca. Toca una miniatura para ver el anuncio.</p></div>
    <div class="patrones">${A.patrones.map((p, i) => `<article class="patron rv"><span class="pn">${String(i + 1).padStart(2, '0')}</span><h3>${esc(p.titulo)}</h3><p>${esc(p.detalle)}</p>${miniaturas(p.anuncios)}</article>`).join('')}</div>
  </div></div>` : ''}
</section>`;
}

// ---------- vista: tu marca ----------
function vistaMarca() {
  const ig = M?.instagram;
  const web = M?.web;
  const L = A.marca_leida || {};
  if (!ig && !web && !propia && !A.marca_leida) return '';
  const s = propia?.stats || {};
  const perfil = ig?.completo || ig?.nombre ? `<div class="perfil rv">
    <div class="perfil-top">${avatar(ig.nombre || ig.usuario, avatarMarca, ig.usuario, 'av-l')}<div class="perfil-id"><h3>${esc(ig.nombre || ig.usuario)}${ig.verificada ? '<span class="verif" title="Cuenta verificada" aria-label="Cuenta verificada"></span>' : ''}</h3><a href="${urlSegura(ig.url)}" target="_blank" rel="noopener">@${esc(ig.usuario)}</a></div></div>
    <dl class="perfil-nums"><div><dt>Seguidores</dt><dd data-n="${ig.seguidores || 0}">${num(ig.seguidores)}</dd></div><div><dt>Seguidos</dt><dd>${num(ig.seguidos)}</dd></div>${propia ? `<div><dt>Anuncios activos</dt><dd>${activosTxt(propia)}</dd></div>` : ''}</dl>
    ${ig.bio ? `<p class="bio">${br(ig.bio)}</p>` : ''}
  </div>` : '';
  const captura = dataUri(web?.captura);
  const dominio = (() => { try { return new URL(web.url).hostname.replace(/^www\./, ''); } catch { return ''; } })();
  const sitio = web ? `<div class="navegador rv">
    <div class="nav-barra"><i></i><i></i><i></i><span>${esc(dominio)}</span></div>
    ${captura ? `<a href="${urlSegura(web.url)}" target="_blank" rel="noopener"><img src="${captura}" alt="Portada de ${esc(dominio)}"></a>` : ''}
  </div>` : '';
  const seg = web?.seguimiento || {};
  const whatsapp = (web?.redes || []).some((r) => /whatsapp|wa\.me/.test(r));
  const detectado = web ? `<div class="detectado rv">
    <h3>Lo que vimos en tu web</h3>
    <ul class="checks">
      <li class="${seg.pixel_meta ? 'si' : 'no'}">Píxel de Meta${seg.pixel_meta ? ' instalado' : ': no lo encontramos'}</li>
      <li class="${seg.google ? 'si' : 'no'}">Google Analytics o Tag Manager${seg.google ? '' : ': no aparece'}</li>
      <li class="${seg.tiktok ? 'si' : 'no'}">Píxel de TikTok${seg.tiktok ? '' : ': no aparece'}</li>
      <li class="${whatsapp ? 'si' : 'no'}">${whatsapp ? 'Botón de WhatsApp' : 'Sin botón de WhatsApp'}</li>
    </ul>
    ${web.precios?.length ? `<p class="mini-tit">Precios en la web</p><div class="pastillas">${web.precios.slice(0, 8).map((p) => `<span>${esc(p)}</span>`).join('')}</div>` : ''}
    ${web.plataforma?.length ? `<p class="mini-tit">Hecha con</p><div class="pastillas">${web.plataforma.map((p) => `<span>${esc(p.charAt(0).toUpperCase() + p.slice(1))}</span>`).join('')}</div>` : ''}
  </div>` : '';
  const ficha = [['Qué vende', L.producto], ['Oferta', L.oferta], ['Precio', L.precio], ['A quién', L.publico], ['Cómo habla', L.tono], ['Objetivo de los anuncios', L.objetivo], ['Presupuesto mensual', L.presupuesto]].filter(([, v]) => v);
  const supuestos = (L.supuestos || []).filter(Boolean);
  const lectura = A.marca_leida ? `<div class="marca-lectura">
    ${L.resumen ? `<p class="lede rv">${esc(L.resumen)}</p>` : ''}
    ${ficha.length ? `<dl class="ficha rv">${ficha.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : ''}
    ${supuestos.length ? `<p class="supuestos rv"><strong>Lo que supusimos sin que lo confirmes:</strong> ${supuestos.map((s) => esc(s.trim().replace(/\.?$/, '.'))).join(' ')}</p>` : ''}
    ${L.fortalezas?.length || L.huecos?.length ? `<div class="dos-col">
      ${L.fortalezas?.length ? `<div class="col-lista si rv"><h3>A tu favor</h3>${puntos(L.fortalezas, 'si')}</div>` : ''}
      ${L.huecos?.length ? `<div class="col-lista no rv"><h3>Lo que falta</h3>${puntos(L.huecos, 'no')}</div>` : ''}
    </div>` : ''}
  </div>` : '';
  const enMeta = propia ? `<div class="en-meta rv">
    <div class="en-meta-top">${metaLogo('meta-chico')}<h3>Tus anuncios en Meta</h3></div>
    <dl class="kpis">
      <div><dt>Activos</dt><dd>${activosTxt(propia)}</dd></div>
      <div><dt>Nuevos en 7 días</dt><dd>${lanzados(s)}</dd></div>
      <div><dt>Mediana de días activo</dt><dd>${num(s.mediana_dias_activos)}</dd></div>
      <div><dt>Activos hace más de 30 días</dt><dd>${num(s.pct_mas_de_30_dias)}%</dd></div>
      ${ctaPrincipal(s) ? `<div><dt>Botón más usado</dt><dd class="dd-txt">${esc(ctaPrincipal(s))}</dd></div>` : ''}
      ${destinoPrincipal(s) ? `<div><dt>A dónde manda</dt><dd class="dd-txt">${esc(destinoPrincipal(s))}</dd></div>` : ''}
    </dl>
    ${barraFormatos(s.formatos)}
    <div class="acciones">${verAnuncios(propia, `Ver tus anuncios`)}<a class="btn-sec" href="${enBiblioteca(propia)}" target="_blank" rel="noopener">Abrir en la biblioteca ↗</a></div>
  </div>` : M ? `<div class="en-meta rv"><div class="en-meta-top">${metaLogo('meta-chico')}<h3>Tus anuncios en Meta</h3></div><p>No encontramos anuncios activos de tu marca en la biblioteca de ${esc(PAISES[paisCod] || paisCod)}.</p></div>` : '';
  const posts = (ig?.posts || []).filter((p) => p.img).slice(0, 9);
  const TIPO_POST = { reel: 'Reel', carrusel: 'Carrusel', foto: 'Foto', video: 'Video' };
  const grillaPosts = posts.length ? `<div class="sec-head"><h2>Lo último que publicaste</h2><p>Tus ${posts.length} publicaciones más recientes en Instagram.</p></div>
    <div class="posts">${posts.map((p) => `<figure class="post rv"><div class="post-img"><img src="${dataUri(p.img)}" alt=""><span class="post-tipo">${TIPO_POST[p.tipo] || 'Post'}</span>${p.fijado ? '<span class="post-fijo">Fijado</span>' : ''}</div><figcaption>${esc(ganchoDe(p.texto))}</figcaption></figure>`).join('')}</div>` : '';
  return `<section class="vista" id="v-marca" hidden>
  <div class="sec"><div class="wrap">
    <div class="sec-head"><h2>${esc(nombreMarca)}</h2><p>Lo que se ve de tu marca desde afuera: Instagram, web y anuncios activos${M?.nicho ? `, en el nicho ${esc(M.nicho)}` : ''}.</p></div>
    <div class="marca-grid">${perfil}${sitio}</div>
    ${lectura}
    <div class="marca-grid">${enMeta}${detectado}</div>
  </div></div>
  ${grillaPosts ? `<div class="sec sec-gris"><div class="wrap">${grillaPosts}</div></div>` : ''}
</section>`;
}

// ---------- vista: competencia ----------
function tarjetaCompetidor(p) {
  const s = p.stats || {};
  const an = (A.competidores || {})[p.page_id] || {};
  const seguidores = [...(p.ganadores || []), ...(p.nuevos || [])].find((a) => a.seguidores)?.seguidores;
  const kpis = [
    ['Activos', activosTxt(p)],
    ['Nuevos en 7 días', lanzados(s)],
    ['Mediana de días activo', num(s.mediana_dias_activos)],
    ['Más de 30 días', `${num(s.pct_mas_de_30_dias)}%`],
    ['Apagados en 7 días o menos', apagadosRapido(p)],
  ];
  if (s.anuncios_de_creadores) kpis.push(['Con creadores', num(s.anuncios_de_creadores)]);
  if (ctaPrincipal(s)) kpis.push(['Botón más usado', ctaPrincipal(s)]);
  return `<article class="comp rv" id="comp-${esc(p.page_id)}">
  <header class="comp-head">
    ${avatar(p.page_name, avatarDe[p.page_id], p.page_id, 'av-m')}
    <div class="comp-id"><h3>${esc(p.page_name)}</h3><p>${seguidores ? `${num(seguidores)} seguidores en Facebook` : 'Página de Facebook'}${destinoPrincipal(s) ? ` · manda a ${esc(destinoPrincipal(s))}` : ''}</p></div>
    <div class="comp-acc">${verAnuncios(p, `Ver sus ${porMarca(p.page_id)} anuncios`)}<a class="btn-sec" href="${enBiblioteca(p)}" target="_blank" rel="noopener">Biblioteca ↗</a></div>
  </header>
  ${an.resumen ? `<p class="comp-res">${esc(an.resumen)}</p>` : ''}
  <dl class="kpis">${kpis.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd${String(v).length > 9 ? ' class="dd-txt"' : ''}>${esc(v)}</dd></div>`).join('')}</dl>
  ${an.funciona?.length || an.no_funciona?.length ? `<div class="dos-col">
    ${an.funciona?.length ? `<div class="col-lista si"><h4>Le funciona</h4>${puntos(an.funciona, 'si')}</div>` : ''}
    ${an.no_funciona?.length ? `<div class="col-lista no"><h4>Probó y no le funcionó</h4>${puntos(an.no_funciona, 'no')}</div>` : ''}
  </div>` : ''}
  <div class="comp-fmt"><span class="mini-tit">Formatos</span>${barraFormatos(s.formatos)}</div>
</article>`;
}

function vistaCompetencia() {
  return `<section class="vista" id="v-competencia" hidden>
  <div class="sec"><div class="wrap">
    <div class="sec-head"><h2>Competencia</h2><p>Qué le funciona a cada marca, qué probó y apagó, y cómo reparte sus formatos.</p></div>
    <nav class="saltos" aria-label="Competidores">${competidores.map((p) => `<a href="#competencia" data-a="comp-${esc(p.page_id)}">${avatar(p.page_name, avatarDe[p.page_id], p.page_id, 'av-xs')}${esc(corto(p.page_name))}</a>`).join('')}</nav>
    <div class="comps">${competidores.map(tarjetaCompetidor).join('')}</div>
  </div></div>
</section>`;
}

// ---------- vista: anuncios ----------
function vistaAnuncios() {
  const marcas = paginas.filter((p) => porMarca(p.page_id));
  const cuenta = (t) => galeria.filter((e) => e.tipos.has(t)).length;
  return `<section class="vista" id="v-anuncios" hidden>
  <div class="sec"><div class="wrap">
    <div class="sec-head"><h2>Anuncios</h2><p>Los que más impresiones tienen, los que están probando ahora y los que apagaron rápido. Arriba de cada anuncio, por qué importa.</p></div>
    <div class="filtros">
      <div class="chips" role="group" aria-label="Marca">
        <button type="button" class="chip" data-f-marca="todas" aria-pressed="true">Todas<span>${galeria.length}</span></button>
        ${marcas.map((p) => `<button type="button" class="chip" data-f-marca="${esc(p.page_id)}" aria-pressed="false">${avatar(p.page_name, avatarDe[p.page_id], p.page_id, 'av-xs')}${esc(nombreDe(p))}<span>${porMarca(p.page_id)}</span></button>`).join('')}
      </div>
      <div class="filtros-2">
        <div class="segmento" role="group" aria-label="Tipo">
          <button type="button" data-f-tipo="todos" aria-pressed="true">Todos</button>
          ${Object.entries(TIPOS).filter(([t]) => cuenta(t)).map(([t, n]) => `<button type="button" data-f-tipo="${t}" aria-pressed="false">${n}</button>`).join('')}
        </div>
        <label class="orden">Ordenar por <select id="orden"><option value="impresiones">Más impresiones</option><option value="dias">Más días activo</option><option value="recientes">Más recientes</option></select></label>
      </div>
      <p class="cuenta" id="cuenta" aria-live="polite">${galeria.length} anuncios</p>
    </div>
    <div class="feed" id="feed">${galeria.map(itemAnuncio).join('\n')}</div>
    <p class="vacio" id="vacio" hidden>No hay anuncios de este tipo para esta marca.</p>
    <div class="mas-wrap"><button type="button" class="btn-sec" id="mas">Mostrar más anuncios</button></div>
  </div></div>
</section>`;
}

// ---------- vista: qué hacer ----------
function mockConcepto(c) {
  const f = (c.formato || '').toLowerCase();
  const vertical = /9:16|vertical|reel|story|historia/.test(f);
  const carrusel = /carrusel/.test(f);
  // El gancho va en la creatividad, como se vería en el anuncio; el texto principal, completo arriba.
  const copy = c.copy || c.gancho || '';
  const dom = (() => { try { return new URL(M.web.url).hostname.replace(/^www\./, '').toUpperCase(); } catch { return ''; } })();
  return `<div class="fb fb-mock">
    <header class="fb-head">${avatar(nombreMarca, avatarMarca, 'propia')}<div class="fb-quien"><strong>${esc(nombreMarca)}</strong><span>Publicidad</span></div><span class="fb-dots" aria-hidden="true">···</span></header>
    ${copy ? `<div class="fb-texto"><p>${br(copy)}</p></div>` : ''}
    <div class="fb-media idea${vertical ? ' vertical' : ''}"><div class="idea-in"><span class="idea-fmt">Creatividad sugerida</span>${c.gancho ? `<strong class="idea-gancho">${esc(c.gancho)}</strong>` : ''}${c.visual ? `<p>${esc(c.visual)}</p>` : ''}${carrusel ? '<span class="idea-dots"><i></i><i></i><i></i><i></i></span>' : ''}</div></div>
    ${c.titulo || c.cta ? `<div class="fb-link"><div class="fb-link-txt">${dom ? `<span class="dom">${esc(dom)}</span>` : ''}${c.titulo ? `<strong>${esc(c.titulo)}</strong>` : ''}</div>${c.cta ? `<span class="fb-cta">${esc(c.cta)}</span>` : ''}</div>` : ''}
  </div>`;
}

function vistaPlan() {
  const T = A.tu_marca;
  if (!T) return '';
  const conceptos = (T.anuncios || []).map((c, i) => {
    const plano = (s) => (s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const ganchoAparte = c.gancho && !plano(c.copy).startsWith(plano(c.gancho).slice(0, 24));
    const copia = [ganchoAparte ? `Gancho: ${c.gancho}` : '', c.copy || c.gancho, c.titulo ? `Título: ${c.titulo}` : '', c.cta ? `Botón: ${c.cta}` : ''].filter(Boolean).join('\n\n');
    return `<article class="concepto rv">
  ${mockConcepto(c)}
  <div class="concepto-info">
    <span class="cn">Anuncio ${i + 1}</span>
    <h3>${esc(c.concepto)}</h3>
    ${c.formato ? `<p class="concepto-fmt">${esc(c.formato)}</p>` : ''}
    ${c.por_que ? `<p>${esc(c.por_que)}</p>` : ''}
    ${c.inspirado_en?.length ? `<p class="mini-tit">Inspirado en</p>${miniaturas(c.inspirado_en)}` : ''}
    <button class="btn copiar" type="button" data-copia="${esc(copia)}">Copiar texto</button>
    <textarea class="copia-oculta" readonly tabindex="-1" aria-hidden="true">${esc(copia)}</textarea>
  </div>
</article>`;
  }).join('');
  return `<section class="vista" id="v-plan" hidden>
  <div class="sec"><div class="wrap">
    <div class="sec-head"><h2>Qué hacer en tu cuenta</h2>${T.diagnostico ? `<p class="lede">${esc(T.diagnostico)}</p>` : ''}</div>
    ${T.cuenta?.length ? `<h3 class="h-sub">En la cuenta publicitaria</h3><ol class="pasos-cuenta">${T.cuenta.map((it) => { const t = typeof it === 'string' ? { texto: it } : it; return `<li class="rv"><p>${esc(t.texto)}</p>${miniaturas(t.anuncios)}</li>`; }).join('')}</ol>` : ''}
  </div></div>
  ${conceptos ? `<div class="sec sec-gris"><div class="wrap">
    <div class="sec-head"><h2>Anuncios para lanzar</h2><p>Escritos para ${esc(nombreMarca)} a partir de lo que le funciona a la competencia. Copia el texto y adáptalo a tu creatividad.</p></div>
    <div class="conceptos">${conceptos}</div>
  </div></div>` : ''}
  ${T.plan?.length ? `<div class="sec"><div class="wrap">
    <div class="sec-head"><h2>Plan de prueba</h2></div>
    <ol class="timeline">${T.plan.map((p) => `<li class="rv"><strong>${esc(p.paso)}</strong>${p.detalle ? `<span>${esc(p.detalle)}</span>` : ''}</li>`).join('')}</ol>
  </div></div>` : ''}
</section>`;
}

// ---------- página ----------
const vistas = [
  ['resumen', 'Resumen', vistaResumen()],
  ['marca', 'Tu marca', vistaMarca()],
  ['competencia', 'Competencia', competidores.length ? vistaCompetencia() : ''],
  ['anuncios', 'Anuncios', galeria.length ? vistaAnuncios() : ''],
  ['plan', 'Qué hacer', vistaPlan()],
].filter(([, , html]) => html);

const CSS = `
/* Un solo tema claro, a propósito: fondo blanco y azules de Meta.
   Layout: barra fija con pestañas; cada pestaña es una vista con bandas blancas y gris azuladas. */
:root {
  color-scheme: light;
  --bg: #ffffff; --bg-2: #f3f6fa; --bg-3: #e9eff7; --barra: rgba(255, 255, 255, .9);
  --ink: #0f1d2a; --ink-2: #33475a; --muted: #627385; --line: #e1e7ef; --line-2: #c9d4e1;
  --blue: #0064e0; --blue-2: #0866ff; --blue-3: #0081fb; --blue-soft: #eaf2ff; --blue-ink: #0a3f91;
  --good: #0d7a47; --good-soft: #e6f5ed; --bad: #c4382e; --bad-soft: #fdeeec;
  --teal: #08799a; --teal-soft: #e3f5fa; --violet: #5a3fd6; --violet-soft: #efebff;
  --fb-gray: #e4e6eb; --fb-ink: #050505; --fb-muted: #65676b; --fb-bg: #f0f2f5;
  --f-video: #0064e0; --f-imagen: #19b3d3; --f-carrusel: #7b5cff; --f-otro: #a4b1c0;
  --on-blue: #ffffff; --velo: rgba(10, 22, 40, .55); --sombra-c: rgba(16, 42, 84, .07); --sombra-f: rgba(16, 42, 84, .14);
  --grad: linear-gradient(115deg, #0064e0 0%, #0081fb 48%, #2bb4ff 100%);
  --grad-idea: linear-gradient(150deg, #0a3f91 0%, #0064e0 45%, #0081fb 80%, #4fc3ff 100%);
  --font: "Figtree", "Segoe UI", system-ui, -apple-system, sans-serif;
  --r: 18px;
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body { background: var(--bg); color: var(--ink); font: 400 16px/1.55 var(--font); -webkit-font-smoothing: antialiased; }
body::before { content: ""; position: fixed; inset: 0 0 auto; height: env(safe-area-inset-top, 0px); background: var(--bg); z-index: 40; }
a { color: var(--blue); }
a:focus-visible, button:focus-visible, select:focus-visible { outline: 2px solid var(--blue-2); outline-offset: 3px; border-radius: 8px; }
img { max-width: 100%; }
h1, h2, h3, h4 { margin: 0; text-wrap: balance; }
p, dl, dd, figure { margin: 0; }
.wrap { max-width: 1160px; margin: 0 auto; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
.tenue { color: var(--muted); font-size: .85rem; }

/* barra */
.barra { position: sticky; top: env(safe-area-inset-top, 0px); z-index: 30; background: var(--barra); backdrop-filter: saturate(1.6) blur(14px); -webkit-backdrop-filter: saturate(1.6) blur(14px); border-bottom: 1px solid var(--line); }
.barra-in { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 12px 24px; min-height: 62px; }
.logo { display: inline-flex; align-items: baseline; gap: 10px; text-decoration: none; color: var(--ink); min-width: 0; }
.logo b { font-weight: 800; font-size: 1.12rem; letter-spacing: -.02em; }
.logo b i { font-style: normal; color: var(--blue); }
.logo span { color: var(--muted); font-size: .88rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tabs { display: flex; gap: 2px; overflow-x: auto; scrollbar-width: none; justify-self: center; max-width: 100%; }
.tabs::-webkit-scrollbar { display: none; }
.tab { position: relative; flex: none; text-decoration: none; color: var(--ink-2); font-weight: 600; font-size: .93rem; padding: 9px 14px; border-radius: 10px; }
.tab:hover { background: var(--bg-2); color: var(--ink); }
.tab[aria-current="page"] { color: var(--blue); }
.tab::after { content: ""; position: absolute; left: 14px; right: 14px; bottom: -11px; height: 3px; border-radius: 3px 3px 0 0; background: var(--blue); transform: scaleX(0); transition: transform .25s ease; }
.tab[aria-current="page"]::after { transform: scaleX(1); }
.fuente { display: inline-flex; align-items: center; gap: 8px; color: var(--muted); font-size: .78rem; white-space: nowrap; }
.meta-logo { height: 16px; width: auto; display: block; }
.meta-chico { height: 14px; width: auto; display: block; }

/* bandas y títulos */
.sec { padding-block: 48px; }
.sec-gris { background: var(--bg-2); border-block: 1px solid var(--line); }
.sec .wrap, .hero .wrap { display: grid; grid-template-columns: minmax(0, 1fr); gap: 26px; }
.sec-head { display: grid; gap: 8px; max-width: 760px; }
.sec-head p { color: var(--muted); font-size: 1.02rem; }
h1 { font-size: clamp(2.1rem, 5.2vw, 3.6rem); line-height: 1.04; letter-spacing: -.035em; font-weight: 800; max-width: 18ch; }
h2 { font-size: clamp(1.55rem, 3.2vw, 2.15rem); line-height: 1.12; letter-spacing: -.025em; font-weight: 800; }
h3 { font-size: 1.12rem; font-weight: 700; letter-spacing: -.01em; }
h4 { font-size: 1rem; font-weight: 700; }
.h-sub { font-size: 1.2rem; margin-top: 6px; }
.lede { font-size: 1.15rem; color: var(--ink-2); max-width: 70ch; }
.mini-tit { font-size: .8rem; font-weight: 700; color: var(--muted); letter-spacing: .02em; }

/* botones */
.acciones { display: flex; flex-wrap: wrap; gap: 10px; }
.btn, .btn-sec, .btn-chico { display: inline-flex; align-items: center; justify-content: center; gap: 8px; text-decoration: none; font: 700 .95rem/1 var(--font); border-radius: 999px; padding: 13px 20px; cursor: pointer; border: 1px solid transparent; transition: transform .15s ease, background-color .15s ease, border-color .15s ease, box-shadow .15s ease; }
.btn { background: var(--blue); color: var(--on-blue); box-shadow: 0 6px 16px -6px var(--blue); }
.btn:hover { background: var(--blue-2); transform: translateY(-1px); }
.btn-sec { background: var(--bg); color: var(--ink); border-color: var(--line-2); }
.btn-sec:hover { border-color: var(--blue); color: var(--blue); }
.btn-chico { background: var(--blue-soft); color: var(--blue); padding: 8px 14px; font-size: .85rem; white-space: nowrap; }
.btn-chico:hover { background: var(--blue); color: var(--on-blue); }
.btn-blanco { background: var(--bg); color: var(--blue); box-shadow: none; justify-self: start; }
.btn-blanco:hover { background: var(--bg); color: var(--blue-ink); }

/* resumen */
.hero { position: relative; overflow: hidden; padding-block: 64px 52px; }
.hero::before { content: ""; position: absolute; width: 760px; height: 760px; right: -220px; top: -380px; border-radius: 50%; background: radial-gradient(circle at 35% 40%, rgba(0, 129, 251, .2), transparent 58%), radial-gradient(circle at 68% 62%, rgba(0, 100, 224, .14), transparent 60%); pointer-events: none; }
.hero .wrap { position: relative; display: grid; gap: 22px; }
.fuente-linea { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; justify-self: start; padding: 7px 14px; border: 1px solid var(--line); border-radius: 999px; background: var(--bg); font-size: .85rem; color: var(--ink-2); font-weight: 500; }
.fuente-linea .sep { width: 4px; height: 4px; border-radius: 50%; background: var(--line-2); }
.bajada { font-size: clamp(1.05rem, 2vw, 1.25rem); color: var(--ink-2); max-width: 60ch; }
.hero-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; margin-top: 6px; }
.hk { background: var(--bg); border: 1px solid var(--line); border-radius: var(--r); padding: 18px 20px; display: grid; gap: 4px; box-shadow: 0 1px 2px var(--sombra-c); }
.hk strong { font-size: clamp(1.9rem, 3.6vw, 2.5rem); font-weight: 800; letter-spacing: -.03em; color: var(--blue-ink); font-variant-numeric: tabular-nums; line-height: 1.1; }
.hk span { color: var(--muted); font-size: .9rem; line-height: 1.35; }
.hallazgos { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr)); gap: 14px; }
@media (min-width: 700px) { .hallazgos.h2, .hallazgos.h4 { grid-template-columns: repeat(2, minmax(0, 1fr)); } .hallazgos.h3 { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
.hallazgo { border: 1px solid var(--line); border-radius: var(--r); padding: 22px; display: grid; gap: 10px; align-content: start; background: var(--bg); }
.hallazgo p { font-size: 1.06rem; color: var(--ink); }
.hn, .pn { font-weight: 800; font-size: .9rem; color: var(--blue); font-variant-numeric: tabular-nums; }
.hallazgo.clave { grid-column: 1 / -1; background: var(--grad); border-color: transparent; color: var(--on-blue); padding: 28px; gap: 14px; }
.hallazgo.clave .hn { color: var(--on-blue); opacity: .85; text-transform: uppercase; letter-spacing: .08em; font-size: .78rem; }
.hallazgo.clave p { color: var(--on-blue); font-size: clamp(1.15rem, 2.2vw, 1.45rem); font-weight: 600; line-height: 1.35; max-width: 60ch; }
.tabla-wrap { position: relative; overflow-x: auto; border: 1px solid var(--line); border-radius: var(--r); background: var(--bg); box-shadow: 0 1px 2px var(--sombra-c); }
.mercado { border-collapse: collapse; width: 100%; min-width: 980px; font-size: .92rem; font-variant-numeric: tabular-nums; }
.mercado th, .mercado td { padding: 14px 16px; text-align: right; border-bottom: 1px solid var(--line); vertical-align: middle; }
.mercado thead th { font-size: .76rem; font-weight: 600; color: var(--muted); line-height: 1.3; background: var(--bg-2); }
.mercado th:first-child { text-align: left; min-width: 240px; }
.mercado thead th:not(:first-child) { min-width: 84px; max-width: 110px; }
.mercado td:not(.t-fmt) { white-space: nowrap; }
.mercado .t-fmt { min-width: 200px; }
.mercado tbody tr:last-child > * { border-bottom: 0; }
.mercado tr.propia { background: var(--blue-soft); }
.t-marca { display: flex; align-items: center; gap: 10px; text-decoration: none; color: var(--ink); font-weight: 700; }
.t-marca span { display: grid; }
.t-marca em { font-style: normal; font-size: .72rem; color: var(--blue); font-weight: 700; }
.t-marca:hover { color: var(--blue); }
.t-activos { min-width: 150px; }
.t-num { font-weight: 800; font-size: 1.05rem; }
.t-barra { display: block; height: 6px; margin-top: 6px; border-radius: 6px; background: var(--bg-3); overflow: hidden; }
.t-barra i { display: block; height: 100%; width: 100%; background: var(--grad); border-radius: 6px; transform-origin: left; transform: scaleX(var(--k)); }
.t-fmt { width: 210px; text-align: left !important; }
.t-ver { width: 1%; }
.fbar { display: flex; gap: 2px; height: 9px; border-radius: 9px; overflow: hidden; background: var(--bg-3); transform-origin: left; }
.seg { display: block; height: 100%; flex-basis: 0; }
.fbar-ley { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 7px; font-size: .74rem; color: var(--muted); }
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 5px; vertical-align: 0; }
.f-video { background: var(--f-video); } .f-imagen { background: var(--f-imagen); } .f-carrusel { background: var(--f-carrusel); } .f-otro { background: var(--f-otro); }
.patrones { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr)); gap: 14px; }
.patron { background: var(--bg); border: 1px solid var(--line); border-radius: var(--r); padding: 22px; display: grid; gap: 10px; align-content: start; min-width: 0; }
.patron p { color: var(--ink-2); }

/* avatares */
.av { flex: none; width: 40px; height: 40px; border-radius: 50%; overflow: hidden; display: inline-grid; place-items: center; background: var(--bg-3); border: 1px solid var(--line); }
.av img { width: 100%; height: 100%; object-fit: cover; display: block; }
.av-ini { font-weight: 800; font-size: 1rem; }
.av-ini.t0 { background: var(--blue-soft); color: var(--blue); } .av-ini.t1 { background: var(--teal-soft); color: var(--teal); } .av-ini.t2 { background: var(--violet-soft); color: var(--violet); }
.av-ini.t3 { background: var(--good-soft); color: var(--good); } .av-ini.t4 { background: var(--bg-3); color: var(--blue-ink); }
.av-xs { width: 22px; height: 22px; font-size: .7rem; } .av-s { width: 32px; height: 32px; font-size: .85rem; }
.av-m { width: 56px; height: 56px; font-size: 1.3rem; } .av-l { width: 76px; height: 76px; font-size: 1.8rem; }

/* tu marca */
.marca-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr)); gap: 18px; align-items: start; }
.perfil, .en-meta, .detectado { background: var(--bg); border: 1px solid var(--line); border-radius: var(--r); padding: 24px; display: grid; gap: 16px; min-width: 0; box-shadow: 0 1px 2px var(--sombra-c); }
.perfil-top { display: flex; align-items: center; gap: 16px; min-width: 0; }
.perfil-id { display: grid; gap: 2px; min-width: 0; }
.perfil-id h3 { font-size: 1.25rem; display: flex; align-items: center; gap: 6px; overflow-wrap: anywhere; }
.perfil-id a { color: var(--muted); text-decoration: none; font-weight: 500; }
.perfil-id a:hover { color: var(--blue); }
.verif { flex: none; width: 18px; height: 18px; border-radius: 50%; background: var(--blue-2); position: relative; }
.verif::after { content: ""; position: absolute; left: 6px; top: 3.5px; width: 4px; height: 8px; border: solid var(--on-blue); border-width: 0 2px 2px 0; transform: rotate(45deg); }
.perfil-nums { display: flex; flex-wrap: wrap; gap: 8px 28px; }
.perfil-nums div { display: grid; }
.perfil-nums dt { font-size: .8rem; color: var(--muted); order: 2; }
.perfil-nums dd { font-size: 1.45rem; font-weight: 800; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
.bio { background: var(--bg-2); border-radius: 12px; padding: 14px 16px; font-size: .95rem; color: var(--ink-2); overflow-wrap: anywhere; }
.navegador { border: 1px solid var(--line-2); border-radius: 14px; overflow: hidden; background: var(--bg); box-shadow: 0 18px 40px -18px var(--sombra-f); min-width: 0; }
.nav-barra { display: flex; align-items: center; gap: 6px; padding: 10px 14px; background: var(--bg-2); border-bottom: 1px solid var(--line); }
.nav-barra i { width: 10px; height: 10px; border-radius: 50%; background: var(--line-2); }
.nav-barra span { margin-left: 10px; flex: 1; min-width: 0; background: var(--bg); border: 1px solid var(--line); border-radius: 999px; padding: 3px 12px; font-size: .78rem; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.navegador img { display: block; width: 100%; }
.marca-lectura { display: grid; gap: 18px; }
.ficha { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 210px), 1fr)); background: var(--bg); border: 1px solid var(--line); border-radius: var(--r); overflow: hidden; }
/* Bordes en cada celda y no un gap sobre fondo gris: así la última fila incompleta no deja un hueco gris. */
.ficha div { padding: 16px 18px; display: grid; gap: 4px; align-content: start; border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); margin: 0 -1px -1px 0; }
.ficha dt { font-size: .8rem; color: var(--muted); font-weight: 600; }
.ficha dd { font-size: .98rem; color: var(--ink); }
.supuestos { font-size: .9rem; color: var(--muted); max-width: 80ch; }
.supuestos strong { color: var(--ink-2); }
.en-meta-top { display: flex; align-items: center; gap: 10px; }
.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 1px; background: var(--line); border: 1px solid var(--line); border-radius: 14px; overflow: hidden; }
.kpis div { background: var(--bg); padding: 12px 14px; display: grid; gap: 2px; align-content: start; }
.kpis dt { font-size: .76rem; color: var(--muted); line-height: 1.3; }
.kpis dd { font-size: 1.35rem; font-weight: 800; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
.kpis dd.dd-txt { font-size: .95rem; font-weight: 700; letter-spacing: 0; overflow-wrap: anywhere; }
.checks { list-style: none; padding: 0; margin: 0; display: grid; gap: 10px; }
.checks li { display: flex; align-items: center; gap: 10px; font-weight: 500; }
.checks li::before { content: "✓"; flex: none; display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; font: 800 .74rem/1 system-ui, sans-serif; color: var(--good); background: var(--good-soft); box-shadow: inset 0 0 0 2px var(--good); }
.checks li.no::before { content: "✕"; color: var(--bad); background: var(--bad-soft); box-shadow: inset 0 0 0 2px var(--bad); }
.checks li.no { color: var(--ink-2); }
.pastillas { display: flex; flex-wrap: wrap; gap: 6px; }
.pastillas span { background: var(--bg-2); border: 1px solid var(--line); border-radius: 999px; padding: 4px 12px; font-size: .86rem; font-weight: 600; }
.posts { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 200px), 1fr)); gap: 14px; }
.post { display: grid; gap: 8px; align-content: start; min-width: 0; }
.post-img { position: relative; aspect-ratio: 4 / 5; max-width: 100%; border-radius: 14px; overflow: hidden; background: var(--bg-3); }
.post-img img { width: 100%; height: 100%; object-fit: cover; display: block; }
.post-tipo, .post-fijo { position: absolute; top: 8px; background: var(--velo); color: var(--on-blue); font-size: .72rem; font-weight: 700; border-radius: 999px; padding: 3px 9px; }
.post-tipo { left: 8px; } .post-fijo { right: 8px; }
.post figcaption { font-size: .86rem; color: var(--ink-2); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }

/* listas con evidencia */
.dos-col { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr)); gap: 14px; align-items: start; }
.col-lista { border-radius: 14px; padding: 18px; display: grid; gap: 12px; align-content: start; min-width: 0; background: var(--bg-2); }
.col-lista h3, .col-lista h4 { display: flex; align-items: center; gap: 8px; }
.col-lista h3::before, .col-lista h4::before { content: ""; width: 10px; height: 10px; border-radius: 50%; background: var(--good); }
.col-lista.no h3::before, .col-lista.no h4::before { background: var(--bad); }
.puntos { list-style: none; margin: 0; padding: 0; display: grid; gap: 14px; }
.puntos li { display: grid; gap: 8px; }
.puntos p { color: var(--ink-2); }
.minis { display: flex; flex-wrap: wrap; gap: 8px; }
.mini { position: relative; width: 58px; aspect-ratio: 4 / 5; max-width: 100%; padding: 0; border: 0; border-radius: 9px; overflow: hidden; background: var(--bg-3); cursor: pointer; box-shadow: 0 0 0 1px var(--line); transition: transform .15s ease, box-shadow .15s ease; }
.mini img { width: 100%; height: 100%; object-fit: cover; display: block; }
.mini-fmt { display: none; }
.mini.vacia .mini-fmt { display: grid; place-items: center; height: 100%; padding: 4px 4px 16px; font: 700 .6rem/1.2 var(--font); color: var(--muted); text-align: center; }
.mini em { position: absolute; left: 3px; bottom: 3px; font: 700 .62rem/1.4 var(--font); font-style: normal; background: var(--velo); color: var(--on-blue); border-radius: 5px; padding: 0 4px; }
.mini:hover { transform: translateY(-2px); box-shadow: 0 0 0 2px var(--blue); }

/* competencia */
.saltos { display: flex; flex-wrap: wrap; gap: 8px; }
.saltos a { display: inline-flex; align-items: center; gap: 8px; text-decoration: none; color: var(--ink); background: var(--bg); border: 1px solid var(--line-2); border-radius: 999px; padding: 5px 14px 5px 6px; font-size: .9rem; font-weight: 600; }
.saltos a:hover { border-color: var(--blue); color: var(--blue); }
.comps { display: grid; gap: 20px; }
.comp { border: 1px solid var(--line); border-radius: 22px; padding: clamp(18px, 3vw, 28px); display: grid; gap: 20px; background: var(--bg); box-shadow: 0 1px 2px var(--sombra-c), 0 14px 34px -22px var(--sombra-f); scroll-margin-top: 140px; min-width: 0; }
.comp-head { display: flex; flex-wrap: wrap; align-items: center; gap: 14px 16px; }
.comp-id { flex: 1 1 220px; min-width: 0; display: grid; gap: 2px; }
.comp-id h3 { font-size: 1.35rem; }
.comp-id p { color: var(--muted); font-size: .9rem; overflow-wrap: anywhere; }
.comp-acc { display: flex; flex-wrap: wrap; gap: 8px; }
.comp-acc .btn, .comp-acc .btn-sec { padding: 10px 16px; font-size: .88rem; }
.comp-res { font-size: 1.05rem; color: var(--ink-2); max-width: 75ch; }
.comp-fmt { display: grid; gap: 8px; max-width: 520px; }

/* anuncios */
.filtros { display: grid; gap: 14px; }
.chips { display: flex; flex-wrap: wrap; gap: 8px; }
.chip { display: inline-flex; align-items: center; gap: 8px; font: 600 .9rem/1 var(--font); color: var(--ink); background: var(--bg); border: 1px solid var(--line-2); border-radius: 999px; padding: 6px 14px 6px 8px; cursor: pointer; transition: background-color .15s ease, border-color .15s ease, color .15s ease; }
.chip[data-f-marca="todas"] { padding-left: 14px; }
.chip span { font-size: .75rem; color: var(--muted); background: var(--bg-2); border-radius: 999px; padding: 3px 7px; font-variant-numeric: tabular-nums; }
.chip:hover { border-color: var(--blue); }
.chip[aria-pressed="true"] { background: var(--blue); border-color: var(--blue); color: var(--on-blue); }
.chip[aria-pressed="true"] span { background: rgba(255, 255, 255, .22); color: var(--on-blue); }
.filtros-2 { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; }
.segmento { display: inline-flex; flex-wrap: wrap; gap: 2px; background: var(--bg-2); border: 1px solid var(--line); border-radius: 12px; padding: 3px; }
.segmento button { font: 600 .88rem/1 var(--font); color: var(--ink-2); background: transparent; border: 0; border-radius: 9px; padding: 9px 14px; cursor: pointer; }
.segmento button[aria-pressed="true"] { background: var(--bg); color: var(--blue); box-shadow: 0 1px 3px var(--sombra-f); }
.segmento button:disabled { opacity: .4; cursor: default; }
.orden { display: inline-flex; align-items: center; gap: 8px; font-size: .88rem; color: var(--muted); font-weight: 600; }
.orden select { font: 600 .9rem var(--font); color: var(--ink); background: var(--bg); border: 1px solid var(--line-2); border-radius: 10px; padding: 8px 12px; }
.cuenta { font-size: .9rem; color: var(--muted); font-weight: 600; }
.feed { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 440px), 1fr)); gap: 24px; align-items: start; }
.item { border: 1px solid var(--line); border-radius: 20px; overflow: hidden; background: var(--bg); box-shadow: 0 1px 2px var(--sombra-c), 0 16px 36px -24px var(--sombra-f); display: grid; min-width: 0; transition: box-shadow .2s ease, transform .2s ease; }
.item:hover { box-shadow: 0 2px 4px var(--sombra-c), 0 24px 44px -24px var(--sombra-f); }
.item-nota { background: var(--bg-2); border-bottom: 1px solid var(--line); padding: 16px 18px; display: grid; gap: 10px; }
.item-top { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.item-marca { margin-left: auto; font-size: .8rem; color: var(--muted); font-weight: 600; }
.item-nota > p { font-weight: 500; color: var(--ink); }
.tb { font-size: .72rem; font-weight: 700; border-radius: 999px; padding: 3px 10px; }
.tb-ganador { background: var(--blue-soft); color: var(--blue); }
.tb-nuevo { background: var(--teal-soft); color: var(--teal); }
.tb-apagado { background: var(--bad-soft); color: var(--bad); }
.tb-creador { background: var(--violet-soft); color: var(--violet); }
.hechos { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
.hechos li { font-size: .78rem; color: var(--ink-2); background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 3px 8px; font-variant-numeric: tabular-nums; }
.item-pie { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 12px 18px; border-top: 1px solid var(--line); font-size: .8rem; color: var(--muted); }
.item-pie a { font-weight: 700; text-decoration: none; }
.item-pie a:hover { text-decoration: underline; }
.mas-wrap { display: flex; justify-content: center; }
.vacio { text-align: center; color: var(--muted); padding: 30px 0; }

/* tarjeta estilo feed */
.fb { background: var(--bg); color: var(--fb-ink); font-size: .95rem; min-width: 0; }
.fb-head { display: flex; align-items: center; gap: 10px; padding: 14px 16px 10px; }
.fb-quien { display: grid; min-width: 0; flex: 1; line-height: 1.3; }
.fb-quien strong { font-size: .95rem; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fb-quien span { font-size: .8rem; color: var(--fb-muted); }
.fb-dots { color: var(--fb-muted); font-weight: 800; letter-spacing: 1px; }
.fb-texto { padding: 0 16px 12px; display: grid; justify-items: start; gap: 2px; }
.fb-texto p { overflow-wrap: anywhere; line-height: 1.45; }
.fb-texto.largo p { display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
.fb-texto.abierto p { display: block; -webkit-line-clamp: unset; }
.vermas { font: 700 .92rem var(--font); color: var(--fb-muted); background: none; border: 0; padding: 0; cursor: pointer; }
.vermas:hover { text-decoration: underline; }
.fb-media { position: relative; display: block; background: var(--fb-bg); max-width: 100%; }
.fb-media img { display: block; width: 100%; height: auto; max-height: 720px; object-fit: contain; margin: 0 auto; }
.fb-vacio { display: grid; place-items: center; aspect-ratio: 1; color: var(--fb-muted); }
.play { position: absolute; left: 50%; top: 50%; width: 64px; height: 64px; margin: -32px 0 0 -32px; border-radius: 50%; background: var(--velo); box-shadow: 0 0 0 3px rgba(255, 255, 255, .85); }
.play::after { content: ""; position: absolute; left: 25px; top: 20px; border-left: 19px solid var(--on-blue); border-top: 12px solid transparent; border-bottom: 12px solid transparent; }
.fmt-tag { position: absolute; right: 10px; top: 10px; background: var(--velo); color: var(--on-blue); font-size: .72rem; font-weight: 700; border-radius: 999px; padding: 3px 10px; }
.fb-link { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; background: var(--fb-bg); }
.fb-link-txt { display: grid; min-width: 0; gap: 1px; }
.fb-link .dom { font-size: .72rem; color: var(--fb-muted); letter-spacing: .02em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fb-link strong { font-size: .98rem; font-weight: 700; line-height: 1.3; overflow-wrap: anywhere; }
.fb-link .desc { font-size: .85rem; color: var(--fb-muted); display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden; }
.fb-cta { flex: none; background: var(--fb-gray); color: var(--fb-ink); font-weight: 700; font-size: .88rem; border-radius: 7px; padding: 9px 14px; white-space: nowrap; }

/* qué hacer */
.pasos-cuenta { list-style: none; counter-reset: paso; margin: 0; padding: 0; display: grid; gap: 12px; }
.pasos-cuenta li { counter-increment: paso; position: relative; display: grid; gap: 10px; padding: 18px 20px 18px 66px; border: 1px solid var(--line); border-radius: var(--r); background: var(--bg); }
.pasos-cuenta li::before { content: counter(paso); position: absolute; left: 18px; top: 16px; width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; background: var(--blue-soft); color: var(--blue); font-weight: 800; font-size: .95rem; }
.pasos-cuenta p { font-size: 1.02rem; }
.conceptos { display: grid; gap: 22px; }
.concepto { display: grid; grid-template-columns: minmax(0, 440px) minmax(0, 1fr); gap: 28px; align-items: start; background: var(--bg); border: 1px solid var(--line); border-radius: 22px; padding: clamp(16px, 3vw, 26px); }
.fb-mock { border: 1px solid var(--line); border-radius: 14px; overflow: hidden; box-shadow: 0 18px 40px -26px var(--sombra-f); }
.fb-media.idea { aspect-ratio: 1 / 1; background: var(--grad-idea); color: var(--on-blue); display: grid; align-items: center; overflow: hidden; }
.fb-media.idea.vertical { aspect-ratio: 4 / 5; }
.fb-media.idea::before { content: ""; position: absolute; width: 70%; aspect-ratio: 1; right: -18%; top: -22%; border-radius: 50%; background: radial-gradient(circle, rgba(255, 255, 255, .28), transparent 65%); }
.idea-in { position: relative; display: grid; gap: 10px; padding: 22px; }
.idea-fmt { justify-self: start; font-size: .74rem; font-weight: 700; border-radius: 999px; padding: 4px 11px; background: rgba(255, 255, 255, .2); }
.idea-in p { font-size: .95rem; font-weight: 500; line-height: 1.4; opacity: .9; }
.idea-gancho { font-size: clamp(1.35rem, 3.2vw, 1.75rem); font-weight: 800; line-height: 1.12; letter-spacing: -.01em; text-wrap: balance; }
.idea-dots { display: flex; gap: 5px; }
.idea-dots i { width: 7px; height: 7px; border-radius: 50%; background: rgba(255, 255, 255, .5); }
.idea-dots i:first-child { background: var(--on-blue); }
.concepto-info { display: grid; gap: 12px; align-content: start; min-width: 0; }
.cn { font-size: .8rem; font-weight: 800; color: var(--blue); text-transform: uppercase; letter-spacing: .08em; }
.concepto-info h3 { font-size: 1.4rem; }
.concepto-fmt { color: var(--muted); font-weight: 600; font-size: .92rem; }
.concepto-info > p:not(.mini-tit):not(.concepto-fmt) { color: var(--ink-2); }
.copiar { justify-self: start; margin-top: 4px; }
.copia-oculta { position: absolute; left: -9999px; width: 1px; height: 1px; opacity: 0; }
.timeline { list-style: none; counter-reset: t; margin: 0; padding: 0; display: grid; gap: 0; max-width: 820px; }
.timeline li { counter-increment: t; position: relative; display: grid; gap: 4px; padding: 0 0 26px 58px; }
.timeline li::before { content: counter(t); position: absolute; left: 0; top: -2px; width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center; background: var(--blue); color: var(--on-blue); font-weight: 800; }
.timeline li::after { content: ""; position: absolute; left: 17px; top: 38px; bottom: 4px; width: 2px; background: var(--line); }
.timeline li:last-child::after { display: none; }
.timeline strong { font-size: 1.08rem; }
.timeline span { color: var(--ink-2); }

/* ventana */
.modal { width: min(560px, calc(100% - 32px)); max-height: calc(100% - 48px); padding: 0; border: 0; border-radius: 22px; background: var(--bg); color: var(--ink); box-shadow: 0 30px 80px -20px var(--velo); overflow: auto; }
.modal::backdrop { background: var(--velo); backdrop-filter: blur(3px); }
.modal .item { border: 0; border-radius: 0; box-shadow: none; }
.cerrar { position: sticky; top: 10px; float: right; margin: 10px 10px -46px 0; z-index: 2; width: 36px; height: 36px; border-radius: 50%; border: 0; background: var(--bg); box-shadow: 0 2px 10px var(--sombra-f); cursor: pointer; font: 700 1.1rem/1 var(--font); color: var(--ink); }

.pie { border-top: 1px solid var(--line); background: var(--bg-2); padding-block: 34px 48px; color: var(--muted); font-size: .84rem; }
.pie .wrap { display: grid; gap: 10px; }
.pie-top { display: flex; align-items: center; gap: 10px; color: var(--ink-2); font-weight: 600; }

@media (max-width: 860px) {
  .barra-in { grid-template-columns: 1fr auto; padding-top: 10px; }
  .tabs { grid-column: 1 / -1; grid-row: 2; justify-self: stretch; margin-inline: -6px; }
  .tab::after { bottom: -1px; }
  .concepto { grid-template-columns: minmax(0, 1fr); }
  .concepto { gap: 12px; }
  .concepto-info { display: contents; }
  .concepto .fb-mock { margin-block: 8px; }
  .concepto .cn, .concepto-info h3, .concepto-fmt { order: -1; }
  .hero { padding-block: 40px 36px; }
}
@media (max-width: 520px) {
  .logo span { display: none; }
  .feed { gap: 16px; }
  .item-nota { padding: 14px; }
  .pasos-cuenta li { padding-left: 58px; }
  .hk { padding: 14px 16px; }
  .hero-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .hk span { font-size: .82rem; }
  .fuente-linea { font-size: .76rem; gap: 6px 8px; padding: 6px 12px; }
  .tab { padding: 9px 11px; font-size: .9rem; }
}

/* movimiento */
@media (prefers-reduced-motion: no-preference) {
  .anim .rv { transition: opacity .6s cubic-bezier(.2, .7, .2, 1), transform .6s cubic-bezier(.2, .7, .2, 1); }
  .anim .rv:not(.in) { opacity: 0; transform: translateY(16px); }
  .anim .rv .crece, .anim .rv.crece { transition: transform .9s cubic-bezier(.2, .7, .2, 1) .15s; }
  .anim .rv:not(.in) .t-barra i { transform: scaleX(0); }
  .anim .rv:not(.in) .fbar { transform: scaleX(0); }
  .vista.entra { animation: entra .45s cubic-bezier(.2, .7, .2, 1); }
  .item.aparece { animation: sube .5s cubic-bezier(.2, .7, .2, 1) both; }
  .modal[open] { animation: pop .3s cubic-bezier(.2, .7, .2, 1); }
  .hero::before { animation: flota 16s ease-in-out infinite alternate; }
  .item:hover { transform: translateY(-2px); }
}
@keyframes entra { from { opacity: 0; transform: translateY(10px); } }
@keyframes sube { from { opacity: 0; transform: translateY(18px); } }
@keyframes pop { from { opacity: 0; transform: translateY(18px) scale(.98); } }
@keyframes flota { to { transform: translate(-90px, 60px) scale(1.08); } }
`;

const SCRIPT = `
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const movimiento = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (movimiento) document.documentElement.classList.add('anim');
  const miles = (n) => String(Math.round(n)).replace(/\\B(?=(\\d{3})+(?!\\d))/g, '.');

  // Las miniaturas toman la imagen de la tarjeta de su anuncio: así cada imagen pesa una sola vez.
  $$('img[data-de]').forEach((im) => { const o = $('#ad-' + im.dataset.de + ' .fb-media img'); if (o) im.src = o.src; else { im.closest('.mini')?.classList.add('vacia'); im.remove(); } });

  // Aparecer al hacer scroll y contar los números.
  function contar(raiz) {
    if (!movimiento) return;
    const els = raiz.matches('[data-n]') ? [raiz] : $$('[data-n]', raiz);
    els.forEach((el) => {
      if (el.dataset.contado) return;
      el.dataset.contado = '1';
      const fin = +el.dataset.n, suf = el.dataset.suf || '', t0 = performance.now(), dur = 1100;
      const paso = (t) => { const k = Math.min(1, (t - t0) / dur); el.textContent = miles(fin * (1 - Math.pow(1 - k, 3))) + suf; if (k < 1) requestAnimationFrame(paso); };
      requestAnimationFrame(paso);
    });
  }
  if (movimiento) $$('.rv [data-n]').forEach((el) => { el.textContent = '0' + (el.dataset.suf || ''); });
  const io = 'IntersectionObserver' in window ? new IntersectionObserver((es) => {
    for (const e of es) if (e.isIntersecting) { e.target.classList.add('in'); contar(e.target); io.unobserve(e.target); }
  }, { rootMargin: '0px 0px -6% 0px' }) : null;
  const observar = () => $$('.vista:not([hidden]) .rv:not(.in)').forEach((el) => (io ? io.observe(el) : (el.classList.add('in'), contar(el))));

  // Vistas por pestaña, con el nombre en el link: #resumen, #marca, #competencia, #anuncios, #plan.
  const VISTAS = $$('.vista').map((v) => v.id.slice(2));
  let actual = null, destino = null;
  function mostrar(v) {
    if (!VISTAS.includes(v)) v = VISTAS[0];
    const cambia = v !== actual;
    actual = v;
    for (const x of VISTAS) { const el = $('#v-' + x); el.hidden = x !== v; if (x === v && cambia) { el.classList.remove('entra'); void el.offsetWidth; el.classList.add('entra'); } }
    $$('.tab').forEach((t) => t.setAttribute('aria-current', t.dataset.vista === v ? 'page' : 'false'));
    if (v === 'anuncios') aplicar();
    const ir = destino && document.getElementById(destino);
    destino = null;
    if (ir) requestAnimationFrame(() => ir.scrollIntoView({ behavior: movimiento ? 'smooth' : 'auto', block: 'start' }));
    else if (cambia) window.scrollTo(0, 0);
    observar();
    const tab = $('.tab[aria-current="page"]');
    if (tab && tab.parentElement.scrollWidth > tab.parentElement.clientWidth) tab.parentElement.scrollLeft = tab.offsetLeft - 40;
  }
  window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (h !== actual) mostrar(h); });

  // Galería de anuncios: filtro por marca y por tipo, orden y de a 12.
  const estado = { marca: 'todas', tipo: 'todos', orden: 'impresiones', ver: 12 };
  const feed = $('#feed');
  const items = feed ? $$('.item', feed) : [];
  const tiene = (it, t) => it.dataset.tipos.split(' ').includes(t);
  const cmp = {
    impresiones: (a, b) => a.dataset.rank - b.dataset.rank || b.dataset.dias - a.dataset.dias,
    dias: (a, b) => b.dataset.dias - a.dataset.dias,
    recientes: (a, b) => b.dataset.inicio - a.dataset.inicio,
  };
  function aplicar(animar = true) {
    if (!feed) return;
    const deMarca = items.filter((it) => estado.marca === 'todas' || it.dataset.marca === estado.marca);
    $$('[data-f-tipo]').forEach((b) => { const t = b.dataset.fTipo; b.disabled = t !== 'todos' && !deMarca.some((it) => tiene(it, t)); });
    if (estado.tipo !== 'todos' && !deMarca.some((it) => tiene(it, estado.tipo))) estado.tipo = 'todos';
    const ok = deMarca.filter((it) => estado.tipo === 'todos' || tiene(it, estado.tipo)).sort(cmp[estado.orden]);
    ok.forEach((it) => feed.appendChild(it));
    const ver = new Set(ok.slice(0, estado.ver));
    let i = 0;
    for (const it of items) {
      const mostrarlo = ver.has(it);
      if (mostrarlo && it.hidden && animar && movimiento) { it.style.animationDelay = Math.min(i++, 8) * 45 + 'ms'; it.classList.remove('aparece'); void it.offsetWidth; it.classList.add('aparece'); }
      it.hidden = !mostrarlo;
    }
    $('#cuenta').textContent = ok.length === 1 ? '1 anuncio' : ok.length + ' anuncios';
    $('#mas').hidden = ok.length <= estado.ver;
    $('#vacio').hidden = ok.length > 0;
    $$('[data-f-marca]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.fMarca === estado.marca)));
    $$('[data-f-tipo]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.fTipo === estado.tipo)));
  }
  const reiniciar = () => { estado.ver = 12; items.forEach((it) => (it.hidden = true)); };
  if (feed) items.forEach((it) => (it.hidden = true));
  $('#orden')?.addEventListener('change', (e) => { estado.orden = e.target.value; reiniciar(); aplicar(); });

  const dlg = $('#modal');
  const cerrar = () => { if (dlg.close) dlg.close(); else dlg.removeAttribute('open'); };
  document.addEventListener('click', async (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (a) {
      const v = a.getAttribute('href').slice(1);
      if (VISTAS.includes(v)) {
        e.preventDefault();
        if (a.dataset.marca) { estado.marca = a.dataset.marca; estado.tipo = 'todos'; reiniciar(); }
        destino = a.dataset.a || null;
        if (dlg?.open) cerrar();
        if (v === actual) { if (v === 'anuncios') { aplicar(); window.scrollTo(0, 0); } else if (destino) mostrar(v); else window.scrollTo({ top: 0, behavior: movimiento ? 'smooth' : 'auto' }); }
        else { history.pushState(null, '', '#' + v); mostrar(v); }
        return;
      }
    }
    const fm = e.target.closest('[data-f-marca]');
    if (fm) { estado.marca = fm.dataset.fMarca; reiniciar(); aplicar(); return; }
    const ft = e.target.closest('[data-f-tipo]');
    if (ft) { if (ft.disabled) return; estado.tipo = ft.dataset.fTipo; reiniciar(); aplicar(); return; }
    if (e.target.closest('#mas')) { estado.ver += 12; aplicar(); return; }
    const vm = e.target.closest('.vermas');
    if (vm) { const t = vm.closest('.fb-texto'); t.classList.toggle('abierto'); vm.textContent = t.classList.contains('abierto') ? 'Ver menos' : 'Ver más'; return; }
    const mini = e.target.closest('[data-ad]');
    if (mini && dlg) {
      const it = document.getElementById('ad-' + mini.dataset.ad);
      if (!it) return;
      const copia = it.cloneNode(true);
      copia.removeAttribute('id'); copia.hidden = false; copia.classList.remove('aparece'); copia.style.animationDelay = '';
      $('#modal-cuerpo').replaceChildren(copia);
      if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
      dlg.scrollTop = 0;
      return;
    }
    if (dlg && (e.target === dlg || e.target.closest('.cerrar'))) { cerrar(); return; }
    const b = e.target.closest('.copiar');
    if (b) {
      try { await navigator.clipboard.writeText(b.dataset.copia); b.textContent = 'Copiado'; }
      catch { const t = b.parentElement.querySelector('.copia-oculta'); if (t) { t.style.cssText = 'position:static;width:100%;height:8em;opacity:1'; t.removeAttribute('aria-hidden'); t.focus(); t.select(); } b.textContent = 'Selecciona y copia con Ctrl+C'; }
      setTimeout(() => (b.textContent = 'Copiar texto'), 2400);
    }
  });

  mostrar(location.hash.slice(1));
})();
`;

const cuerpo = `
<header class="barra"><div class="wrap barra-in">
  <a class="logo" href="#${vistas[0][0]}"><b><i>/</i>spy</b><span>${esc(tituloCorto)}</span></a>
  <nav class="tabs" aria-label="Secciones del informe">${vistas.map(([id, nombre]) => `<a class="tab" href="#${id}" data-vista="${id}">${nombre}</a>`).join('')}</nav>
  <span class="fuente">Datos de ${metaLogo()}</span>
</div></header>
<main>
${vistas.map(([, , html]) => html).join('\n')}
</main>
<dialog class="modal" id="modal" aria-label="Anuncio"><button type="button" class="cerrar" aria-label="Cerrar">✕</button><div id="modal-cuerpo"></div></dialog>
<footer class="pie"><div class="wrap">
  <p class="pie-top">${metaLogo('meta-chico')}<span>Datos públicos de la Biblioteca de anuncios, leídos el ${fechaCorta(fecha)}.</span></p>
  <p>Informe independiente hecho con /spy. No tiene relación con Meta ni con las marcas analizadas. Meta no publica ventas ni resultados: un anuncio cuenta como ganador cuando está entre los de más impresiones y lleva semanas activo, y como prueba que no rindió cuando se apagó en 7 días o menos.</p>
  <p>Los formatos y lanzamientos salen de una muestra de hasta 180 anuncios activos por marca. La biblioteca solo deja ver los últimos anuncios apagados de cada página.</p>
</div></footer>
`;

const head = `<title>${esc(tituloCorto)}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700;800&display=swap">
<style>${CSS}</style>`;

let html;
let salida;
if (modo === 'artifact') {
  html = `${head}\n${cuerpo}\n<script>${SCRIPT}</script>\n`;
  fs.mkdirSync(path.join(dir, 'artifact'), { recursive: true });
  salida = path.join(dir, 'artifact', 'informe.html');
} else {
  html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${head}
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}[hidden]{display:none!important}</style>
</head>
<body>
${cuerpo}
<script>${SCRIPT}</script>
</body>
</html>
`;
  salida = path.join(dir, 'informe.html');
}
fs.writeFileSync(salida, html);
console.log(`[spy] Informe: ${salida} (${(Buffer.byteLength(html) / 1048576).toFixed(1)} MB, ${galeria.length} anuncios en la galería)`);
