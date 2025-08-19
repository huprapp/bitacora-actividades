
# Bitácora de Actividades (General) – App Web

Aplicación React (Vite) para registrar actividades por responsable y generar reportes con gráficas.

## Requisitos
- Node.js 18+
- npm

## Desarrollo local
```bash
npm install
npm run dev
```

## Compilar para producción
```bash
npm run build
npm run preview
```

La carpeta resultante `dist/` es la que se publica.

## Despliegue en Netlify (opción 1: desde repositorio GitHub)
1. Crea un repositorio nuevo en GitHub y sube estos archivos.
2. En Netlify → "Add new site" → "Import an existing project".
3. Conecta tu repo.
4. Configura:
   - Build command: `npm run build`
   - Publish directory: `dist`
5. Deploy.

## Despliegue en Netlify (opción 2: drag & drop)
1. Ejecuta `npm run build`.
2. Arrastra la carpeta `dist/` al botón "Deploy site" (Netlify Drop).

## Despliegue en GitHub Pages
- Puedes usar una acción de GitHub o `npm run build` y publicar la carpeta `dist/` en `gh-pages` branch con `vite` + `gh-pages`.
