/**
 * ui.js - Renderizado de las vistas estilo Netflix para Smart TV (lienzo 1280x720)
 * Vistas: Inicio (billboard + filas), Búsqueda, Catálogo, Ficha, Mi lista, Reproductor y Ajustes
 */
(function(window) {
    'use strict';

    const APP_VERSION = '1.3.2';

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

    function cssUrl(url) {
        return url ? `url('${String(url).replace(/'/g, '%27')}')` : 'none';
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
                <div class="card-thumb" style="background-image: ${cssUrl(ep.image)}">
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
        const sub = [anime.type, anime.score ? `★ ${anime.score}` : (anime.rating ? `★ ${anime.rating}` : ''), anime.season || anime.status]
            .filter(Boolean).join(' · ');
        return `
            <button type="button" class="card card-poster" data-focusable="true" data-action="open-anime"
                data-url="${esc(anime.url)}"
                data-bb-title="${esc(anime.title)}" data-bb-meta="${esc(sub)}" data-bb-image="${esc(anime.image || '')}" data-bb-kicker="Anime">
                <div class="card-thumb" style="background-image: ${cssUrl(anime.image)}">${badge}</div>
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
    function newEpisodesFor(favoriteUrl, latestEpisodes) {
        return (latestEpisodes || []).filter(ep =>
            window.TVScraper.episodeBelongsTo(ep.animeUrl, favoriteUrl) && !isWatched(ep.url));
    }

    function favoritePosters(latestEpisodes) {
        const favorites = window.TVStorage ? window.TVStorage.getFavorites() : [];
        return favorites.map(f => {
            const fresh = newEpisodesFor(f.url, latestEpisodes);
            return posterCard({ url: f.url, title: f.title, image: f.image, newEpisode: fresh.length ? fresh[0].episode || 'EP' : '' });
        }).join('');
    }

    function row(title, cardsHtml) {
        if (!cardsHtml) return '';
        return `
            <section class="row" data-nav-row>
                <h2 class="row-title">${esc(title)}</h2>
                <div class="row-viewport">
                    <div class="row-track" data-row-track>${cardsHtml}</div>
                </div>
            </section>
        `;
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

            // En el reproductor se oculta el header
            const header = document.getElementById('app-header');
            if (header) header.classList.toggle('hidden', viewName === 'watch');

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
        renderHome: function(data) {
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

            // Nuevos episodios de las series que sigues (Mi lista), aún sin ver
            const favorites = window.TVStorage ? window.TVStorage.getFavorites() : [];
            const followedNew = (data.episodes || []).filter(ep =>
                !isWatched(ep.url) && favorites.some(f => window.TVScraper.episodeBelongsTo(ep.animeUrl, f.url)));
            rows += row('Nuevos episodios de Mi lista', followedNew.map(ep => episodeCard({
                url: ep.url,
                title: ep.title,
                animeTitle: ep.title,
                episode: ep.episode,
                animeUrl: ep.animeUrl,
                image: ep.image
            }, { kicker: 'Nuevo en Mi lista' })).join(''));

            // Continuar viendo: historial con progreso a medias
            const history = window.TVStorage ? window.TVStorage.getHistory() : [];
            const continueCards = history
                .filter(h => {
                    const p = progressPercent(h.url);
                    return p > 0 && p < 95;
                })
                .slice(0, 15)
                .map(h => episodeCard({
                    url: h.url,
                    title: h.title,
                    animeTitle: h.title,
                    episode: h.episode && h.episode !== h.title ? h.episode : '',
                    animeUrl: h.animeUrl,
                    image: h.image
                }, { kicker: 'Continuar viendo' }))
                .join('');
            rows += row('Continuar viendo', continueCards);

            const latestCards = (data.episodes || []).map(ep => episodeCard({
                url: ep.url,
                title: ep.title,
                animeTitle: ep.title,
                episode: ep.episode,
                animeUrl: ep.animeUrl,
                image: ep.image
            }, { kicker: 'Nuevo episodio' })).join('');
            rows += row('Últimos episodios', latestCards);

            const featuredCards = heroes.map(h => `
                <button type="button" class="card card-wide" data-focusable="true" data-action="open-anime" data-url="${esc(h.url)}"
                    data-bb-kicker="Destacado" data-bb-title="${esc(h.title)}" data-bb-desc="${esc(h.description)}" data-bb-image="${esc(h.image)}">
                    <div class="card-thumb" style="background-image: ${cssUrl(h.image)}"></div>
                    <div class="card-body"><div class="card-title">${esc(h.title)}</div><div class="card-sub">Destacado de la temporada</div></div>
                </button>
            `).join('');
            rows += row('Destacados de la temporada', featuredCards);

            rows += row('Mi lista', favoritePosters(data.episodes));

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

            const episodeCards = episodes.map(ep => episodeCard({
                url: ep.url,
                title: ep.title,
                animeTitle: anime.title,
                episode: ep.episode,
                animeUrl: anime.url,
                image: ep.image || anime.backdrop || anime.poster
            }, { cardTitle: ep.episode || ep.title, cardSub: ep.title !== ep.episode ? ep.title : '' })).join('');

            container.innerHTML = `
                <div class="detail">
                    <div class="detail-backdrop" style="background-image: ${cssUrl(anime.backdrop || anime.poster)}"></div>
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
                        ${episodes.length ? `<div class="episode-grid">${episodeCards}</div>` : '<p class="empty-msg">Este anime aún no tiene episodios publicados.</p>'}
                    </div>
                </div>
            `;
        },

        /**
         * Episodio para el botón principal: el que quedó a medias, o el siguiente al último visto, o el primero
         */
        _resumeTarget: function(episodes) {
            if (!episodes.length) return null;
            let lastWatchedIdx = -1;
            for (let i = 0; i < episodes.length; i++) {
                const percent = progressPercent(episodes[i].url);
                if (percent > 0 && percent < 90 && !isWatched(episodes[i].url)) {
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
         * 5. MI LISTA
         */
        renderMyList: function() {
            const container = document.getElementById('mylist-content');
            if (!container) return;
            const favorites = window.TVStorage ? window.TVStorage.getFavorites() : [];
            container.innerHTML = favorites.length
                ? `<div class="poster-grid">${favoritePosters(this.latestEpisodes)}</div>`
                : '<p class="empty-msg">Tu lista está vacía. Abre un anime y elige “＋ Mi lista”, o pulsa ▼ → “★ Mi lista” mientras ves un episodio.</p>';
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
                                ${option('ok', 'OK · 1080p sin anuncios', settings.preferredServer)}
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
                            <li>En el video: OK pausa · ◀ ▶ 10 s · ⏪ ⏩ 30 s · Verde salta la intro · ▼ servidores · CH+/CH− episodio</li>
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
