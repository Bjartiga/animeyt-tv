# Reproductores web y Tizen 5.5

## Investigación del 16 de octubre de 2026

El equipo objetivo usa Chromium 69. Se descargaron las páginas y los scripts actuales de un episodio de Perfect Addiction y se revisaron sus fuentes (sin modificar ni ejecutar los sitios en la TV).

| Proveedor | Archivo observado | Sintaxis encontrada en código | Resultado |
| --- | --- | --- | --- |
| Moon | `bysesukior.com/assets/index-DocunfmE.js` | `checked:n??e._wrapperState.initialChecked` | Requiere soporte de coalescencia nula |
| Epsilon | `ytplay.rpmvid.com/assets/index-B82x0F06.js` | `o=a?.nonce\|\|a?.getAttribute("nonce")` | Requiere encadenamiento opcional |
| Abyss | `iamcdn.net/player-v2/core.bundle.js` | `jwplayer()?.['remove']?.()` | Requiere encadenamiento opcional |

Las tablas de compatibilidad de MDN sitúan ambos operadores desde Chrome 80. Por ello estos archivos actuales no se pueden analizar con el motor Chromium 69; es una incompatibilidad de sintaxis, independiente del sandbox. Los proveedores pueden servir versiones distintas según URL, agente de usuario o fecha: no es una declaración permanente sobre todo su servicio. No se verificó el archivo exacto entregado dentro del WGT físico porque SDB no se conectó.

Fuentes:

- [Motores de Samsung por año](https://developer.samsung.com/smarttv/develop/specifications/web-engine-specifications.html)
- [Compatibilidad de encadenamiento opcional](https://github.com/mdn/browser-compat-data/blob/main/javascript/operators/optional_chaining.json)
- [Compatibilidad de coalescencia nula](https://github.com/mdn/browser-compat-data/blob/main/javascript/operators/nullish_coalescing.json)
- [Restricciones de iframe](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe)

## Investigación de fuentes directas

La incompatibilidad de la interfaz web no impide extraer una fuente compatible. Se siguieron las solicitudes y el transporte del cliente público de cada proveedor, sin ejecutar sus bundles dentro del WGT.

| Proveedor | Evidencia de red | Decisión en 1.8.0 |
| --- | --- | --- |
| Epsilon | API `/api/v1/video` del episodio `fcrc8x`: respuesta válida. `cfNative`: master HLS 200 con H.264/AAC en 720p/1080p, playlist de variante válida y primer fragmento 206 `video/mp4`. El episodio antiguo `b1qpa1` devuelve 404 en la API de video. | Resolver directo implementado. No confundir enlace retirado con incompatibilidad de todo el proveedor. |
| Moon/Byse | El flujo del embed `r35k030shgr3` entrega configuración con `captcha_required: true`. En `ztbuaz4th3pg`, detalles 200 y configuración del frame 403. El cliente solicita token de verificación antes de playback cuando corresponde. | Se conserva iframe. No se automatizan ni omiten verificaciones. No se verificó una fuente pública utilizable. |
| Abyss | Se interpretó el campo `media` y la construcción `/sora/` del modo MP4 nativo del cliente. Se probaron `YM4vDg2WFD` y el reciente `ZMU6P4W50Y`: las URLs MP4 construidas devuelven 404. El otro modo usa Service Worker y rutas de fragmentos; sus URLs aparentes de `storage.googleapis.com/mediastorage` son rutas virtuales, no MP4 descargables. | Se conserva iframe; no se añade un extractor que solo entregue enlaces 404. El transporte por fragmentos queda sin resolver. |

El codec AES-CBC de Epsilon es formato de transporte del cliente público, no DRM. La app lo implementa con WebCrypto y valida respuesta/manifiesto; no usa `eval`, scripts remotos, anuncios ni configuración de seguimiento. Las URLs se resuelven de nuevo al abrir cada episodio porque caducan.

HLS usa AVPlay cuando `webapis.avplay` está disponible. Samsung documenta el elemento `application/avplayer`, `prepareAsync`, coordenadas de pantalla 1920×1080 y tiempos en milisegundos. El adaptador convierte a segundos para los controles existentes, termina el seek inicial antes de iniciar playback y descarta callbacks al cerrar. No se añade un privilegio AVPlay obsoleto.

- [Uso de AVPlay y estados](https://developer.samsung.com/smarttv/develop/guides/multimedia/media-playback/using-avplay.html)
- [Streaming adaptativo en Samsung](https://developer.samsung.com/smarttv/develop/guides/multimedia/adaptive-streaming.html)

Estas pruebas de red se hicieron desde el Mac. No certifican las cabeceras, TLS, WebCrypto ni decodificación del WGT en la TV; los errores conservan la recuperación de calidad/servidor/iframe.

## Qué hace la aplicación

- Conserva las URLs firmadas y los fragmentos de los embeds; solo añade autoplay en el formato conocido de OK.
- Mantiene el bloqueo de popups y navegación de la página principal.
- Ofrece un modo de interacción de 15 segundos para que el iframe reciba el mando. Durante ese tiempo, el guardián de foco no interfiere. Al terminar recupera el mando de la app y mantiene el iframe abierto.
- Si Atrás llega a la aplicación durante ese modo, devuelve el control a la app. Los eventos dentro de otro origen no se propagan al padre: la recuperación por tiempo es necesaria y no garantiza que el proveedor soporte flechas u OK.
- El evento `load` se presenta como página abierta, nunca como reproducción confirmada. Un iframe puede dispararlo incluso si el contenido está bloqueado. No se cambia de servidor automáticamente por un supuesto bloqueo de video que no se puede observar.
- Permite abrir el servidor seleccionado o la lista de servidores en el navegador externo. Retira primero el iframe para que no continúe su audio. Deja Opciones abierto para reintentar cuando se regresa.
- No envía comandos `postMessage` inventados ni promete pausa, progreso, calidad o siguiente episodio dentro de proveedores sin una API documentada.

El navegador externo puede compartir limitaciones del motor: es una alternativa de interacción/origen, no una garantía de compatibilidad.

## Verificación

Pruebas automatizadas de cesión/recuperación de foco, limpieza de temporizadores, callbacks antiguos, URL firmada, sandbox y apertura externa. La prueba de navegador usa un iframe de otro origen con un botón Play: verifica que Enter llega, que el mando vuelve a los 15 segundos y que el panel sigue accesible. Es una prueba del mecanismo, no una certificación de Moon, Epsilon, Abyss o Mega en la TV.

## Pendiente

- Probar el WGT final en el televisor y capturar errores de cada proveedor con depuración disponible.
- Validar Epsilon/AVPlay en la TV; continuar con el transporte por fragmentos de Abyss y revisar Moon si ofrece reproducción sin verificación.
- Para iframe, progreso, cambio de calidad y reproducción automática del siguiente episodio requieren cooperación del proveedor o una fuente directa.
