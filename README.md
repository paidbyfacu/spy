# /spy para Claude Code

Un skill que lee tu marca, encuentra a tu competencia en la Biblioteca de anuncios de Meta y te arma un informe con lo que les funciona, lo que apagaron rápido y los anuncios que te conviene lanzar.

Guía completa, con capturas: https://paidbyfacu.com/guias/spy

## Qué necesitas

- Claude Code, en la terminal, la app de escritorio o VS Code, con un plan Pro o Max.
- Node.js 18 o más nuevo.
- Google Chrome o Microsoft Edge.
- Git, o el ZIP de este repositorio.

## Instalación

**Windows, en PowerShell:**

```powershell
git clone https://github.com/paidbyfacu/spy "$env:USERPROFILE\.claude\skills\spy"
npm.cmd install --prefix "$env:USERPROFILE\.claude\skills\spy\scripts"
```

**Mac, en la Terminal:**

```bash
git clone https://github.com/paidbyfacu/spy ~/.claude/skills/spy
npm install --prefix ~/.claude/skills/spy/scripts
```

**O desde Claude Code**, pegando este mensaje:

> Instala el skill /spy desde https://github.com/paidbyfacu/spy: clónalo en la carpeta de skills de mi usuario, en .claude/skills/spy, y corre npm install dentro de su carpeta scripts. Si me falta Node.js o Git, instálalos primero.

Abre un chat nuevo y escribe `/`: tiene que aparecer `spy`.

## Uso

```
/spy instagram.com/tumarca, web: tumarca.com, nicho: lo que vendes
```

Opcionales: `competencia: Marca A, Marca B` para sumar marcas que ya conoces, y `país: MX` para buscar en otro país.

El skill lee tu marca, te hace una sola pregunta sobre el formato y la cantidad de competidores, y trabaja solo entre 10 y 20 minutos. Te entrega el informe como Artifact en tu cuenta de claude.ai o como archivo HTML. La segunda vez basta con `/spy`, porque guarda el perfil de tu marca.

Todo queda en `Documentos/spy`, con una carpeta por marca y por fecha.

## Qué hace y qué no

- Lee solo datos públicos: la biblioteca de anuncios, tu Instagram y tu web, sin iniciar sesión.
- No ve ventas, gasto ni resultados de nadie, porque Meta no los publica: usa señales como el orden por impresiones y los días activo.
- No toca tu cuenta publicitaria ni publica nada.

## Actualizar

```
git -C ~/.claude/skills/spy pull
```

Meta cambia la biblioteca de vez en cuando. Si un día deja de traer anuncios, actualiza primero.

Hecho por [@paidbyfacu](https://instagram.com/paidbyfacu).
