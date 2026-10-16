/**
 * ui.js - Renderizado de las vistas estilo Netflix para Smart TV (lienzo 1280x720)
 * Vistas: Inicio (billboard + filas), Búsqueda, Catálogo, Ficha, Mi lista, Reproductor y Ajustes
 */
(function(window) {
    'use strict';

    const APP_VERSION = '1.9.1';

    // Fila de Inicio: posición vertical donde queda la fila enfocada (debajo del billboard compacto)
    const HOME_ROW_ANCHOR = 300;

    function esc(text) {
        return String(text == null ? '' : text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // Para CSS (style.backgroundImage). Comillas y paréntesis codificados: no rompen ni el CSS ni un atributo HTML
    function cssUrl(url) {
        return url ? `url('${String(url).replace(/'/g, '%27').replace(/"/g, '%22').replace(/[()]/g, encodeURIComponent)}')` : 'none';
    }

    function progressPercent(url) {
        const p = window.TVStorage ? window.TVStorage.getProgress(url) : null;
        if (!p || !p.duration) return 0;
        return Math.min(100, Math.round((p.time / p.duration) * 100));
    }

    function isWatched(url) {
        return window.TVStorage ? window.TVStorage.isWatched(url) : false;
    }

    /**
     * Tarjeta 16:9 de episodio
     */
    function episodeCard(ep, opts) {
        const options = opts || {};
        const percent = progressPercent(ep.url);
        const watched = isWatched(ep.url);
        return `
            <button type="button" class="card card-wide" data-focusable="true" data-action="play-episode"
                data-url="${esc(ep.url)}" data-title="${esc(ep.animeTitle || ep.title)}" data-ep="${esc(ep.episode)}"
                data-anime-url="${esc(ep.animeUrl || '')}" data-img="${esc(ep.image || '')}"
                data-bb-title="${esc(ep.animeTitle || ep.title)}" data-bb-meta="${esc(options.meta || ep.episode || '')}"
                data-bb-desc="${esc(options.desc || '')}" data-bb-image="${esc(ep.image || '')}" data-bb-kicker="${esc(options.kicker || 'Episodio')}">
                <div class="card-thumb" data-bg="${esc(ep.image || '')}">
                    ${ep.episode ? `<span class="card-badge">${esc(ep.episode)}</span>` : ''}
                    ${watched ? '<span class="card-watched">✓ VISTO</span>' : ''}
                    ${percent > 0 && percent < 100 ? `<div class="card-progress"><div class="card-progress-fill" style="width: ${percent}%"></div></div>` : ''}
                </div>
                <div class="card-body">
                    <div class="card-title">${esc(options.cardTitle || ep.animeTitle || ep.title)}</div>
                    <div class="card-sub">${esc(options.cardSub || ep.episode || '')}</div>
                </div>
            </button>
        `;
    }

    /**
     * Tarjeta 2:3 de anime (póster)
     */
    function posterCard(anime) {
        const badge = anime.newEpisode ? `<span class="card-badge card-badge-new">NUEVO ${esc(anime.newEpisode)}</span>` : '';
        const score = String(anime.score || anime.rating || '').replace(/[★☆\s]+/g, ' ').trim();
        const sub = [anime.type, score ? `★ ${score}` : '', anime.season || anime.status]
            .filter(Boolean).concat(anime.notice || []).join(' · ');
        return `
            <button type="button" class="card card-poster" data-focusable="true" data-action="open-anime"
                data-url="${esc(anime.url)}"
                data-bb-title="${esc(anime.title)}" data-bb-meta="${esc(sub)}" data-bb-image="${esc(anime.image || '')}" data-bb-kicker="Anime">
                <div class="card-thumb" data-bg="${esc(anime.image || '')}">${badge}</div>
                <div class="card-body">
                    <div class="card-title">${esc(anime.title)}</div>
                    <div class="card-sub">${esc(sub)}</div>
                </div>
            </button>
        `;
    }

    /**
     * Episodios recientes de una serie de Mi lista que aún no se vieron
     */
    function favoritePosters() {
        const favorites = window.TVStorage ? window.TVStorage.getFavorites() : [];
        return favorites.map(f => {
            const state = window.TVSeries ? window.TVSeries.status(f.url) : null;
            return posterCard({ url: f.url, title: f.title, image: f.image,
                newEpisode: state && state.fresh ? state.latest.episode || 'EP' : '',
                notice: state ? (state.pending ? state.pending + ' sin ver' : 'Al día') : 'Sin comprobar' });
        }).join('');
    }

    function continueCards() {
        const entries = window.TVSeries ? window.TVSeries.continuing() : [];
        return entries.map(h => episodeCard(h, { kicker: 'Continuar viendo',
            cardSub: (h.resume ? 'Continuar · ' : 'Ver · ') + (h.episode || 'Siguiente episodio') })).join('');
    }

    function followedCards() {
        const favorites = window.TVStorage ? window.TVStorage.getFavorites() : [];
        return favorites.map(f => {
            const state = window.TVSeries ? window.TVSeries.status(f.url) : null;
            if (!state || !state.fresh) return '';
            return episodeCard(Object.assign({}, state.latest, { title: f.title, animeTitle: f.title, animeUrl: f.url }), { kicker: 'Nuevo en Mi lista' });
        }).join('');
    }

    function rankCard(e) {
        return `
            <button type="button" class="card card-rank" data-focusable="true" data-action="open-anime" data-url="${esc(e.url)}"
                data-bb-kicker="Top 10" data-bb-title="${esc(e.title)}" data-bb-meta="${esc([e.season, e.metric].filter(Boolean).join(' · '))}" data-bb-image="${esc(e.image || '')}">
                <span class="rank-number">${e.rank}</span>
                <span class="rank-poster" data-bg="${esc(e.image || '')}"></span>
                <span class="rank-info">
                    <span class="card-title">${esc(e.title)}</span>
                    <span class="card-sub">${esc([e.season, e.metric].filter(Boolean).join(' · '))}</span>
                </span>
            </button>
        `;
    }

    function row(title, cardsHtml, id) {
        if (!cardsHtml) return id ? `<section id="${id}" class="row" data-nav-row hidden></section>` : '';
        return `
            <section ${id ? `id="${id}"` : ''} class="row" data-nav-row>
                <h2 class="row-title">${esc(title)}</h2>
                <div class="row-viewport">
                    <div class="row-track" data-row-track>${cardsHtml}</div>
                </div>
            </section>
        `;
    }

    /**
     * Imágenes diferidas: cada tarjeta pide su imagen solo al acercarse a la pantalla
     * (Inicio tiene ~40 y una ficha puede tener 100+ episodios: cargarlas todas juntas traba el TV)
     */
    const imageObserver = ('IntersectionObserver' in window)
        ? new IntersectionObserver(function(entries) {
            entries.forEach(function(entry) {
                if (!entry.isIntersecting) return;
                const el = entry.target;
                el.style.backgroundImage = cssUrl(el.getAttribute('data-bg'));
                imageObserver.unobserve(el);
                pendingImages.delete(el);
            });
        }, { rootMargin: '300px' })
        : null;

    const pendingImages = new Set();
    function observeImages(root) {
        if (imageObserver) pendingImages.forEach(el => {
            if (!document.documentElement.contains(el)) {
                imageObserver.unobserve(el);
                pendingImages.delete(el);
            }
        });
        (root || document).querySelectorAll('[data-bg]:not([data-bg-ready])').forEach(function(el) {
            el.setAttribute('data-bg-ready', '1');
            if (!el.getAttribute('data-bg')) return;
            if (imageObserver) {
                pendingImages.add(el);
                imageObserver.observe(el);
            }
            else el.style.backgroundImage = cssUrl(el.getAttribute('data-bg'));
        });
    }

    const TVUI = {
        views: {},
        currentViewName: 'home',
        featured: null,
        latestEpisodes: [],

        init: function() {
            this.views = {
                home: document.getElementById('view-home'),
                search: document.getElementById('view-search'),
                catalog: document.getElementById('view-catalog'),
                anime: document.getElementById('view-anime'),
                mylist: document.getElementById('view-mylist'),
                history: document.getElementById('view-history'),
                ranking: document.getElementById('view-ranking'),
                watch: document.getElementById('view-watch'),
                settings: document.getElementById('view-settings')
            };
        },

        switchView: function(viewName) {
            Object.keys(this.views).forEach(name => {
                const el = this.views[name];
                if (el) el.classList.toggle('hidden', name !== viewName);
            });

            this.currentViewName = viewName;

            document.querySelectorAll('.header-nav-btn').forEach(btn => {
                btn.classList.toggle('is-active', btn.dataset.view === viewName);
            });

            // En el reproductor se oculta el header; fuera de Inicio va con fondo sólido (el contenido pasa por debajo)
            const header = document.getElementById('app-header');
            if (header) {
                header.classList.toggle('hidden', viewName === 'watch');
                header.classList.toggle('is-solid', viewName !== 'home');
            }

            const main = document.getElementById('app-main');
            if (main) {
                main.scrollTop = 0;
                main.style.overflowY = viewName === 'watch' ? 'hidden' : '';
            }
        },

        /**
         * Llamado por la navegación en cada cambio de foco
         */
        onFocus: function(element) {
            if (this.currentViewName !== 'home') return;
            const home = this.views.home;
            if (!home || !element) return;

            const focusedRow = element.closest('[data-nav-row]');
            // Las filas por encima de la enfocada se ocultan (quedarían encima del billboard)
            let above = !!focusedRow;
            home.querySelectorAll('[data-nav-row]').forEach(r => {
                if (r === focusedRow) above = false;
                r.classList.toggle('is-above', above);
            });

            if (focusedRow) {
                home.classList.add('is-browsing');
                this._setBillboard({
                    kicker: element.dataset.bbKicker,
                    title: element.dataset.bbTitle,
                    meta: element.dataset.bbMeta,
                    desc: element.dataset.bbDesc,
                    image: element.dataset.bbImage
                });
            } else {
                // Billboard o header: volver al destacado y subir las filas
                home.classList.remove('is-browsing');
                const inner = home.querySelector('.home-rows-inner');
                if (inner) inner.style.transform = '';
                if (this.featured) this._setBillboard(this.featured);
            }
        },

        _setBillboard: function(item) {
            const set = (id, value) => {
                const el = document.getElementById(id);
                if (el) el.textContent = value || '';
            };
            set('bb-kicker', item.kicker);
            set('bb-title', item.title);
            set('bb-meta', item.meta);
            set('bb-desc', item.desc);
            const image = document.getElementById('bb-image');
            if (image && item.image) image.style.backgroundImage = cssUrl(item.image);
        },

        /**
         * 1. INICIO
         */
        renderHome: function(data, ranking) {
            const container = document.getElementById('home-content');
            if (!container) return;

            this.latestEpisodes = data.episodes || [];
            const heroes = (data.hero || []).filter(h => h.image);
            const hero = heroes[0] || (data.hero || [])[0] || null;
            const firstEpisode = (data.episodes || [])[0];

            this.featured = hero ? {
                kicker: 'Destacado de la temporada',
                title: hero.title,
                meta: '',
                desc: hero.description,
                image: hero.image
            } : {
                kicker: 'Nuevo episodio',
                title: firstEpisode ? firstEpisode.title : 'AnimeYT',
                meta: firstEpisode ? firstEpisode.episode : '',
                desc: '',
                image: firstEpisode ? firstEpisode.image : ''
            };

            const favorite = hero && window.TVStorage ? window.TVStorage.isFavorite(hero.url) : false;
            const actions = hero ? `
                ${hero.episodeUrl ? `
                    <button type="button" class="btn btn-primary" data-focusable="true" data-action="play-episode"
                        data-url="${esc(hero.episodeUrl)}" data-title="${esc(hero.title)}" data-anime-url="${esc(hero.url)}" data-img="${esc(hero.image)}">▶ Ver</button>
                ` : ''}
                <button type="button" class="btn btn-secondary" data-focusable="true" data-action="open-anime" data-url="${esc(hero.url)}">ⓘ Más información</button>
                <button type="button" class="btn btn-secondary" data-focusable="true" data-action="toggle-favorite"
                    data-url="${esc(hero.url)}" data-title="${esc(hero.title)}" data-img="${esc(hero.image)}">${favorite ? '✓ En mi lista' : '＋ Mi lista'}</button>
            ` : '';

            // Filas
            let rows = '';

            rows += row('Continuar viendo', continueCards(), 'home-continue-row');
            rows += row('Nuevos episodios de Mi lista', followedCards(), 'home-followed-row');

            const latestCards = (data.episodes || []).map(ep => episodeCard({
                url: ep.url,
                title: ep.title,
                animeTitle: ep.title,
                episode: ep.episode,
                animeUrl: ep.animeUrl,
                image: ep.image
            }, { kicker: 'Nuevo episodio' })).join('');
            rows += row('Últimos episodios', latestCards);

            // Top 10 de la semana (lo más visto del ranking; si no está, la primera lista)
            rows += '<section id="home-ranking-row" class="row" data-nav-row hidden></section>';

            const featuredCards = heroes.map(h => `
                <button type="button" class="card card-wide" data-focusable="true" data-action="open-anime" data-url="${esc(h.url)}"
                    data-bb-kicker="Destacado" data-bb-title="${esc(h.title)}" data-bb-desc="${esc(h.description)}" data-bb-image="${esc(h.image)}">
                    <div class="card-thumb" data-bg="${esc(h.image || '')}"></div>
                    <div class="card-body"><div class="card-title">${esc(h.title)}</div><div class="card-sub">Destacado de la temporada</div></div>
                </button>
            `).join('');
            rows += row('Destacados de la temporada', featuredCards);

            rows += row('Mi lista', favoritePosters(), 'home-mylist-row');

            container.innerHTML = `
                <div class="billboard" id="home-billboard">
                    <div class="billboard-image" id="bb-image"></div>
                    <div class="billboard-shade"></div>
                    <div class="billboard-info">
                        <span class="billboard-kicker" id="bb-kicker"></span>
                        <h1 class="billboard-title" id="bb-title"></h1>
                        <div class="billboard-meta" id="bb-meta"></div>
                        <p class="billboard-desc" id="bb-desc"></p>
                        <div class="billboard-actions">${actions}</div>
                    </div>
                </div>
                <div class="home-rows" data-nav-scroller data-nav-anchor="${HOME_ROW_ANCHOR}">
                    <div class="home-rows-inner">
                        ${rows || '<p class="empty-msg" style="padding: 0 48px;">No se pudieron cargar los episodios.</p>'}
                    </div>
                </div>
            `;

            this.views.home.classList.remove('is-browsing');
            this._setBillboard(this.featured);
            observeImages(container);
        },

        renderHomeRanking: function(ranking) {
            const container = document.getElementById('home-ranking-row');
            const top = (ranking || []).find(block => block.id === 'ranking-vistos') || (ranking || [])[0];
            if (!container || !top) return;
            container.hidden = false;
            container.innerHTML = `<h2 class="row-title">Top 10 de la semana</h2><div class="row-viewport"><div class="row-track" data-row-track>${top.entries.map(rankCard).join('')}</div></div>`;
            observeImages(container);
        },

        /**
         * 2. BÚSQUEDA
         */
        renderSearchResults: function(results, query) {
            const container = document.getElementById('search-results-grid');
            const countEl = document.getElementById('search-results-count');
            if (!container) return;

            if (countEl) {
                countEl.textContent = results.length
                    ? `${results.length} resultados para "${query || ''}"`
                    : `Sin resultados para "${query || ''}". Prueba con el nombre en romaji o inglés.`;
            }
            container.innerHTML = (results || []).map(posterCard).join('');
            observeImages(container);
        },

        /**
         * Teclado de búsqueda propio: letras, ñ, números y espacio/borrar/limpiar
         */
        renderKeyboard: function() {
            const container = document.getElementById('search-keyboard');
            if (!container || container.dataset.ready) return;
            // a-z + 1-0 = 36 teclas: 6 filas exactas de 6 (los títulos van en romaji, no hace falta ñ)
            const keys = 'abcdefghijklmnopqrstuvwxyz1234567890'.split('');
            container.innerHTML = keys.map(k =>
                `<button type="button" class="kbd-key" data-focusable="true" data-action="kbd" data-key="${k}">${k}</button>`
            ).join('') + `
                <button type="button" class="kbd-key kbd-wide" data-focusable="true" data-action="kbd" data-key="space">␣ Espacio</button>
                <button type="button" class="kbd-key kbd-wide" data-focusable="true" data-action="kbd" data-key="back">⌫ Borrar</button>
                <button type="button" class="kbd-key kbd-wide" data-focusable="true" data-action="kbd" data-key="clear">✕ Limpiar</button>
            `;
            container.dataset.ready = '1';
        },

        setSearchQuery: function(query) {
            const el = document.getElementById('search-query-text');
            if (el) el.textContent = query;
        },

        setSearchStatus: function(text) {
            const el = document.getElementById('search-results-count');
            if (el) el.textContent = text;
        },

        /**
         * 3. CATÁLOGO
         */
        renderCatalogFilters: function(filters, current) {
            const form = document.getElementById('catalog-filters-form');
            if (!form || form.dataset.ready || !filters || !filters.length) return;

            const LABELS = { genero: 'Género', estado: 'Estado', anio: 'Año', temporada: 'Temporada', orden: 'Orden', tipo: 'Tipo' };
            const all = filters.concat([{
                name: 'tipo',
                options: [
                    { value: '', label: 'Todos los tipos' },
                    { value: 'tv', label: 'Series TV' },
                    { value: 'pelicula', label: 'Películas' },
                    { value: 'ova', label: 'OVAs' },
                    { value: 'especial', label: 'Especiales' }
                ]
            }]);

            form.innerHTML = all.map(f => `
                <div class="filter-group">
                    <label for="filter-${f.name}">${esc(LABELS[f.name] || f.name)}</label>
                    <select class="tv-select" id="filter-${f.name}" name="${esc(f.name)}">
                        ${f.options.map(o => `<option value="${esc(o.value)}" ${(current || {})[f.name] === o.value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
                    </select>
                </div>
            `).join('');
            form.dataset.ready = '1';
            window.TVPicker.enhanceAll(form);
        },

        renderCatalog: function(data) {
            const container = document.getElementById('catalog-results-grid');
            const paginationEl = document.getElementById('catalog-pagination');
            if (!container) return;

            if (!data.animes || !data.animes.length) {
                container.innerHTML = '<p class="empty-msg">No se encontraron animes con estos filtros.</p>';
                if (paginationEl) paginationEl.innerHTML = '';
                return;
            }

            container.innerHTML = data.animes.map(posterCard).join('');
            observeImages(container);

            if (paginationEl) {
                const page = data.currentPage || 1;
                paginationEl.innerHTML = `
                    ${page > 1 ? '<button type="button" class="btn btn-secondary" data-focusable="true" data-action="catalog-prev-page">◀ Anterior</button>' : ''}
                    <span class="page-indicator">Página ${page}</span>
                    ${data.hasNext ? '<button type="button" class="btn btn-secondary" data-focusable="true" data-action="catalog-next-page">Siguiente ▶</button>' : ''}
                `;
            }
        },

        /**
         * 4. FICHA DEL ANIME
         */
        renderAnimeDetail: function(anime) {
            const container = document.getElementById('anime-detail-content');
            if (!container) return;

            this.detailAnime = anime;
            this.episodeDescending = false;
            this.episodeQuery = '';
            // El sitio lista del más nuevo al más viejo; mostrar en orden (EP 1 primero)
            const episodes = (anime.episodes || []).slice().reverse();
            const resume = this._resumeTarget(episodes);
            const favorite = window.TVStorage ? window.TVStorage.isFavorite(anime.url) : false;

            const playButton = resume ? `
                <button type="button" class="btn btn-primary" data-focusable="true" data-action="play-episode" id="detail-play"
                    data-url="${esc(resume.episode.url)}" data-title="${esc(anime.title)}" data-ep="${esc(resume.episode.episode)}"
                    data-anime-url="${esc(anime.url)}" data-img="${esc(resume.episode.image || anime.backdrop || anime.poster)}">
                    ▶ ${esc(resume.label)}
                </button>
            ` : '';

            container.innerHTML = `
                <div class="detail">
                    <div class="detail-backdrop" style="background-image: ${esc(cssUrl(anime.backdrop || anime.poster))}"></div>
                    <div class="detail-shade"></div>
                    <div class="detail-header">
                        <img class="detail-poster" src="${esc(anime.poster || 'img/icon.png')}" alt="" />
                        <div class="detail-info">
                            <h1 class="detail-title">${esc(anime.title)}</h1>
                            <div class="detail-meta">
                                <span class="chip">${episodes.length} episodios</span>
                                ${(anime.genres || []).slice(0, 6).map(g => `<span class="chip">${esc(g)}</span>`).join('')}
                            </div>
                            <p class="detail-synopsis">${esc(anime.synopsis || 'Sin descripción disponible.')}</p>
                            <div class="detail-actions">
                                ${playButton}
                                <button type="button" class="btn btn-secondary" data-focusable="true" data-action="toggle-favorite"
                                    data-url="${esc(anime.url)}" data-title="${esc(anime.title)}" data-img="${esc(anime.poster)}">
                                    ${favorite ? '✓ En mi lista' : '＋ Mi lista'}
                                </button>
                            </div>
                        </div>
                    </div>
                    <div class="detail-episodes">
                        <h2 class="section-title">Episodios</h2>
                        <div class="episode-tools">
                            <input id="episode-search" class="search-input" type="search" data-focusable="true" placeholder="Buscar episodio por número o título" aria-label="Buscar episodio" />
                            <button type="button" class="btn btn-secondary" data-focusable="true" data-action="episode-order">Desde el episodio 1</button>
                        </div>
                        <p id="episode-count" class="page-subtitle"></p>
                        <div id="detail-episode-list" class="episode-grid"></div>
                    </div>
                </div>
            `;
            this.renderEpisodeList();
            observeImages(container);
        },

        renderEpisodeList: function(query) {
            const anime = this.detailAnime;
            const container = document.getElementById('detail-episode-list');
            if (!anime || !container) return;
            if (typeof query === 'string') this.episodeQuery = query;
            const filter = (this.episodeQuery || '').trim().toLowerCase();
            const episodes = (anime.episodes || []).slice();
            if (!this.episodeDescending) episodes.reverse();
            const numeric = /^\d+(?:[.,]\d+)?$/.test(filter);
            const matches = episodes.filter(ep => {
                if (!filter) return true;
                if (numeric) {
                    const numbers = String(ep.episode || ep.title || '').match(/\d+(?:[.,]\d+)?/g) || [];
                    return numbers.some(n => Number(n.replace(',', '.')) === Number(filter.replace(',', '.')));
                }
                return `${ep.episode || ''} ${ep.title || ''}`.toLowerCase().indexOf(filter) !== -1;
            });
            const count = document.getElementById('episode-count');
            if (count) count.textContent = `${matches.length} de ${episodes.length} episodios`;
            container.innerHTML = matches.length ? matches.map(ep => episodeCard({
                url: ep.url, title: ep.title, animeTitle: anime.title, episode: ep.episode,
                animeUrl: anime.url, image: ep.image || anime.backdrop || anime.poster
            }, { cardTitle: ep.episode || ep.title, cardSub: ep.title !== ep.episode ? ep.title : '' })).join('')
                : '<p class="empty-msg">No hay episodios que coincidan.</p>';
            observeImages(container);
        },

        renderHistory: function() {
            const container = document.getElementById('history-content');
            if (!container) return;
            const history = window.TVStorage.getHistory();
            container.innerHTML = history.length ? history.map(item => `
                <div class="history-item" data-history-url="${esc(item.url)}">
                    ${episodeCard({ url: item.url, title: item.title, animeTitle: item.title, episode: item.episode, animeUrl: item.animeUrl, image: item.image })}
                    <button type="button" class="btn btn-secondary" data-focusable="true" data-action="remove-history" data-url="${esc(item.url)}">Quitar del historial</button>
                </div>`).join('') : '<p class="empty-msg">Tu historial está vacío.</p>';
            observeImages(container);
        },

        /**
         * Episodio para el botón principal: el que quedó a medias, o el siguiente al último visto, o el primero
         */
        _resumeTarget: function(episodes) {
            if (!episodes.length) return null;
            let lastWatchedIdx = -1;
            for (let i = 0; i < episodes.length; i++) {
                const progress = window.TVStorage ? window.TVStorage.getProgress(episodes[i].url) : null;
                const percent = progress && progress.duration ? progress.time / progress.duration * 100 : 0;
                if (percent > 0 && percent < 95 && !isWatched(episodes[i].url)) {
                    return { episode: episodes[i], label: `Continuar ${episodes[i].episode || ''}`.trim() };
                }
                if (isWatched(episodes[i].url)) lastWatchedIdx = i;
            }
            if (lastWatchedIdx >= 0 && lastWatchedIdx + 1 < episodes.length) {
                const next = episodes[lastWatchedIdx + 1];
                return { episode: next, label: `Ver ${next.episode || 'siguiente'}` };
            }
            return { episode: episodes[0], label: `Ver ${episodes[0].episode || 'episodio 1'}` };
        },

        /**
         * RANKING: una fila por lista, con el puesto grande junto al póster (estilo "Top 10")
         */
        renderRanking: function(blocks, periodo) {
            const periods = document.getElementById('ranking-periods');
            const container = document.getElementById('ranking-content');
            if (!container || !periods) return;

            const PERIODS = [['7d', '7 días'], ['30d', '30 días'], ['all', 'Histórico']];
            periods.innerHTML = PERIODS.map(p => `
                <button type="button" class="btn ${p[0] === periodo ? 'btn-primary' : 'btn-secondary'}" data-focusable="true"
                    data-action="ranking-period" data-period="${p[0]}">${p[1]}</button>
            `).join('');

            if (!blocks || !blocks.length) {
                container.innerHTML = '<p class="empty-msg">No se pudo cargar el ranking.</p>';
                return;
            }

            container.innerHTML = blocks.map(block => {
                const cards = block.entries.map(rankCard).join('');
                return `
                    <section class="row ranking-row" data-nav-row>
                        <h2 class="row-title">${esc(block.title)} <small>${esc(block.desc)}</small></h2>
                        <div class="row-viewport">
                            <div class="row-track" data-row-track>${cards}</div>
                        </div>
                    </section>
                `;
            }).join('');
            observeImages(container);
        },

        /**
         * 5. MI LISTA
         */
        refreshPersonalized: function(myList) {
            const active = (window.appNavigation && window.appNavigation.currentFocus) || document.activeElement;
            const url = active && active.dataset ? active.dataset.url : '';
            let replaced = false, scope = null;
            if (myList) {
                scope = document.getElementById('mylist-content');
                replaced = !!(active && scope.contains(active));
                const html = window.TVStorage.getFavorites().length ? `<div class="poster-grid">${favoritePosters()}</div>` : '<p class="empty-msg">Tu lista está vacía.</p>';
                if (scope.innerHTML !== html) scope.innerHTML = html;
                else replaced = false;
                observeImages(scope);
            } else {
                const rows = [
                    ['home-continue-row', 'Continuar viendo', continueCards()],
                    ['home-followed-row', 'Nuevos episodios de Mi lista', followedCards()],
                    ['home-mylist-row', 'Mi lista', favoritePosters()]
                ];
                rows.forEach(item => {
                    const target = document.getElementById(item[0]);
                    if (!target) return;
                    const wrapper = document.createElement('div');
                    wrapper.innerHTML = row(item[1], item[2], item[0]);
                    const content = wrapper.firstElementChild;
                    if (target.innerHTML === content.innerHTML && target.hidden === content.hidden) return;
                    if (active && target.contains(active)) { replaced = true; scope = target; }
                    const track = target.querySelector('[data-row-track]');
                    const transform = track ? track.style.transform : '';
                    const viewport = target.querySelector('.row-viewport');
                    const left = viewport ? viewport.scrollLeft : 0;
                    target.innerHTML = content.innerHTML;
                    target.hidden = content.hidden;
                    const nextViewport = target.querySelector('.row-viewport');
                    if (nextViewport) nextViewport.scrollLeft = left;
                    const nextTrack = target.querySelector('[data-row-track]');
                    if (nextTrack) nextTrack.style.transform = transform;
                    observeImages(target);
                });
            }
            if (!replaced || !scope) return null;
            return Array.from(scope.querySelectorAll('[data-focusable="true"]')).find(el => el.dataset.url === url) || scope.querySelector('[data-focusable="true"]');
        },

        renderMyList: function() {
            const container = document.getElementById('mylist-content');
            if (!container) return;
            const favorites = window.TVStorage ? window.TVStorage.getFavorites() : [];
            container.innerHTML = favorites.length
                ? `<div class="poster-grid">${favoritePosters(this.latestEpisodes)}</div>`
                : '<p class="empty-msg">Tu lista está vacía. Abre un anime y elige “＋ Mi lista”, o pulsa ▼ → “★ Mi lista” mientras ves un episodio.</p>';
            observeImages(container);
        },

        /**
         * 7. AJUSTES
         */
        renderSettings: function() {
            const container = document.getElementById('settings-content');
            if (!container) return;

            const settings = window.TVStorage ? window.TVStorage.getSettings() : {};
            const history = window.TVStorage ? window.TVStorage.getHistory() : [];
            const watchedCount = window.TVStorage ? Object.keys(window.TVStorage.getWatched()).length : 0;
            const autoNext = !(settings.autoNext === false || settings.autoNext === 'false');

            const option = (value, label, current) =>
                `<option value="${value}" ${String(current) === value ? 'selected' : ''}>${label}</option>`;

            container.innerHTML = `
                <div class="settings-list">
                    <section class="settings-section">
                        <h2>Reproducción</h2>
                        <div class="setting-row">
                            <label for="setting-server">Servidor preferido<small>Se usa primero al abrir un episodio</small></label>
                            <select id="setting-server" class="tv-select" data-setting-key="preferredServer">
                                ${option('auto', 'Automático (OK primero)', settings.preferredServer)}
                                ${option('ok', 'OK · video directo', settings.preferredServer)}
                                ${option('abyss', 'Abyss · 1080p', settings.preferredServer)}
                                ${option('epsilon', 'Epsilon · 1080p', settings.preferredServer)}
                                ${option('byse', 'Byse · 720p', settings.preferredServer)}
                                ${option('alpha', 'Alpha · 720p', settings.preferredServer)}
                                ${option('mega', 'MEGA · 720p', settings.preferredServer)}
                            </select>
                        </div>
                        <div class="setting-row">
                            <label for="setting-quality">Calidad<small>Para servidores con video directo (OK)</small></label>
                            <select id="setting-quality" class="tv-select" data-setting-key="preferredQuality">
                                ${option('1080p', '1080p Full HD', settings.preferredQuality)}
                                ${option('720p', '720p HD', settings.preferredQuality)}
                                ${option('480p', '480p', settings.preferredQuality)}
                                ${option('360p', '360p (conexión lenta)', settings.preferredQuality)}
                            </select>
                        </div>
                        <div class="setting-row">
                            <label for="setting-autonext">Siguiente episodio automático<small>Cuenta regresiva de 10 s al terminar</small></label>
                            <select id="setting-autonext" class="tv-select" data-setting-key="autoNext">
                                ${option('true', 'Activado', autoNext)}
                                ${option('false', 'Desactivado', autoNext)}
                            </select>
                        </div>
                    </section>

                    <section class="settings-section">
                        <h2>Datos</h2>
                        <p class="settings-info">Episodios vistos: <strong>${watchedCount}</strong> · En historial: <strong>${history.length}</strong></p>
                        <div class="settings-actions">
                            <button type="button" class="btn btn-secondary" data-focusable="true" data-action="clear-watched">Borrar vistos</button>
                            <button type="button" class="btn btn-secondary" data-focusable="true" data-action="clear-history">Borrar historial</button>
                        </div>
                    </section>

                    <section class="settings-section">
                        <h2>Control remoto</h2>
                        <ul class="remote-legend">
                            <li><i class="dot red"></i> Rojo: Buscar · <i class="dot green"></i> Verde: Catálogo · <i class="dot yellow"></i> Amarillo: Ajustes</li>
                            <li><i class="dot blue"></i> Azul: marcar episodio visto / no visto</li>
                            <li>En el video: OK pausa · ◀ ▶ 10 s · ⏪ ⏩ 30 s · Verde avanza 85 s · OK salta la introducción si hay tiempos · ▼ servidores · CH+/CH− episodio</li>
                            <li>El volumen se maneja con los botones del TV</li>
                        </ul>
                    </section>

                    <section class="settings-section">
                        <h2>Acerca de</h2>
                        <p class="settings-info">AnimeYT TV ${APP_VERSION}</p>
                    </section>
                </div>
            `;

            window.TVPicker.enhanceAll(container);
        },

        showLoading: function(show, text) {
            const loader = document.getElementById('global-loader');
            const loaderText = document.getElementById('loader-text');
            if (loader) {
                if (loaderText) loaderText.textContent = text || 'Cargando...';
                loader.classList.toggle('hidden', !show);
            }
        },

        showToast: function(message, duration) {
            let toast = document.getElementById('app-toast');
            if (!toast) {
                toast = document.createElement('div');
                toast.id = 'app-toast';
                toast.className = 'app-toast';
                document.body.appendChild(toast);
            }
            toast.textContent = message;
            toast.classList.add('is-active');
            clearTimeout(this._toastTimer);
            this._toastTimer = setTimeout(() => toast.classList.remove('is-active'), duration || 2500);
        }
    };

    window.TVUI = TVUI;
})(window);
