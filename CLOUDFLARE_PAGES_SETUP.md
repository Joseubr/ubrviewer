# UBRViewer - Setup Cloudflare Pages + Functions + R2

Este proyecto ya incluye:
- Frontend adaptado para leer manifest desde `/api/manifest`
- Publicacion admin por `POST /api/publish`
- Renombrado admin por `POST /api/rename-project`
- Functions serverless en `functions/api/*`

## 1) Crear bucket R2
1. Cloudflare Dashboard -> R2 -> Create bucket
2. Nombre recomendado: `ubrviewer-store-global`
3. No cambiar ubicacion, region o jurisdiction al crearlo

## 2) Configurar Pages bindings
En el proyecto Pages:

1. Settings -> Functions -> R2 bucket bindings
- Variable name: `UBR_STORE`
- Bucket: `ubrviewer-store-global`

2. Settings -> Environment variables
- Name: `ADMIN_API_KEY`
- Value: clave larga y aleatoria (32+ caracteres)
- Scope: Production (y Preview si quieres probar antes)

## 3) Deploy
1. Subir esta carpeta al repo conectado a Pages
2. Esperar deploy completo

## 4) Primera carga de datos
Opcion A (recomendada): desde la UI Admin
1. Entrar en la URL publica activa del proyecto en Pages
2. Abrir panel Admin
3. Al publicar por primera vez pedira `API Key Admin (Cloudflare)`
4. Pegar el valor de `ADMIN_API_KEY`
5. Cargar JSONs para ir poblando R2

Opcion B (manual): subir objetos directo a R2
- `manifest.json`
- `projects/<id>.json`

## 5) Pruebas rapidas
1. GET `/api/manifest` en la URL publica activa del proyecto
- Debe devolver `[]` o una lista JSON

2. Publicar desde Admin un proyecto nuevo
- Debe mostrar estado de publicado

3. Abrir en otro equipo en modo Viewer
- Debe ver el proyecto nuevo tras recargar

## 6) Notas importantes
- Sin `ADMIN_API_KEY` correcto, publish/rename responde 401
- La API key se guarda en `sessionStorage` solo durante esa sesion del navegador
- Si cierras la pestana, al volver a publicar te la volvera a pedir
