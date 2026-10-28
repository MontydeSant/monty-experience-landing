# Paquete v2 — montyexperience.com (CSS global + medición corregida)

Reemplaza al paquete anterior: trae TODO (no hace falta subir el primero).
Un solo commit = un solo deploy.

## Cómo subirlo
1. Copia el contenido de esta carpeta encima de tu repo (respeta carpetas; reemplaza lo existente).
2. Borra los archivos de `ARCHIVOS-A-BORRAR.txt`.
3. Un solo commit.

## CSS global — `assets/css/global.css`
Todas las páginas lo enlazan: index, privacidad, gracias-agenda, 404, bio-instagram, crea-tu-cv y perfil-actor.
Contiene los tokens del sistema de diseño (colores, tipografías, radios, sombras, grano), el botón (primario y secundario),
la claqueta, el footer y los componentes `mx-*` para páginas nuevas.
- Para una página nueva: copia el bloque de `<head>` de `404.html` y arma el contenido con las clases `mx-*`.
- Para cambiar un color o el botón en todo el sitio: edita solo `global.css`.

## Corrección importante (medición)
La claqueta frenaba el clic antes de que corriera `tracking.js`, así que `Lead` (WhatsApp) y la metadata de Cal no se enviaban.
Ahora `tracking.js` escucha en `window` y la claqueta en `document`: la medición corre primero. Probado en navegador.

## Pasos después del deploy
1. Cal.com → evento → Advanced → Redirect on booking: `https://montyexperience.com/gracias-agenda?origen=ads` (anuncios) o sin `?origen`.
2. Netlify → Environment variables: `META_PIXEL_ID`, `META_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID`, `CALCOM_WEBHOOK_SECRET`.
3. Meta → Events Manager → Test Events: clic a WhatsApp (debe llegar `Lead`) y una reserva de prueba (debe llegar `Schedule` una sola vez).
4. Search Console: reenviar sitemap.
