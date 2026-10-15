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
    async function fetchCleanHTML(url) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 12000);
        const targetFetchUrl = window.TVNet.url(url);

        try {
            const response = await fetch(targetFetchUrl, {
                method: 'GET',
                headers: {
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                },
                credentials: window.TVNet.credentials(),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`HTTP Error ${response.status} en ${url}`);
            }

            const html = await response.text();
            const parser = new DOMParser();
            return parser.parseFromString(html, 'text/html');
        } catch (err) {
            clearTimeout(timeoutId);
            console.error('[TVScraper] Error al obtener HTML de:', url, err);
            throw err;
        }
    }

    const TVScraper = {
        resolveUrl: resolveUrl,
        extractImageUrl: extractImageUrl,

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
                const title = titleEl ? titleEl.textContent.trim().replace(/\s+/g, ' ') : '';
                const desc = textOf(slide.querySelector('.aniyt-hero-content p')) || '';
                const imgEl = slide.querySelector('.aniyt-hero-art img');
                const image = extractImageUrl(imgEl);
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
            if (filters.estado) queryParams.set('estado', filters.estado);
            if (filters.genero) queryParams.set('genero', filters.genero);
            if (filters.orden) queryParams.set('orden', filters.orden);
            if (filters.tipo) queryParams.set('tipo', filters.tipo);

            const queryString = queryParams.toString();
            if (queryString) {
                url += `?${queryString}`;
            }

            const doc = await fetchCleanHTML(url);
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
                hasNext: hasNext
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
            const title = titleEl ? titleEl.textContent.trim() : '';
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
                url: cleanUrl,
                title: title,
                synopsis: synopsis,
                poster: poster,
                backdrop: backdrop,
                genres: genres,
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

            if (iframeSrc) {
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

            // Datos de navegación del episodio
            const navLinks = doc.querySelectorAll('.aniyt-watch-nav a');
            let prevUrl = null;
            let listUrl = null;

            if (navLinks.length >= 2) {
                prevUrl = resolveUrl(attrOf(navLinks[0], 'href'));
                listUrl = resolveUrl(attrOf(navLinks[1], 'href'));
            } else if (navLinks.length === 1) {
                listUrl = resolveUrl(attrOf(navLinks[0], 'href'));
            }

            const title = textOf(doc.querySelector('.aniyt-watch-info h2')) ||
                          doc.title.split('·')[0].trim();
            const synopsis = textOf(doc.querySelector('.aniyt-watch-synopsis-scroll p')) || '';
            const backdrop = resolveUrl(attrOf(playerShell, 'data-aniyt-context-backdrop'));

            return {
                episodeUrl: cleanUrl,
                title: title,
                synopsis: synopsis,
                backdrop: backdrop,
                containerId: containerId,
                lang: lang,
                only: only,
                prevUrl: prevUrl,
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
