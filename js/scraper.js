/**
 * scraper.js - Scraper nativo en JavaScript para AnimeYT y Mytsumi
 * Diseñado específicamente para Tizen OS:
 * - Resuelve todas las URLs relativas con resolveUrl()
 * - No usa headers prohibidos como User-Agent
 * - Usa credentials: 'include' para Cloudflare
 * - Parser DOM en memoria sin ejecución de scripts ni anuncios
 */
(function(window) {
    'use strict';

    const BASE_URL = 'https://animeyt.cc';

    /**
     * Resuelve de forma segura cualquier URL relativa respecto a la base
     * @param {string} path Ruta relativa o absoluta
     * @param {string} base URL base (por defecto animeyt.cc)
     * @returns {string} URL absoluta bien formada
     */
    function resolveUrl(path, base = BASE_URL) {
        if (!path || typeof path !== 'string') return '';
        const trimmed = path.trim();
        if (!trimmed) return '';
        if (trimmed.startsWith('javascript:') || trimmed.startsWith('#')) return '';
        try {
            return new URL(trimmed, base).href;
        } catch (e) {
            return trimmed;
        }
    }

    /**
     * Helpers null-safe (Tizen 5.5 = Chromium 69, no soporta el operador ?.)
     */
    function textOf(el) {
        return el && el.textContent ? el.textContent.trim() : '';
    }

    // Texto con espacio entre nodos hijos: "<h1>Ken deshita<span>Temporada 2</span></h1>" -> "Ken deshita Temporada 2"
    function joinedText(el) {
        if (!el) return '';
        return Array.from(el.childNodes)
            .map(n => n.textContent.trim())
            .filter(Boolean)
            .join(' ')
            .replace(/\s+/g, ' ');
    }

    function attrOf(el, name) {
        return el ? el.getAttribute(name) : null;
    }

    /**
     * Extrae la mejor URL de imagen de un elemento <img>
     */
    function extractImageUrl(imgElement, base = BASE_URL) {
        if (!imgElement) return '';
        let src = imgElement.getAttribute('data-src') ||
                  imgElement.getAttribute('data-lazy-src') ||
                  imgElement.getAttribute('src');

        // Si es un svg placeholder base64, buscar en srcset o noscript
        if (src && src.startsWith('data:image/svg')) {
            const srcset = imgElement.getAttribute('data-srcset') || imgElement.getAttribute('srcset');
            if (srcset) {
                const parts = srcset.split(',');
                const last = parts[parts.length - 1].trim().split(' ')[0];
                if (last && !last.startsWith('data:')) {
                    return resolveUrl(last, base);
                }
            }
        }

        if (!src || src.startsWith('data:')) {
            // Intentar noscript hermano o padre
            const parent = imgElement.parentElement;
            if (parent) {
                const noscript = parent.querySelector('noscript');
                if (noscript) {
                    const match = noscript.textContent.match(/src="([^"]+)"/);
                    if (match && match[1]) src = match[1];
                }
            }
        }

        return resolveUrl(src, base);
    }

    /**
     * Realiza un fetch limpio y parsea a Document HTML sin ejecutar scripts
     */
    // Caché de páginas ya descargadas (volver a Inicio o a una ficha es instantáneo)
    const PAGE_CACHE_TTL = 3 * 60 * 1000;
    const PAGE_CACHE_MAX = 25;
    const pageCache = new Map();

    // Lo que la app no usa (scripts, estilos, SVG, comentarios): quitarlo antes de parsear ahorra CPU del TV
    function slimHtml(html) {
        return html
            .replace(/<script\b[\s\S]*?<\/script>/gi, '')
            .replace(/<style\b[\s\S]*?<\/style>/gi, '')
            .replace(/<svg\b[\s\S]*?<\/svg>/gi, '')
            .replace(/<!--[\s\S]*?-->/g, '');
    }

    async function fetchCleanHTML(url) {
        const cached = pageCache.get(url);
        if (cached && Date.now() - cached.time < PAGE_CACHE_TTL) {
            return new DOMParser().parseFromString(cached.html, 'text/html');
        }

        // El CPU del TV es lento: timeout amplio y un reintento ante fallos de red o timeout
        const MAX_ATTEMPTS = 2;
        let lastError = null;

        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 25000);

            try {
                const response = await fetch(window.TVNet.url(url), {
                    method: 'GET',
                    headers: {
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                    },
                    credentials: window.TVNet.credentials(),
                    signal: controller.signal
                });

                if (!response.ok) {
                    // Un 404 es una respuesta definitiva (p. ej. página fuera de rango): no reintentar
                    const httpError = new Error(`HTTP ${response.status}`);
                    httpError.status = response.status;
                    clearTimeout(timeoutId);
                    throw httpError;
                }

                const raw = await response.text();
                // Página de verificación anti-bot del sitio (aparece si recibe muchas peticiones seguidas):
                // no se guarda en caché y se informa claro en vez de "no se encontró el reproductor"
                if (/request is being verified|One moment, please/i.test(raw) && raw.length < 30000) {
                    const busy = new Error('AnimeYT está verificando la conexión. Reintenta en unos segundos');
                    busy.status = 503;
                    throw busy;
                }
                const html = slimHtml(raw);
                clearTimeout(timeoutId);
                if (pageCache.size >= PAGE_CACHE_MAX) pageCache.delete(pageCache.keys().next().value);
                pageCache.set(url, { time: Date.now(), html: html });
                return new DOMParser().parseFromString(html, 'text/html');
            } catch (err) {
                clearTimeout(timeoutId);
                if (err.status === 404) throw err;
                lastError = err.name === 'AbortError' ? new Error('Tiempo de espera agotado') : err;
                console.error(`[TVScraper] Intento ${attempt} fallido para:`, url, err);
            }
        }

        throw lastError;
    }

    /**
     * ok.ru: el embed trae en data-options la metadata con el MP4 directo y el HLS.
     * Las URLs quedan firmadas para la IP y el User-Agent de quien pidió el embed (la propia tele).
     */
    async function resolveOkRu(embedUrl) {
        const doc = await fetchCleanHTML(embedUrl);
        const holder = doc.querySelector('[data-options]');
        if (!holder) {
            // ok.ru reemplaza el reproductor por un aviso cuando el video ya no existe o está bloqueado
            const text = doc.body ? doc.body.textContent : '';
            if (/не найдено|заблокирован|удален|not found|blocked/i.test(text)) {
                throw new Error('OK: el video fue eliminado o bloqueado en ok.ru');
            }
            throw new Error('ok.ru: no se encontró la metadata del video');
        }

        const options = JSON.parse(holder.getAttribute('data-options'));
        let metadata = options.flashvars && options.flashvars.metadata;
        if (typeof metadata === 'string') metadata = JSON.parse(metadata);
        if (!metadata) throw new Error('ok.ru: metadata vacía');

        const movie = metadata.movie || {};
        if (movie.status && movie.status !== 'OK') {
            throw new Error(`ok.ru: ${movie.statusText || movie.status}`);
        }

        // De mejor a peor calidad; MP4 progresivo es lo más compatible con el reproductor del TV.
        // Se parte de la calidad preferida en Ajustes y se baja si esa no existe.
        const QUALITY_ORDER = ['full', 'hd', 'sd', 'low', 'lowest', 'mobile'];
        const PREFERRED_START = { '1080p': 'full', '720p': 'hd', '480p': 'sd', '360p': 'low' };
        const settings = window.TVStorage ? window.TVStorage.getSettings() : {};
        const startIdx = Math.max(0, QUALITY_ORDER.indexOf(PREFERRED_START[settings.preferredQuality] || 'full'));
        const rank = (name) => {
            const i = QUALITY_ORDER.indexOf(name);
            if (i === -1) return 99;
            return i >= startIdx ? i - startIdx : 50 + (startIdx - i); // por debajo de la preferida antes que por encima
        };
        const videos = (metadata.videos || []).filter(v => v.url && !v.disallowed);
        videos.sort((a, b) => rank(a.name) - rank(b.name));

        if (videos.length) {
            const sources = videos.map(v => ({ url: v.url, type: 'video/mp4', quality: v.name, poster: movie.poster || '' }));
            return Object.assign({}, sources[0], { sources: sources });
        }
        if (metadata.ondemandHls) {
            return { url: metadata.ondemandHls, type: 'application/x-mpegURL', quality: 'hls', poster: movie.poster || '' };
        }
        throw new Error('ok.ru: el video no tiene fuentes reproducibles');
    }

    /**
     * Ficha de la serie a partir de la URL de un episodio:
     * /118228/anime/<serie>-capitulo-2/ -> /tv/<serie>/
     * (a veces el slug del episodio viene recortado y /tv/<corto>/ redirige al slug completo)
     */
    function animeUrlFromEpisode(episodeUrl) {
        const match = /\/anime\/(.+?)-(capitulo|episodio)-[\d-]+\/?$/i.exec(episodeUrl || '');
        return match ? `${BASE_URL}/tv/${match[1]}/` : '';
    }

    function seriesSlug(url) {
        const match = /\/tv\/([^/?#]+)/i.exec(url || '');
        return match ? match[1].toLowerCase() : '';
    }

    /**
     * ¿El episodio pertenece a esta serie? Compara slugs aceptando el slug recortado del episodio
     */
    function episodeBelongsTo(episodeAnimeUrl, seriesUrl) {
        const episodeSlug = seriesSlug(episodeAnimeUrl);
        const slug = seriesSlug(seriesUrl);
        if (!episodeSlug || !slug) return false;
        return slug === episodeSlug || slug.indexOf(episodeSlug + '-') === 0;
    }

    /**
     * Filtros reales del catálogo (los <select> del sitio), para no tener listas desactualizadas
     */
    const CATALOG_FILTERS = ['genero', 'estado', 'anio', 'temporada', 'orden'];

    function parseCatalogFilters(doc) {
        const result = [];
        CATALOG_FILTERS.forEach(function(name) {
            const select = doc.querySelector(`select[name="${name}"]`);
            if (!select) return;
            const options = Array.from(select.querySelectorAll('option')).map(function(o) {
                return { value: o.getAttribute('value') || '', label: textOf(o) };
            });
            if (options.length > 1) result.push({ name: name, options: options });
        });
        return result;
    }

    /**
     * Enlace directo a un archivo de video (p. ej. Omega = archive.org/download/.../x.mp4): se reproduce tal cual
     */
    async function resolveDirectFile(url) {
        const type = /\.m3u8(\?|#|$)/i.test(url) ? 'application/x-mpegURL'
            : /\.webm(\?|#|$)/i.test(url) ? 'video/webm'
            : 'video/mp4';
        return { url: url, type: type, quality: 'directo', poster: '' };
    }

    const DIRECT_RESOLVERS = [
        { pattern: /^https?:\/\/([^/]+\.)?ok\.ru\/videoembed\//i, resolve: resolveOkRu },
        // Excluye páginas de reproductor que terminan en .mp4 (p. ej. burstcloud.co/embed/.../x.mp4)
        { pattern: /^https?:\/\/(?![^?#]*\/embed\/)[^?#]+\.(mp4|m4v|webm|m3u8)(\?|#|$)/i, resolve: resolveDirectFile }
    ];

    function findDirectResolver(url) {
        for (let i = 0; i < DIRECT_RESOLVERS.length; i++) {
            if (DIRECT_RESOLVERS[i].pattern.test(url || '')) return DIRECT_RESOLVERS[i];
        }
        return null;
    }

    /**
     * Texto crudo de una página (los <script> traen datos: lista de servidores, calidades)
     */
    async function fetchRawText(url) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 25000);
        try {
            const base = window.TVNet.url(url);
            // El proxy de TizenBrew quita los <script> del HTML: pedirle el texto sin tocar
            const target = base !== url ? base + '&raw=1' : base;
            const response = await fetch(target, { credentials: window.TVNet.credentials(), signal: controller.signal });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.text();
        } finally {
            clearTimeout(timeoutId);
        }
    }

    /**
     * Servidores del formato multiplayer: options.php (botón ▶ con la URL real en base64) -> contenedor.php
     * con la lista en "const videoTabs = [...]"
     */
    async function getMultiServers(optionsUrl) {
        const options = await fetchRawText(optionsUrl);
        const encoded = /azakuEncodedURL\s*=\s*["']([A-Za-z0-9+/=]+)["']/.exec(options);
        const containerUrl = encoded ? atob(encoded[1]) : '';
        if (!containerUrl) throw new Error('No se encontró la lista de servidores (multiplayer)');

        const page = await fetchRawText(containerUrl);
        const tabsMatch = /const\s+videoTabs\s*=\s*(\[[\s\S]*?\]);/.exec(page);
        if (!tabsMatch) throw new Error('El reproductor no trae servidores');
        const tabs = JSON.parse(tabsMatch[1]);

        const servers = tabs
            .filter(t => t.url && t.status !== 'inactive')
            .map((t, index) => ({
                id: index,
                url: t.url,
                kind: 'iframe',
                label: t.tab_name || `Servidor ${index + 1}`,
                title: t.tab_name || `Servidor ${index + 1}`
            }));
        return { servers: servers, containerUrl: containerUrl };
    }

    /**
     * Servidor "Mytsumi" (mytsumi.com/multiplayer/play2026/player.php): un <video> con
     * "const qualities = {...}" apuntando a MP4 directos (archive.org)
     */
    async function resolveMytsumiPlayer(url) {
        const page = await fetchRawText(url);
        const match = /const\s+qualities\s*=\s*(\{[\s\S]*?\});/.exec(page);
        if (!match) throw new Error('Mytsumi: no se encontraron calidades');
        const qualities = JSON.parse(match[1]);
        const names = Object.keys(qualities);
        if (!names.length) throw new Error('Mytsumi: sin videos');

        const settings = window.TVStorage ? window.TVStorage.getSettings() : {};
        const preferred = parseInt(settings.preferredQuality, 10) || 1080;
        // La mayor calidad que no supere la preferida; si todas la superan, la menor
        const height = n => parseInt(n, 10) || 0;
        const sorted = names.slice().sort((a, b) => height(b) - height(a));
        const chosen = sorted.find(n => height(n) <= preferred) || sorted[sorted.length - 1];
        const ordered = sorted.filter(n => height(n) <= height(chosen))
            .concat(sorted.filter(n => height(n) > height(chosen)).reverse());
        const sources = ordered.filter(n => typeof qualities[n] === 'string' && /^https?:\/\//i.test(qualities[n]))
            .map(n => ({ url: qualities[n], type: /\.m3u8(\?|#|$)/i.test(qualities[n]) ? 'application/x-mpegURL' : 'video/mp4', quality: n, poster: '' }));
        if (!sources.length) throw new Error('Mytsumi: sin fuentes válidas');
        return Object.assign({}, sources[0], { sources: sources });
    }

    DIRECT_RESOLVERS.push({ pattern: /^https?:\/\/(www\.)?mytsumi\.com\/multiplayer\/play\d*\/player\.php/i, resolve: resolveMytsumiPlayer });

    // Codec de transporte del cliente público de Epsilon, no una licencia DRM.
    // Se usa la API de datos; nunca se evalúa JavaScript recibido del proveedor.
    async function resolveEpsilon(url) {
        const origin = 'https://ytplay.rpmvid.com';
        const id = new URL(url).hash.slice(1);
        const subtle = window.crypto && window.crypto.subtle;
        if (!subtle) throw new Error('Epsilon: WebCrypto no disponible');
        const encoded = (await fetchRawText(origin + '/api/v1/video?id=' + encodeURIComponent(id) + '&w=1920&h=1080&r=')).trim();
        if (!encoded.length || encoded.length > 1000000 || encoded.length % 32 || !/^[0-9a-f]+$/i.test(encoded)) {
            throw new Error('Epsilon: formato de respuesta desconocido');
        }
        const bytes = new Uint8Array(encoded.length / 2);
        for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(encoded.substr(i * 2, 2), 16);
        const key = await subtle.importKey('raw', new Uint8Array([107,105,101,109,116,105,101,110,109,117,97,57,49,49,99,97]), 'AES-CBC', false, ['decrypt']);
        const plain = await subtle.decrypt({ name: 'AES-CBC', iv: new Uint8Array([49,50,51,52,53,54,55,56,57,48,111,105,117,121,116,114]) }, key, bytes);
        const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plain));
        // cfNative incluye las firmas que necesitan las variantes y los segmentos.
        // No usar "cf": requiere el transporte específico del reproductor web.
        const master = data && data.cfNative;
        if (typeof master !== 'string' || !/^https:\/\/[^\s]+\.m3u8(?:\?[^\s]*)?$/i.test(master)) {
            throw new Error('Epsilon: sin manifiesto nativo');
        }
        const manifest = await fetchRawText(master);
        if (!/^#EXTM3U\s/m.test(manifest)) throw new Error('Epsilon: manifiesto inválido');
        const lines = manifest.split(/\r?\n/);
        const sources = [];
        let height = 0;
        lines.forEach(function(line) {
            line = line.trim();
            if (/^#EXT-X-STREAM-INF:/.test(line)) {
                const resolution = /RESOLUTION=\d+x(\d+)/.exec(line);
                height = resolution ? parseInt(resolution[1], 10) : 0;
            } else if (line && line[0] !== '#' && height) {
                const child = new URL(line, master);
                if (child.protocol === 'https:') sources.push({ url: child.href, type: 'application/x-mpegURL', quality: height + 'p', poster: '' });
                height = 0;
            }
        });
        if (!sources.length) throw new Error('Epsilon: sin variantes nativas');
        const settings = window.TVStorage ? window.TVStorage.getSettings() : {};
        const preferred = parseInt(settings.preferredQuality, 10) || 1080;
        sources.sort(function(a, b) {
            const ah = parseInt(a.quality, 10), bh = parseInt(b.quality, 10);
            if ((ah <= preferred) !== (bh <= preferred)) return ah <= preferred ? -1 : 1;
            return ah <= preferred ? bh - ah : ah - bh;
        });
        return Object.assign({}, sources[0], { sources: sources });
    }

    DIRECT_RESOLVERS.push({ pattern: /^https:\/\/ytplay\.rpmvid\.com\/#[a-zA-Z0-9_-]+$/, resolve: resolveEpsilon });

    const TVScraper = {
        getMultiServers: getMultiServers,

        /**
         * Ranking del sitio: listas Top 10 (valorados, afecto, tendencias, vistas, comentarios, estrenos)
         * @param {string} periodo '7d' | '30d' | 'all'
         */
        getRanking: async function(periodo) {
            const doc = await fetchCleanHTML(`${BASE_URL}/ranking/?periodo=${encodeURIComponent(periodo || '7d')}`);
            const blocks = [];
            doc.querySelectorAll('section.aniyt-ranking-block').forEach(function(block) {
                const header = block.querySelector('header');
                const entries = [];
                block.querySelectorAll('li.aniyt-ranking-entry').forEach(function(li) {
                    const link = li.querySelector('a');
                    const url = resolveUrl(attrOf(link, 'href'));
                    const title = textOf(li.querySelector('.aniyt-ranking-copy strong'));
                    if (!url || !title) return;
                    // Las miniaturas vienen a 104x148: pedir una más grande al CDN de imágenes
                    const image = extractImageUrl(li.querySelector('.aniyt-ranking-poster img'))
                        .replace(/resize=\d+%2C\d+/i, 'resize=300%2C426');
                    entries.push({
                        rank: parseInt(textOf(li.querySelector('.aniyt-ranking-position')), 10) || entries.length + 1,
                        url: url,
                        title: title,
                        season: textOf(li.querySelector('.aniyt-ranking-copy small')),
                        metric: textOf(li.querySelector('.aniyt-ranking-metric')),
                        image: image
                    });
                });
                if (!entries.length) return;
                blocks.push({
                    id: block.id || '',
                    kicker: textOf(header && header.querySelector('span')),
                    title: textOf(header && header.querySelector('h2')),
                    desc: textOf(header && header.querySelector('p')),
                    entries: entries
                });
            });
            return blocks;
        },
        resolveUrl: resolveUrl,
        extractImageUrl: extractImageUrl,
        animeUrlFromEpisode: animeUrlFromEpisode,
        episodeBelongsTo: episodeBelongsTo,

        /**
         * ¿Este servidor se puede reproducir con el reproductor nativo (sin iframe ni anuncios)?
         */
        canPlayDirect: function(server) {
            return !!findDirectResolver(server && server.url);
        },

        /**
         * Obtiene la URL directa del video (MP4/HLS) de un servidor soportado
         */
        resolveDirectStream: async function(server) {
            const resolver = findDirectResolver(server && server.url);
            if (!resolver) throw new Error('Servidor sin soporte directo');
            return resolver.resolve(server.url);
        },

        /**
         * Obtiene los episodios destacados y últimos lanzamientos de la Home
         */
        getHomeContent: async function() {
            const doc = await fetchCleanHTML(BASE_URL + '/');

            // 1. Hero slides (destacados de la temporada)
            const heroSlides = [];
            const slides = doc.querySelectorAll('article.aniyt-hero-slide[data-aniyt-hero-slide]');
            slides.forEach(function(slide) {
                const titleEl = slide.querySelector('.aniyt-hero-content h2');
                const title = joinedText(titleEl);
                const desc = textOf(slide.querySelector('.aniyt-hero-content p')) || '';
                const imgEl = slide.querySelector('.aniyt-hero-art img');
                const image = extractImageUrl(imgEl).replace(/resize=1600%2C760/i, 'resize=1280%2C608');
                const viewBtn = slide.querySelector('.aniyt-hero-actions a.aniyt-button--primary');
                const url = resolveUrl(attrOf(viewBtn, 'href'));
                const epBtn = slide.querySelector('.aniyt-hero-actions a:not(.aniyt-button--primary)');
                const episodeUrl = resolveUrl(attrOf(epBtn, 'href'));

                if (title && url) {
                    heroSlides.push({
                        title: title,
                        description: desc,
                        image: image,
                        url: url,
                        episodeUrl: episodeUrl
                    });
                }
            });

            // 2. Últimos episodios publicados
            const latestEpisodes = [];
            const cards = doc.querySelectorAll('article.aniyt-episode-card[data-aniyt-episode-card]');
            cards.forEach(function(card) {
                const id = card.getAttribute('data-episode-id') || '';
                const search = card.getAttribute('data-episode-search') || '';
                const titleLink = card.querySelector('.aniyt-episode-card-title a');
                const mediaLink = card.querySelector('.aniyt-episode-media');
                const title = titleLink ? titleLink.textContent.trim() : '';
                const url = resolveUrl(mediaLink ? mediaLink.getAttribute('href') : (titleLink ? titleLink.getAttribute('href') : ''));
                const code = textOf(card.querySelector('.aniyt-card-code')) || '';
                const img = card.querySelector('.aniyt-episode-media img');
                const image = extractImageUrl(img);

                if (title && url) {
                    latestEpisodes.push({
                        id: id,
                        title: title,
                        search: search,
                        episode: code,
                        url: url,
                        animeUrl: animeUrlFromEpisode(url),
                        image: image
                    });
                }
            });

            return {
                hero: heroSlides,
                episodes: latestEpisodes
            };
        },

        /**
         * Obtiene el catálogo de animes con paginación y filtros
         */
        getCatalog: async function(page = 1, filters = {}) {
            let url = BASE_URL + '/tv/';
            if (page > 1) {
                url = `${BASE_URL}/tv/page/${page}/`;
            }

            const queryParams = new URLSearchParams();
            Object.keys(filters).forEach(function(key) {
                if (filters[key]) queryParams.set(key, filters[key]);
            });

            const queryString = queryParams.toString();
            if (queryString) {
                url += `?${queryString}`;
            }

            let doc;
            try {
                doc = await fetchCleanHTML(url);
            } catch (err) {
                // WordPress responde 404 cuando la página no existe para esos filtros: es "sin resultados"
                if (err.status === 404) {
                    return { animes: [], currentPage: page, hasNext: false };
                }
                throw err;
            }
            const cards = doc.querySelectorAll('article.aniyt-anime-card');
            const animes = [];

            cards.forEach(function(card) {
                const posterLink = card.querySelector('a.aniyt-anime-poster');
                const titleLink = card.querySelector('.aniyt-anime-body h3 a');
                const title = (titleLink ? titleLink.textContent.trim() : '') ||
                              (posterLink ? posterLink.getAttribute('aria-label') : '') ||
                              '';
                const animeUrl = resolveUrl(posterLink ? posterLink.getAttribute('href') : '');
                const imgEl = card.querySelector('.aniyt-anime-poster img');
                const image = extractImageUrl(imgEl);
                const type = textOf(card.querySelector('.aniyt-anime-type')) || 'TV';
                const score = textOf(card.querySelector('.aniyt-card-score')) || '';
                const season = textOf(card.querySelector('.aniyt-season-badge')) || '';

                if (title && animeUrl) {
                    animes.push({
                        title: title,
                        url: animeUrl,
                        image: image,
                        type: type,
                        score: score,
                        season: season
                    });
                }
            });

            // Verificación de página siguiente
            const nextLink = doc.querySelector('a.next.page-numbers');
            const hasNext = !!nextLink;

            return {
                animes: animes,
                currentPage: page,
                hasNext: hasNext,
                filters: parseCatalogFilters(doc)
            };
        },

        /**
         * Obtiene los detalles de un anime y su lista completa de episodios
         */
        getAnimeDetail: async function(animeUrl) {
            const cleanUrl = resolveUrl(animeUrl);
            const doc = await fetchCleanHTML(cleanUrl);

            // Información general
            const titleEl = doc.querySelector('.aniyt-detail-copy h1') || doc.querySelector('.aniyt-detail-hero h1');
            const title = joinedText(titleEl);
            const synopsisEl = doc.querySelector('.aniyt-detail-synopsis p');
            const synopsis = synopsisEl ? synopsisEl.textContent.trim() : 'Sin sinopsis disponible.';

            const posterImg = doc.querySelector('.aniyt-detail-poster img');
            const poster = extractImageUrl(posterImg);

            const backdropImg = doc.querySelector('.aniyt-detail-backdrop img');
            const backdrop = extractImageUrl(backdropImg);

            // Géneros e información
            const genres = [];
            const genreLinks = doc.querySelectorAll('.aniyt-detail-facts a');
            genreLinks.forEach(function(a) {
                const text = a.textContent.trim();
                if (text && !genres.includes(text)) genres.push(text);
            });

            // Lista de episodios
            const episodes = [];
            const episodeCards = doc.querySelectorAll('article.aniyt-episode-card[data-aniyt-episode-card]');
            episodeCards.forEach(function(card) {
                const id = card.getAttribute('data-episode-id') || '';
                const media = card.querySelector('.aniyt-episode-media');
                const titleLink = card.querySelector('.aniyt-episode-card-title a');
                const epUrl = resolveUrl(media ? media.getAttribute('href') : (titleLink ? titleLink.getAttribute('href') : ''));
                const epTitle = titleLink ? titleLink.textContent.trim() : '';
                const code = textOf(card.querySelector('.aniyt-card-code')) || '';
                const img = card.querySelector('.aniyt-episode-media img');
                const image = extractImageUrl(img);

                if (epUrl) {
                    episodes.push({
                        id: id,
                        url: epUrl,
                        title: epTitle || code || 'Episodio',
                        episode: code,
                        image: image
                    });
                }
            });

            return {
                // URL canónica: el slug corto de un episodio redirige al largo; guardar siempre el mismo
                url: resolveUrl(attrOf(doc.querySelector('link[rel="canonical"]'), 'href')) || cleanUrl,
                title: title,
                synopsis: synopsis,
                poster: poster,
                backdrop: backdrop,
                genres: genres,
                malId: (function() {
                    const link = doc.querySelector('a[href*="myanimelist.net/anime/"]');
                    const match = link && /myanimelist\.net\/anime\/(\d+)/.exec(link.getAttribute('href') || '');
                    return match ? parseInt(match[1], 10) : null;
                })(),
                episodes: episodes
            };
        },

        /**
         * Obtiene la información del contenedor de video desde la página del episodio
         */
        getEpisodeContainer: async function(episodeUrl) {
            const cleanUrl = resolveUrl(episodeUrl);
            const doc = await fetchCleanHTML(cleanUrl);

            const playerShell = doc.querySelector('[data-aniyt-player]');
            const iframe = playerShell ? playerShell.querySelector('iframe') : null;
            const iframeSrc = iframe ? (iframe.getAttribute('data-src') || iframe.getAttribute('src') || '') : '';

            // Extraer el container ID de Mytsumi
            // Ejemplo: https://mytsumi.com/container.php?id=WhZd-2j3LYGPBucG&only=SUB&lang=SUB
            let containerId = '';
            let lang = 'SUB';
            let only = 'SUB';
            // Formato alternativo (series más antiguas): mytsumi.com/multiplayer/options.php?server=multi&value=<id>
            let multiOptionsUrl = '';

            if (iframeSrc && /\/multiplayer\/options\.php/i.test(iframeSrc)) {
                multiOptionsUrl = resolveUrl(iframeSrc, 'https://mytsumi.com');
            } else if (iframeSrc) {
                try {
                    const parsedUrl = new URL(iframeSrc, 'https://mytsumi.com');
                    containerId = parsedUrl.searchParams.get('id') || '';
                    lang = parsedUrl.searchParams.get('lang') || 'SUB';
                    only = parsedUrl.searchParams.get('only') || 'SUB';
                } catch (e) {
                    const idMatch = iframeSrc.match(/[?&]id=([^&]+)/);
                    if (idMatch) containerId = idMatch[1];
                }
            }

            // Navegación del episodio: los enlaces se identifican por su nombre ("Anterior", "Siguiente", "Lista"),
            // no por posición (el primer episodio no tiene "Anterior" y el último no tiene "Siguiente")
            let prevUrl = null;
            let nextUrl = null;
            let listUrl = null;
            doc.querySelectorAll('.aniyt-watch-nav a').forEach(function(a) {
                const label = ((a.getAttribute('aria-label') || '') + ' ' + textOf(a)).toLowerCase();
                const href = resolveUrl(a.getAttribute('href'));
                if (!href) return;
                if (label.indexOf('anterior') !== -1) prevUrl = href;
                else if (label.indexOf('siguiente') !== -1) nextUrl = href;
                else if (label.indexOf('lista') !== -1) listUrl = href.split('#')[0];
            });

            const title = textOf(doc.querySelector('h1')) ||
                          doc.title.replace(/\s+Sub Español.*$/i, '').replace(/\s+-\s+AnimeYT$/i, '').trim();
            const synopsis = textOf(doc.querySelector('.aniyt-watch-synopsis-scroll p')) || '';
            const backdrop = resolveUrl(attrOf(playerShell, 'data-aniyt-context-backdrop'));

            return {
                episodeUrl: cleanUrl,
                title: title,
                synopsis: synopsis,
                backdrop: backdrop,
                containerId: containerId,
                multiOptionsUrl: multiOptionsUrl,
                lang: lang,
                only: only,
                prevUrl: prevUrl,
                nextUrl: nextUrl,
                listUrl: listUrl
            };
        },

        /**
         * Extrae los servidores de video limpios desde el contenedor de Mytsumi
         * Saltándose el reproductor intermedio y los anuncios
         */
        getVideoServers: async function(containerId, lang = 'SUB', only = 'SUB') {
            if (!containerId) {
                throw new Error('Container ID requerido para consultar Mytsumi');
            }

            const mytsumiUrl = `https://mytsumi.com/container.php?id=${encodeURIComponent(containerId)}&open=1&lang=${encodeURIComponent(lang)}&only=${encodeURIComponent(only)}`;
            const doc = await fetchCleanHTML(mytsumiUrl);

            const serverTabs = doc.querySelectorAll('button.mytsumi-tab[data-player-url]');
            const rawServers = [];

            serverTabs.forEach(function(tab, index) {
                const url = tab.getAttribute('data-player-url') || '';
                const kind = tab.getAttribute('data-player-kind') || 'iframe';
                const label = tab.getAttribute('data-player-label') || `Servidor ${index + 1}`;
                const title = tab.getAttribute('title') || label;

                if (url) {
                    rawServers.push({
                        id: index,
                        url: url,
                        kind: kind,
                        label: label,
                        title: title
                    });
                }
            });

            // Enlaces de descarga opcionales
            const downloads = {};
            const qualityPanels = doc.querySelectorAll('[data-quality-panel]');
            qualityPanels.forEach(function(panel) {
                const quality = panel.getAttribute('data-quality-panel') || 'default';
                downloads[quality] = [];
                const buttons = panel.querySelectorAll('a.mytsumi-download-button');
                buttons.forEach(function(btn) {
                    const dlUrl = btn.getAttribute('href');
                    const dlLabel = textOf(btn.querySelector('.mytsumi-download-label')) || 'Descarga';
                    if (dlUrl) {
                        downloads[quality].push({ url: dlUrl, label: dlLabel });
                    }
                });
            });

            return {
                servers: rawServers,
                downloads: downloads
            };
        }
    };

    window.TVScraper = TVScraper;
})(window);
