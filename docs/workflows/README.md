# Workflows de GitHub Actions

Estos tres archivos son plantillas listas para activar. Están en `docs/workflows/`
porque el token de publicación usado para este commit no tenía el scope
`workflow` y GitHub rechazó el push de `.github/workflows/`.

## Activar

1. Crea la carpeta `.github/workflows/` en el repositorio.
2. Mueve o copia `links.yml`, `html.yml` y `lighthouse.yml` allí.
3. Haz commit y push con un token que incluya el scope `workflow`, o crea los
   archivos desde la web de GitHub (**Add file → Create new file**).

## Qué hace cada uno

- **`links.yml`** — revisa enlaces rotos en HTML y Markdown con Lychee. Es
  informativo (`fail: false`), no bloquea el despliegue.
- **`html.yml`** — valida el HTML con `html-validate`. También es informativo.
- **`lighthouse.yml`** — auditoría manual de `https://likehoodie.com/`; se lanza
  desde **Actions → Lighthouse → Run workflow**.

## Dependabot

`.github/dependabot.yml` sí está activo: actualiza las versiones de las GitHub
Actions una vez al mes.
