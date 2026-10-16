# AnimeYT TV

Aplicación WGT para Samsung TV. La versión 1.9.0 usa HTML5 para MP4 y AVPlay para HLS cuando Samsung lo ofrece. Está pensada para el equipo objetivo: The Frame Full HD 2020, Tizen 5.5 / Chromium 69.

## Cambios 1.9.0

- Continuar viendo sigue la serie: al completar un episodio (95 % o marca de visto) ofrece el siguiente no visto. Al ponerse al día desaparece y vuelve si la ficha publica otro capítulo. No recupera capítulos viejos a medias detrás del último completado.
- Mi lista se comprueba contra fichas completas, no solo los estrenos de Inicio. Muestra NUEVO EP y cantidad sin ver. Consultas en segundo plano de dos en dos, caché de 15 minutos, sin aplicar respuestas a vistas abandonadas.
- Saltar introducción/resumen con OK durante intervalos de AniSkip. Identificación por MAL explícito o coincidencia exacta y única de título en AniList; nunca el primer resultado aproximado. Solo en video directo y con duración compatible (±2 s). Los tiempos se reutilizan entre fuentes compatibles del mismo episodio.
- El botón verde conserva el avance manual de 85 s cuando no hay intervalo. Ya no se etiqueta ese avance como detección real de introducción.

Ver [continuidad, estrenos y tiempos](docs/continuity-and-skip.md).

## Cambios 1.8.0

- Extracción directa de Epsilon mediante su API pública y manifiesto `cfNative`, con variantes 720p/1080p según lo disponible. Conserva las firmas de cada URL y respeta la calidad preferida.
- Adaptador AVPlay para HLS en Samsung: preparación asíncrona, pausa, reanudación, avance, progreso, cierre y recuperación ante errores. MP4 mantiene HTML5. En equipos sin AVPlay se intenta HTML5 y se conserva la recuperación existente.
- La extracción de Epsilon, su manifiesto y un fragmento MP4 se verificaron por red. La reproducción HLS y AVPlay en el televisor físico siguen pendientes.
- Moon y Abyss conservan iframe: las pruebas no entregaron una fuente directa utilizable. Ver detalles de las verificaciones y respuestas HTTP en la investigación.

## Cambios 1.7.1

- Control temporal del iframe con el mando y recuperación automática a los 15 s.
- Acciones visibles para activar el control, cambiar servidor y abrirlo en el navegador.
- URLs de embeds conservadas, mensajes de carga sin afirmar que el video inició y limpieza al abrir el navegador externo.
- Aviso de posibles incompatibilidades del motor en proveedores investigados.

Ver [investigación y límites de compatibilidad](docs/iframe-compatibility.md).

## Cambios 1.7.0

- Recuperación de fuentes directas que fallan o dejan de avanzar durante 20 segundos: otra calidad, otro servidor directo y, finalmente, iframe.
- Calidad, reintento, episodio anterior y siguiente accesibles desde Opciones con el mando. El panel se desplaza para mantener visible el foco.
- Conservación de posición entre fuentes directas al cambiar de servidor o calidad.
- Historial de los últimos 50 episodios, con eliminación individual. Quitar una entrada borra su progreso, pero conserva favoritos y la marca de visto. El historial antiguo no puede recuperar episodios que las versiones anteriores ya descartaron.
- Filtro por número exacto o título y orden de episodios en la ficha. El filtro utiliza un campo de texto con el teclado del TV.
- Invalidación de cargas y búsquedas antiguas, errores de búsqueda diferenciados y Ranking opcional sin bloquear Inicio.

## Verificación y empaquetado

```sh
npm test
./build-wgt.sh
```

Las pruebas usan `node:test`, sin instalar dependencias. El empaquetado requiere el SDK y el perfil de firma `AnimeYT` existente. El resultado es `dist/AnimeYTTV-1.9.0.wgt`. El script no instala ni publica la aplicación. Los logs hacia el Mac son opcionales con `DEV_LOGS=1`.

## Límites

La selección de calidad, conservación de posición y recuperación automática se aplican al video directo. Un iframe externo no expone necesariamente su reproducción a la app; se puede reintentar manualmente o abrir el navegador del TV.

Los extractores directos son OK, Mytsumi, Epsilon y enlaces de archivo/playlist reconocidos. Moon, Abyss y Mega conservan su respaldo web. Epsilon requiere WebCrypto disponible en el WGT y entrega HLS, cuya reproducción física aún no está validada. Las URLs temporales y los formatos pueden cambiar en los proveedores.

Las pruebas locales cubren lógica y navegación de interfaz. Falta validar el WGT final en el televisor físico; no se instaló como parte de estos cambios.
