# CLAUDE.md: mantenimiento de /spy

Este archivo es para quien mantiene el skill. Para usarlo, ver `README.md` y `SKILL.md`.

- Guía pública del skill: `paidbyfacu.com/guias/spy`, en el repo `paidbyfacu/paidbyfacu-web`. Si cambian la instalación, los argumentos o el informe, actualiza también la guía y sus capturas en `assets/guias/spy/`.
- Textos del informe y de la guía: español neutro con tuteo, sin paréntesis ni rayas largas.
- `marcas/` guarda los perfiles de las marcas de cada usuario y no se sube.

## Trabajo compartido entre agentes

Este repo lo editan varios agentes de Claude además del usuario. GitHub es la fuente de verdad.

1. Antes de tocar nada: `git pull --rebase`.
2. Después de cada cambio: commit chico y descriptivo, `git pull --rebase` y `git push` a `main`.
3. Agregar solo lo que tocaste, nunca `git add -A`.
4. Conflictos: conservar los cambios del otro; si no está claro, preguntar. Nunca `push --force`.
5. Nada de secretos ni datos de marcas de clientes.
