/**
 * ui.js - Renderizado de las 6 vistas completas para 10-foot UI en Smart TV
 * Vistas: Home, Search, Catalog con Filtros, Ficha Anime, Reproductor y Settings
 */
(function(window) {
    'use strict';

    const TVUI = {
        views: {},
        currentViewName: 'home',

        init: function() {
            this.views = {
                home: document.getElementById('view-home'),
                search: document.getElementById('view-search'),
                catalog: document.getElementById('view-catalog'),
                anime: document.getElementById('view-anime'),
                watch: document.getElementById('view-watch'),
                settings: document.getElementById('view-settings')
            };
        },

        switchView: function(viewName) {
            Object.keys(this.views).forEach(name => {
                const el = this.views[name];
                if (el) {
                    if (name === viewName) {
                        el.classList.remove('hidden');
                    } else {
                        el.classList.add('hidden');
                    }
                }
            });

            this.currentViewName = viewName;

            // Actualizar menú superior activo
            const navButtons = document.querySelectorAll('.header-nav-btn');
            navButtons.forEach(btn => {
                btn.classList.toggle('is-active', btn.dataset.view === viewName);
            });

            // En la vista de reproductor ocultamos el header principal
            const header = document.getElementById('app-header');
            if (header) {
                if (viewName === 'watch') {
                    header.classList.add('hidden');
                } else {
                    header.classList.remove('hidden');
                }
            }
        },

        /**
         * 1. VISTA HOME
         */
        renderHome: function(data) {
            const container = document.getElementById('home-content');
            if (!container) return;

            let html = '';

            // Hero destacados
            if (data.hero && data.hero.length > 0) {
                const hero = data.hero[0];
                html += `
                    <section class="home-hero" style="background-image: linear-gradient(to right, rgba(10,10,15,0.95) 30%, rgba(10,10,15,0.4)), url('${hero.image || ''}')">
                        <div class="hero-details">
                            <span class="hero-badge">DESTACADO DE LA TEMPORADA</span>
                            <h1 class="hero-title">${hero.title}</h1>
                            <p class="hero-desc">${hero.description || 'Disfruta de este estreno en AnimeYT.'}</p>
                            <div class="hero-actions">
                                <button type="button" class="btn btn-primary" data-focusable="true" data-action="open-anime" data-url="${hero.url}">
                                    ▶ Ver Ficha
                                </button>
                                ${hero.episodeUrl ? `
                                    <button type="button" class="btn btn-secondary" data-focusable="true" data-action="play-episode" data-url="${hero.episodeUrl}" data-title="${hero.title}">
                                        Ver Episodio
                                    </button>
                                ` : ''}
                            </div>
                        </div>
                    </section>
                `;
            }

            // Grid de últimos episodios
            html += `
                <section class="section-container">
                    <div class="section-header">
                        <h2>Últimos Episodios Emitidos</h2>
                        <span class="section-hint">Pulsa Enter para reproducir</span>
                    </div>
                    <div class="episodes-grid" id="home-episodes-grid">
            `;

            if (data.episodes && data.episodes.length > 0) {
                data.episodes.forEach(ep => {
                    const isWatched = window.TVStorage ? window.TVStorage.isWatched(ep.url) : false;
                    html += `
                        <article class="episode-card" data-focusable="true" data-action="play-episode" data-url="${ep.url}" data-title="${ep.title}" data-ep="${ep.episode}" data-img="${ep.image}">
                            <div class="episode-poster-wrap">
                                <img src="${ep.image || 'img/icon.png'}" alt="${ep.title}" loading="lazy" />
                                <span class="episode-tag">${ep.episode || 'EP'}</span>
                                ${isWatched ? '<span class="badge-watched">✓ VISTO</span>' : ''}
                                <div class="play-overlay">▶</div>
                            </div>
                            <div class="episode-meta">
                                <h3 class="episode-title">${ep.title}</h3>
                            </div>
                        </article>
                    `;
                });
            } else {
                html += '<p class="empty-msg">No se pudieron cargar los últimos episodios.</p>';
            }

            html += `
                    </div>
                </section>
            `;

            container.innerHTML = html;
        },

        /**
         * 2. VISTA BÚSQUEDA
         */
        renderSearchResults: function(results) {
            const container = document.getElementById('search-results-grid');
            const countEl = document.getElementById('search-results-count');
            if (!container) return;

            if (countEl) {
                countEl.textContent = results.length ? `${results.length} animes encontrados` : 'Sin resultados';
            }

            if (!results || !results.length) {
                container.innerHTML = `
                    <div class="empty-state">
                        <p>No se encontraron animes para este término.</p>
                        <span class="subtext">Prueba buscando en inglés o japonés (romaji)</span>
                    </div>
                `;
                return;
            }

            let html = '';
            results.forEach(anime => {
                html += `
                    <article class="anime-card" data-focusable="true" data-action="open-anime" data-url="${anime.url}">
                        <div class="anime-poster-wrap">
                            <img src="${anime.image || 'img/icon.png'}" alt="${anime.title}" loading="lazy" />
                            ${anime.rating ? `<span class="score-badge">★ ${anime.rating}</span>` : ''}
                            <span class="type-badge">${anime.type || 'TV'}</span>
                        </div>
                        <div class="anime-meta">
                            <h3 class="anime-title">${anime.title}</h3>
                            <span class="anime-sub">${anime.status || anime.season || ''}</span>
                        </div>
                    </article>
                `;
            });

            container.innerHTML = html;
        },

        /**
         * 3. VISTA CATÁLOGO CON FILTROS
         */
        renderCatalog: function(data, currentFilters = {}) {
            const container = document.getElementById('catalog-results-grid');
            const paginationEl = document.getElementById('catalog-pagination');
            if (!container) return;

            if (!data.animes || !data.animes.length) {
                container.innerHTML = '<p class="empty-msg">No se encontraron animes con los filtros seleccionados.</p>';
                return;
            }

            let html = '';
            data.animes.forEach(anime => {
                html += `
                    <article class="anime-card" data-focusable="true" data-action="open-anime" data-url="${anime.url}">
                        <div class="anime-poster-wrap">
                            <img src="${anime.image || 'img/icon.png'}" alt="${anime.title}" loading="lazy" />
                            ${anime.score ? `<span class="score-badge">★ ${anime.score}</span>` : ''}
                            <span class="type-badge">${anime.type || 'TV'}</span>
                        </div>
                        <div class="anime-meta">
                            <h3 class="anime-title">${anime.title}</h3>
                            <span class="anime-sub">${anime.season || ''}</span>
                        </div>
                    </article>
                `;
            });

            container.innerHTML = html;

            if (paginationEl) {
                const page = data.currentPage || 1;
                paginationEl.innerHTML = `
                    <button type="button" class="btn btn-secondary ${page <= 1 ? 'is-disabled' : ''}" data-focusable="true" data-action="catalog-prev-page" ${page <= 1 ? 'disabled' : ''}>
                        ◀ Anterior
                    </button>
                    <span class="page-indicator">Página ${page}</span>
                    <button type="button" class="btn btn-secondary ${!data.hasNext ? 'is-disabled' : ''}" data-focusable="true" data-action="catalog-next-page" ${!data.hasNext ? 'disabled' : ''}>
                        Siguiente ▶
                    </button>
                `;
            }
        },

        /**
         * 4. VISTA FICHA DE ANIME
         */
        renderAnimeDetail: function(anime) {
            const container = document.getElementById('anime-detail-content');
            if (!container) return;

            const episodes = anime.episodes || [];
            const hasEpisodes = episodes.length > 0;
            const firstEp = hasEpisodes ? episodes[episodes.length - 1] : null; // EP 1 suele ser el último en orden inverso
            const latestEp = hasEpisodes ? episodes[0] : null;

            let html = `
                <div class="anime-hero-backdrop" style="background-image: linear-gradient(to bottom, rgba(10,10,15,0.7), rgba(10,10,15,0.98)), url('${anime.backdrop || anime.poster || ''}')">
                    <div class="anime-detail-header">
                        <div class="anime-poster-col">
                            <img class="detail-poster" src="${anime.poster || 'img/icon.png'}" alt="${anime.title}" />
                        </div>
                        <div class="anime-info-col">
                            <h1 class="detail-title">${anime.title}</h1>
                            <div class="detail-genres">
                                ${(anime.genres || []).map(g => `<span class="genre-chip">${g}</span>`).join('')}
                            </div>
                            <p class="detail-synopsis">${anime.synopsis || 'Sin descripción disponible.'}</p>
                            <div class="detail-actions">
                                ${firstEp ? `
                                    <button type="button" class="btn btn-primary" data-focusable="true" data-action="play-episode" data-url="${firstEp.url}" data-title="${anime.title}" data-ep="${firstEp.episode}">
                                        ▶ Ver Episodio 1
                                    </button>
                                ` : ''}
                                ${latestEp && latestEp !== firstEp ? `
                                    <button type="button" class="btn btn-secondary" data-focusable="true" data-action="play-episode" data-url="${latestEp.url}" data-title="${anime.title}" data-ep="${latestEp.episode}">
                                        Último (${latestEp.episode})
                                    </button>
                                ` : ''}
                            </div>
                        </div>
                    </div>
                </div>

                <div class="section-container episodes-section">
                    <div class="section-header">
                        <h2>Episodios Disponibles (${episodes.length})</h2>
                        <span class="section-hint">Azul (F4): Marcar visto/no visto</span>
                    </div>
                    <div class="episodes-grid detail-episodes-grid">
            `;

            if (hasEpisodes) {
                episodes.forEach(ep => {
                    const isWatched = window.TVStorage ? window.TVStorage.isWatched(ep.url) : false;
                    html += `
                        <article class="episode-card" data-focusable="true" data-action="play-episode" data-url="${ep.url}" data-title="${anime.title}" data-ep="${ep.episode}" data-img="${ep.image || anime.poster}">
                            <div class="episode-poster-wrap">
                                <img src="${ep.image || anime.poster || 'img/icon.png'}" alt="${ep.title}" loading="lazy" />
                                <span class="episode-tag">${ep.episode || 'EP'}</span>
                                ${isWatched ? '<span class="badge-watched">✓ VISTO</span>' : ''}
                                <div class="play-overlay">▶</div>
                            </div>
                            <div class="episode-meta">
                                <h3 class="episode-title">${ep.title || ep.episode}</h3>
                            </div>
                        </article>
                    `;
                });
            } else {
                html += '<p class="empty-msg">No se encontraron episodios listados para esta obra.</p>';
            }

            html += `
                    </div>
                </div>
            `;

            container.innerHTML = html;
        },

        /**
         * 6. VISTA AJUSTES / SETTINGS
         */
        renderSettings: function() {
            const container = document.getElementById('settings-content');
            if (!container) return;

            const settings = window.TVStorage ? window.TVStorage.getSettings() : {};
            const history = window.TVStorage ? window.TVStorage.getHistory() : [];
            const watched = window.TVStorage ? window.TVStorage.getWatched() : {};
            const watchedCount = Object.keys(watched).length;

            let html = `
                <div class="settings-grid">
                    <div class="settings-card">
                        <h3>Preferencias de Reproducción</h3>

                        <div class="setting-item">
                            <label for="setting-server">Servidor Preferido:</label>
                            <select id="setting-server" class="tv-select" data-focusable="true" data-setting-key="preferredServer">
                                <option value="auto" ${settings.preferredServer === 'auto' ? 'selected' : ''}>Automático (OK.ru > Abyss > Byse)</option>
                                <option value="ok" ${settings.preferredServer === 'ok' ? 'selected' : ''}>OK.ru (1080p Full HD)</option>
                                <option value="abyss" ${settings.preferredServer === 'abyss' ? 'selected' : ''}>Abyss Player (1080p)</option>
                                <option value="epsilon" ${settings.preferredServer === 'epsilon' ? 'selected' : ''}>Epsilon (1080p)</option>
                                <option value="byse" ${settings.preferredServer === 'byse' ? 'selected' : ''}>Byse (720p)</option>
                                <option value="alpha" ${settings.preferredServer === 'alpha' ? 'selected' : ''}>Alpha / BurstCloud (720p)</option>
                                <option value="mega" ${settings.preferredServer === 'mega' ? 'selected' : ''}>MEGA</option>
                            </select>
                        </div>

                        <div class="setting-item">
                            <label for="setting-quality">Calidad Predeterminada:</label>
                            <select id="setting-quality" class="tv-select" data-focusable="true" data-setting-key="preferredQuality">
                                <option value="1080p" ${settings.preferredQuality === '1080p' ? 'selected' : ''}>1080p Full HD</option>
                                <option value="720p" ${settings.preferredQuality === '720p' ? 'selected' : ''}>720p HD</option>
                            </select>
                        </div>
                    </div>

                    <div class="settings-card">
                        <h3>Datos y Almacenamiento</h3>
                        <p class="settings-info">Capítulos vistos registrados: <strong>${watchedCount}</strong></p>
                        <p class="settings-info">Entradas en historial: <strong>${history.length}</strong></p>

                        <div class="settings-actions">
                            <button type="button" class="btn btn-secondary" data-focusable="true" data-action="clear-watched">
                                Borrar Episodios Vistos
                            </button>
                            <button type="button" class="btn btn-secondary" data-focusable="true" data-action="clear-history">
                                Borrar Historial
                            </button>
                        </div>
                    </div>

                    <div class="settings-card">
                        <h3>Acerca de AnimeYT TV</h3>
                        <p class="settings-info">Versión: <strong>1.0.0 (Tizen OS 4.0+)</strong></p>
                        <p class="settings-info">Arquitectura: <strong>Scraper nativo sin CORS + Sandboxed Iframe</strong></p>
                        <p class="settings-info">Protección: <strong>Bloqueo total de Pop-ups y Anuncios</strong></p>
                        <div class="remote-legend">
                            <h4>Atajos del Control Remoto:</h4>
                            <ul>
                                <li>🔴 <strong>Rojo (F1):</strong> Búsqueda rápida</li>
                                <li>🟢 <strong>Verde (F2):</strong> Catálogo con Filtros</li>
                                <li>🟡 <strong>Amarillo (F3):</strong> Selector de Servidores</li>
                                <li>🔵 <strong>Azul (F4):</strong> Marcar Visto</li>
                                <li>↩ <strong>Return (Esc):</strong> Volver / Salir de Video</li>
                            </ul>
                        </div>
                    </div>
                </div>
            `;

            container.innerHTML = html;
        },

        showLoading: function(show, text = 'Cargando contenido...') {
            const loader = document.getElementById('global-loader');
            const loaderText = document.getElementById('loader-text');
            if (loader) {
                if (loaderText) loaderText.textContent = text;
                loader.classList.toggle('hidden', !show);
            }
        },

        showToast: function(message, duration = 2500) {
            let toast = document.getElementById('app-toast');
            if (!toast) {
                toast = document.createElement('div');
                toast.id = 'app-toast';
                toast.className = 'app-toast';
                document.body.appendChild(toast);
            }
            toast.textContent = message;
            toast.classList.add('is-active');
            setTimeout(() => toast.classList.remove('is-active'), duration);
        }
    };

    window.TVUI = TVUI;
})(window);
