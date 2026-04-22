# web-host (MVP inicial)

Este folder es la base para publicar en un host estatico.

## Contenido

- `index.html`: copia inicial de tu HTML actual para comenzar migracion.
- `main.desktop.reference.js`: referencia del backend Electron/Node de escritorio.

## Importante

`main.desktop.reference.js` no debe cargarse en navegador, porque usa APIs de Node/Electron.

## Proximo paso sugerido

1. Crear `app.web.js` con funciones compatibles con navegador.
2. Cargar proyectos XML/JSON desde URL publica (Drive o storage web).
3. Reproducir video mediante YouTube IFrame API.
