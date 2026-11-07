# /spy para Claude Code

Un skill que lee tu marca, encuentra a tu competencia en la Biblioteca de anuncios de Meta y te arma un informe con lo que les funciona, lo que apagaron rápido y los anuncios que te conviene lanzar. Sirve para cualquier marca y cualquier país.

Guía completa, con capturas, todos los comandos y prompts: https://paidbyfacu.com/guias/spy

## Qué necesitas

- Claude Code, en la terminal, la app de escritorio o VS Code, con un plan de pago de Claude.
- Node.js 18 o más nuevo.
- Google Chrome o Microsoft Edge.
- Git, o el ZIP de este repositorio.

## Instalación

**Windows, en PowerShell:**

```powershell
git clone https://github.com/paidbyfacu/spy "$env:USERPROFILE\.claude\skills\spy"
npm.cmd install --prefix "$env:USERPROFILE\.claude\skills\spy\scripts"
```

**Mac y Linux, en la Terminal:**

```bash
git clone https://github.com/paidbyfacu/spy ~/.claude/skills/spy
npm install --prefix ~/.claude/skills/spy/scripts
```

**O desde Claude Code**, pegando este mensaje:

> Instala el skill /spy desde https://github.com/paidbyfacu/spy: clónalo en la carpeta de skills de mi usuario, en .claude/skills/spy, y corre npm install dentro de su carpeta scripts. Si me falta Node.js o Git, instálalos primero.

Abre un chat nuevo y escribe `/`: tiene que aparecer `spy`.

Si no tienes Chrome ni Edge, baja un navegador solo para el skill desde su carpeta `scripts`:

```bash
cd ~/.claude/skills/spy/scripts
npx playwright-core install chromium
```

## Uso

```
/spy
```

Así, a secas, alcanza. Antes de preguntarte nada, el skill junta lo que Claude Code ya sabe de tu marca: tus CLAUDE.md, la memoria del proyecto, los archivos de la carpeta donde lo corres, los perfiles guardados y los informes anteriores. Después lee tu Instagram y tu web, y si tienes uno solo, busca el otro.

Lo que no encuentra te lo pregunta en tarjetas con opciones armadas con lo que leyó: tu Instagram o tu web si no aparecen, qué quieres vender, en qué país, qué quieres que haga la gente con el anuncio y cuánto inviertes por mes. Nunca te pregunta lo que ya sabe, y guarda tus respuestas para la próxima vez. Lo que dedujo sin que lo confirmes aparece en el informe como supuesto.

También puedes darle los datos de entrada, todos opcionales:

```
/spy instagram.com/tumarca, web: tumarca.com, nicho: lo que vendes
```

| Dato | Cómo escribirlo |
|---|---|
| Instagram | `instagram.com/usuario`, `@usuario` o `ig: usuario` |
| Web | `web: tumarca.com` o cualquier dominio |
| Nicho | `nicho: lo que vendes` o texto suelto |
| Competencia | `competencia: Marca A, Marca B`, con nombres o links de la biblioteca |
| País | `país: MX`, el nombre del país o `todos` |
| Oferta y precio | `oferta: plan anual`, `precio: 49 USD` |
| Público | `público: dueñas de tiendas online` |
| Objetivo | `objetivo: ventas`, `mensajes` o `leads` |
| Presupuesto | `presupuesto: 500 USD por mes` |

Con las respuestas trabaja solo entre 10 y 20 minutos y te entrega el informe como Artifact en tu cuenta de claude.ai o como archivo HTML.

Todo queda en `Documentos/spy`, con una carpeta por marca y por fecha. Los perfiles de tus marcas quedan en `marcas/`, dentro del skill.

## Los scripts

Claude los corre por ti. Si quieres hacerlo a mano, desde `scripts/`:

```bash
node contexto.mjs --dir ~/mi-proyecto
node scrape.mjs marca --ig tumarca --web tumarca.com --nicho "lo que vendes" --out ~/Documents/spy/tumarca
node scrape.mjs descubrir --q "palabra 1" --q "palabra 2" --pais AR --out ~/Documents/spy/tumarca
node scrape.mjs paginas --pagina "Marca A" --pagina 123456789 --propia 987654321 --pais AR --out ~/Documents/spy/tumarca
node scrape.mjs imagenes --out ~/Documents/spy/tumarca
node render.mjs ~/Documents/spy/tumarca --modo html
```

`contexto.mjs` no abre el navegador: devuelve en JSON lo que encontró de la marca en los CLAUDE.md, la memoria y los archivos de la carpeta, sin abrir `.env`, claves ni credenciales. `render.mjs` necesita `analisis.json`, que escribe Claude con la forma de `plantilla-analisis.json`. Opciones: `--pais` con un código de dos letras o `ALL`, `--max-ganadores 120`, `--max-nuevos 60`, `--max-apagados 60`, `--max-descubrir 150` y `--ver` para ver el navegador.

## Qué hace y qué no

- De internet lee solo datos públicos: la biblioteca de anuncios, tu Instagram y tu web, sin iniciar sesión.
- De tu computadora lee solo lo que Claude Code ya tiene a mano: los CLAUDE.md, la memoria y la carpeta del proyecto. No recorre tu carpeta de usuario ni Documentos enteros, y no abre archivos de claves.
- No ve ventas, gasto ni resultados de nadie, porque Meta no los publica: usa señales como el orden por impresiones y los días activo.
- No toca tu cuenta publicitaria ni publica nada.

## Actualizar

```bash
git -C ~/.claude/skills/spy pull
npm install --prefix ~/.claude/skills/spy/scripts
```

En Windows, con `$env:USERPROFILE\.claude\skills\spy` y `npm.cmd`. Tus perfiles de `marcas/` no se tocan. Meta cambia la biblioteca de vez en cuando: si un día deja de traer anuncios, actualiza primero.

## Desinstalar

Borra la carpeta `.claude/skills/spy` de tu usuario. Los informes de `Documentos/spy` quedan hasta que los borres.

Hecho por [@paidbyfacu](https://instagram.com/paidbyfacu).
