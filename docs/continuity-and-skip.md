# Continuidad y saltos — 1.9.0

## Continuar viendo y Mi lista

Se guarda un índice de episodios por ficha, incluyendo su URL canónica. Inicio y Mi lista lo consultan en segundo plano, con dos trabajadores y caché de 15 minutos. Salir de la vista detiene la programación de nuevas consultas; las solicitudes ya iniciadas pueden terminar y guardar caché, pero no cambian la vista abandonada. No se consulta con la app cerrada.

El episodio más reciente con progreso decide qué continuar. Se considera completado al 95 % o si está marcado como visto. Entonces se ofrece el siguiente disponible no visto de esa ficha; si no hay más, la serie sale de la fila y vuelve tras detectar un capítulo nuevo. Un servidor abierto sin progreso no desplaza el episodio que estaba a medias. Cuando no hay ficha guardada se puede usar el enlace Siguiente conocido, mientras se consulta la lista completa.

Mi lista compara las URLs disponibles con vistos/progreso, sin depender de la ventana de estrenos de Inicio. NUEVO EP indica que hay un episodio posterior al último con avance o marca de visto; no afirma que se haya publicado hoy. Las series sin avance muestran cantidad sin ver. Al día significa que todos los episodios conocidos están vistos; no significa que la serie haya finalizado. Un fallo de consulta conserva el último índice, y una respuesta vacía no borra una lista previamente verificada.

Los cambios de filas conservan la selección del mando y el desplazamiento horizontal. Los datos antiguos no pueden reconstruir progreso que nunca se guardó. Los iframes sin API no exponen posición; en ellos la marca manual de visto sigue siendo necesaria.

## Investigación de introducciones

- Moon/Byse: el bundle `videoPagesBundle-Bgi0QmPo.js` interpreta `skip_intro.from_seconds` y `skip_intro.to_seconds` en su respuesta de playback. Que el cliente contemple el campo no prueba que todos los videos tengan intervalos. Las muestras inspeccionadas exigen verificación o devuelven 403, por lo que no se incorporaron tiempos de ese servidor ni se eludió la verificación.
- Epsilon: las respuestas reales inspeccionadas no entregaron intervalos de introducción. El código contiene funciones de capítulos, sin metadatos de episodio utilizables en la muestra.
- Abyss: no se encontraron intervalos de introducción en los metadatos inspeccionados. No se afirma que nunca los ofrezca.
- AniSkip: se comprobó `GET /v2/skip-times/16498/1` con respuesta 200; devuelve opening 47.365–137.365 s para duración 1540.061 s. La app también verificó por red, desde el navegador de desarrollo, el mapeo exacto de Shingeki no Kyojin a MAL 16498 y mostró el aviso a los 50 s. El tiempo de reproducción se simuló; esta prueba no acredita reproducción física del episodio en la TV.

Fuentes primarias:

- [Cliente oficial de AniSkip: rutas y parámetros](https://github.com/aniskip/aniskip-extension/blob/main/src/api/aniskip-http-client/aniskip-http-client.ts)
- [Tipos oficiales: intervalos y duración de referencia](https://github.com/aniskip/aniskip-extension/blob/main/src/api/aniskip-http-client/aniskip-http-client.types.ts)
- [Documentación AniSkip](https://api.aniskip.com/api-docs)
- [AniList GraphQL](https://docs.anilist.co/guide/graphql/)

## Funcionamiento y límites del salto

La app obtiene el ID de MAL desde un enlace explícito de la ficha, o busca su título en AniList. Solo acepta una coincidencia normalizada exacta y única entre títulos y alias. La numeración se extrae de la URL del capítulo o su etiqueta; especiales decimales, títulos ambiguos y numeración sin correspondencia no generan un salto supuesto. No se implementaron reglas de redirección de episodios entre temporadas.

AniSkip se consulta para opening y recap usando la duración real del medio. Se aceptan intervalos finitos dentro del episodio cuya duración de referencia difiera como máximo dos segundos. No se desplaza todo el intervalo deduciendo un desfase a partir de la duración total: una diferencia puede estar al final, no al principio. Duración parecida es una comprobación útil, no una garantía de que dos montajes sean idénticos.

Los tiempos se guardan por MAL, episodio y duración, no por servidor; se reutilizan entre OK, Mytsumi, Epsilon o fuentes directas compatibles. El botón aparece solo dentro del intervalo, oculta el acceso durante Opciones o el aviso Siguiente y OK busca el segundo final. No salta automáticamente. Al cambiar de fuente se borran los segmentos activos y se descartan respuestas antiguas. El avance manual de 85 s con verde sigue disponible fuera del intervalo.

AniList y AniSkip son servicios externos: pueden carecer de datos, fallar o limitar solicitudes. Las consultas tienen timeout y caché; el video no espera a estas APIs para comenzar. Sin identificación o intervalo compatible no se muestra el botón. No se controla el salto de un iframe externo sin cooperación del proveedor.

Pendiente: validar tiempos, TLS, mando y reproducción en el WGT de la Samsung física. No se instaló ni publicó esta versión.
