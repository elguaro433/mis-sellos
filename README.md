# 📮 Mis Sellos

Catálogo personal de sellos de **Emmanuel Díaz** (Familia Díaz González).
Haces una foto con el iPhone y la IA identifica el sello, lo valora y lo guarda
con su foto en tu colección. Funciona como app instalada (PWA), a cualquier hora.

- **Sin servidor ni nube:** los sellos y las fotos viven en el teléfono (IndexedDB).
- **La IA** (Claude) se llama directamente desde el teléfono con la clave de cada
  persona, que se pega en ⚙️ Ajustes y se queda solo en ese teléfono.
- **Copia de seguridad:** ⚙️ Ajustes → Exportar TODO (ZIP con catálogo web, Excel, JSON y fotos).
- `conocimiento.txt` es el «manual de perito» que se envía a la IA (se regenera `ia_textos.js` desde aquí).

## Instalarla
1. Abrir el enlace en **Safari**. 2. Compartir → **Añadir a pantalla de inicio**.
3. Abrirla siempre desde el icono (Safari borra los datos de webs sin uso en 7 días; las apps instaladas no).

## Publicar cambios
Subir `VERSION` en `sw.js` y `APP_VERSION` en `app.js`, `git commit` y `git push`.
