/**
 * app.js - Orquestador principal y Router SPA para AnimeYT Tizen TV
 */
(function(window) {
    'use strict';

    class TVApp {
        constructor() {
            this.nav = null;
            this.player = null;
            this.viewStack = [];
            this.currentRoute = '';
            this.catalogFilters = {};
            this.catalogPage = 1;
            this.catalogHasNext = false;
            this.searchDebounceTimer = null;
        }

        async init() {
            console.log('[TVApp] Inicializando AnimeYT TV...');

            // 0. Escalar el lienzo de 1280x720 al tamaño real de la pantalla
            this._applyScale();
            window.addEventListener('resize', () => this._applyScale());

            // 1. Inicializar teclas Tizen y emulador PC
            if (window.TVKeys) {
                window.TVKeys.registerKeys();
            }

            // 2. Inicializar sistema UI
            window.TVUI.init();

            // 3. Inicializar navegación espacial
            this.nav = new window.TVNavigation();
            window.appNavigation = this.nav;

            // Configurar manejador de botón Atrás / Return
            this.nav.onBack = () => this.handleBack();

            // Configurar atajos de teclas de colores
            this.nav.onColorKey = (code) => this.handleColorKey(code);

            // El billboard de Inicio sigue a la tarjeta enfocada
            this.nav.onFocusChange = (element) => window.TVUI.onFocus(element);

            // 4. Inicializar reproductor de TV
            this.player = new window.TVPlayer({
                container: document.getElementById('player-viewport'),
                osdContainer: document.getElementById('player-osd'),
                serverBar: document.getElementById('player-server-bar'),
                serverList: document.getElementById('player-server-list'),
                titleEl: document.getElementById('player-title'),
                serverLabelEl: document.getElementById('player-current-server'),
                onEpisodeChange: (newUrl) => {
                    // Reemplazar (no apilar) para que Atrás vuelva a la ficha y no al episodio anterior
                    const ep = this.player.currentEpisode || {};
                    this.navigate(this._watchRoute({
                        url: newUrl,
                        title: ep.animeTitle || ep.title || '',
                        animeUrl: ep.animeUrl || '',
                        img: ep.image || ''
                    }), true);
                },
                onClose: () => {
                    this.handleBack();
                },
                onOpenSeries: (animeUrl) => {
                    // Reemplaza el reproductor en la pila: Atrás desde la ficha no vuelve al video
                    this.player.destroy();
                    this.navigate(`#/anime?url=${encodeURIComponent(animeUrl)}`, true);
                }
            });

            // 5. Configurar listeners de clicks y acciones UI
            this._setupActionListeners();

            // 6. En TizenBrew el proxy (service/proxy.js) arranca junto con la app: esperar a que responda
            if (window.TVNet) {
                await window.TVNet.waitForProxy();
            }

            // 7. Configurar listeners de hash routing
            window.addEventListener('hashchange', () => this._handleRoute());

            // 8. Cargar ruta inicial
            if (!window.location.hash) {
                window.location.hash = '#/';
            } else {
                this._handleRoute();
            }
        }

        /**
         * Manejador de botón Atrás del control remoto Samsung (10009)
         */
        _applyScale() {
            // Solo el ancho: el teclado en pantalla del TV reduce el alto de la ventana y la app se encogía
            const scale = window.innerWidth / 1280;
            if (scale === this._scale) return;
            this._scale = scale;
            document.body.style.transform = `scale(${scale})`;
        }

        handleBack() {
            // Un selector de opciones abierto se cierra primero
            if (window.TVPicker && window.TVPicker.isOpen()) {
                window.TVPicker.close(true);
                return;
            }

            // En el reproductor, Atrás primero cierra el panel de opciones
            if (this.currentRoute.startsWith('#/watch') && this.player.isServerBarVisible) {
                this.player.toggleServerBar();
                return;
            }

            // Si el reproductor está activo, cerrarlo
            if (this.currentRoute.startsWith('#/watch')) {
                this.player.destroy();
                this._popView();
                return;
            }

            // Si hay vistas previas en la pila, retroceder
            if (this.viewStack.length > 1) {
                this.viewStack.pop(); // Remover la actual
                const prevRoute = this.viewStack.pop(); // Obtener la anterior
                this.navigate(prevRoute);
                return;
            }

            // Si estamos en otra vista que no es home, volver a home
            if (this.currentRoute !== '#/') {
                this.navigate('#/');
                return;
            }

            // En Inicio: pedir confirmación (Atrás dos veces seguidas para salir)
            const now = Date.now();
            if (!this._exitArmedAt || now - this._exitArmedAt > 2500) {
                this._exitArmedAt = now;
                window.TVUI.showToast('Presiona Atrás otra vez para salir');
                return;
            }
            if (typeof tizen !== 'undefined' && tizen.application) {
                try {
                    tizen.application.getCurrentApplication().exit();
                } catch (e) {
                    console.log('[TVApp] Saliendo de Tizen...');
                }
            } else {
                window.TVUI.showToast('Presiona de nuevo para salir');
            }
        }

        /**
         * Manejador de teclas de colores Samsung
         */
        handleColorKey(code) {
            // En el reproductor los colores los maneja el propio reproductor (servidores, saltar intro, visto)
            if (this.currentRoute.startsWith('#/watch')) return;

            if (code === window.TVKeys.COLOR_RED) {
                // Rojo: Búsqueda rápida
                this.navigate('#/search');
            } else if (code === window.TVKeys.COLOR_GREEN) {
                // Verde: Catálogo
                this.navigate('#/catalog');
            } else if (code === window.TVKeys.COLOR_YELLOW) {
                // Amarillo: Ajustes
                this.navigate('#/settings');
            } else if (code === window.TVKeys.COLOR_BLUE) {
                // Azul: Marcar visto/no visto en tarjeta enfocada
                const focused = this.nav.currentFocus;
                if (focused && focused.dataset.url) {
                    const isNowWatched = window.TVStorage.toggleWatched(focused.dataset.url);
                    window.TVUI.showToast(isNowWatched ? '✓ Marcado como visto' : '○ Marcado como no visto');
                    // Actualizar la marca en la tarjeta
                    const badge = focused.querySelector('.card-watched');
                    if (isNowWatched && !badge) {
                        const thumb = focused.querySelector('.card-thumb');
                        if (thumb) thumb.insertAdjacentHTML('beforeend', '<span class="card-watched">✓ VISTO</span>');
                    } else if (!isNowWatched && badge) {
                        badge.remove();
                    }
                }
            }
        }

        /**
         * Navega a una ruta; con replace la ruta actual se reemplaza en la pila de "Atrás"
         */
        navigate(route, replace) {
            if (replace && this.viewStack.length) {
                this.viewStack.pop();
            }
            window.location.hash = route;
        }

        _watchRoute(params) {
            const query = Object.keys(params)
                .filter(k => params[k])
                .map(k => `${k}=${encodeURIComponent(params[k])}`)
                .join('&');
            return `#/watch?${query}`;
        }

        _popView() {
            if (this.viewStack.length > 1) {
                this.viewStack.pop();
                const prev = this.viewStack.pop();
                this.navigate(prev);
            } else {
                this.navigate('#/');
            }
        }

        /**
         * Enrutador SPA
         */
        async _handleRoute() {
            const hash = window.location.hash || '#/';

            // Salir del reproductor por cualquier camino (no solo con Atrás) debe detener el video
            if (this.currentRoute.startsWith('#/watch') && !hash.startsWith('#/watch') && this.player.isPlaying) {
                this.player.destroy();
            }
            this.currentRoute = hash;

            // Mantener historial de navegación para retroceso
            if (!this.viewStack.length || this.viewStack[this.viewStack.length - 1] !== hash) {
                this.viewStack.push(hash);
            }

            const parsed = this._parseHash(hash);

            switch (parsed.path) {
                case '/':
                case '':
                    await this._loadHomeView();
                    break;
                case '/search':
                    await this._loadSearchView(parsed.params);
                    break;
                case '/catalog':
                    await this._loadCatalogView(parsed.params);
                    break;
                case '/anime':
                    await this._loadAnimeView(parsed.params);
                    break;
                case '/watch':
                    await this._loadWatchView(parsed.params);
                    break;
                case '/settings':
                    await this._loadSettingsView();
                    break;
                case '/mylist':
                    this._loadMyListView();
                    break;
                default:
                    await this._loadHomeView();
                    break;
            }
        }

        _parseHash(hash) {
            const clean = hash.replace(/^#/, '');
            const [path, queryString] = clean.split('?');
            const params = {};
            if (queryString) {
                const searchParams = new URLSearchParams(queryString);
                for (const [key, value] of searchParams.entries()) {
                    params[key] = value;
                }
            }
            return { path, params };
        }

        /**
         * 1. Cargar Vista Home
         */
        async _loadHomeView() {
            window.TVUI.switchView('home');
            window.TVUI.showLoading(true, 'Cargando estrenos de AnimeYT...');
            try {
                const data = await window.TVScraper.getHomeContent();
                window.TVUI.renderHome(data);
                this.nav.refreshFocus('.billboard-actions [data-focusable="true"]');
            } catch (err) {
                window.TVUI.showToast(`Error cargando estrenos: ${err && err.message ? err.message : err}`);
            } finally {
                window.TVUI.showLoading(false);
            }
        }

        /**
         * 2. Cargar Vista Búsqueda
         */
        async _loadSearchView(params) {
            window.TVUI.switchView('search');
            const input = document.getElementById('search-input');

            if (params.q && input) {
                input.value = params.q;
                await this._executeSearch(params.q);
            } else {
                this.nav.refreshFocus('#search-input');
            }
        }

        async _executeSearch(query) {
            if (!query || !query.trim()) return;
            window.TVUI.showLoading(true, `Buscando "${query}"...`);
            try {
                const results = await window.TVApi.search(query);
                window.TVUI.renderSearchResults(results, query);
                this.nav.refreshFocus('#search-results-grid [data-focusable="true"]');
            } catch (err) {
                window.TVUI.showToast(`Error en la búsqueda: ${err && err.message ? err.message : err}`);
            } finally {
                window.TVUI.showLoading(false);
            }
        }

        /**
         * 3. Cargar Vista Catálogo
         */
        async _loadCatalogView(params) {
            window.TVUI.switchView('catalog');
            const page = parseInt(params.page || '1', 10);
            this.catalogPage = page;

            window.TVUI.showLoading(true, `Cargando catálogo página ${page}...`);
            try {
                const data = await window.TVScraper.getCatalog(page, this.catalogFilters);
                this.catalogHasNext = data.hasNext;
                window.TVUI.renderCatalogFilters(data.filters, this.catalogFilters);
                window.TVUI.renderCatalog(data);
                this.nav.refreshFocus('#catalog-results-grid [data-focusable="true"]');
            } catch (err) {
                window.TVUI.showToast(`Error cargando catálogo: ${err && err.message ? err.message : err}`);
            } finally {
                window.TVUI.showLoading(false);
            }
        }

        /**
         * 4. Cargar Vista Ficha de Anime
         */
        async _loadAnimeView(params) {
            if (!params.url) {
                this.navigate('#/');
                return;
            }

            window.TVUI.switchView('anime');
            window.TVUI.showLoading(true, 'Cargando información del anime...');
            try {
                const anime = await window.TVScraper.getAnimeDetail(params.url);
                window.TVStorage.refreshFavorite({ url: anime.url, title: anime.title, image: anime.poster });
                window.TVUI.renderAnimeDetail(anime);
                this.nav.refreshFocus('.detail-actions [data-focusable="true"]');
                window.TVUI.switchView('anime'); // volver arriba tras renderizar
            } catch (err) {
                window.TVUI.showToast(`Error al cargar la ficha del anime: ${err && err.message ? err.message : err}`);
            } finally {
                window.TVUI.showLoading(false);
            }
        }

        /**
         * 5. Cargar Vista Reproductor (Watch)
         */
        async _loadWatchView(params) {
            if (!params.url) {
                this.navigate('#/');
                return;
            }

            window.TVUI.switchView('watch');

            // Cargar episodio en el reproductor blindado
            await this.player.loadEpisode({
                url: params.url,
                title: params.title || '',
                episode: params.ep || '',
                animeTitle: params.animeTitle || params.title || '',
                animeUrl: params.animeUrl || '',
                image: params.img || ''
            });
        }

        /**
         * 6. Cargar Vista Ajustes
         */
        async _loadSettingsView() {
            window.TVUI.switchView('settings');
            window.TVUI.renderSettings();
            this.nav.refreshFocus('#settings-content [data-focusable="true"]');
        }

        _loadMyListView() {
            window.TVUI.switchView('mylist');
            window.TVUI.renderMyList();
            this.nav.refreshFocus('#mylist-content [data-focusable="true"]');
        }

        /**
         * Configuración de eventos de clicks y selectores de UI
         */
        _setupActionListeners() {
            // Manejador delegado para botones del header y acciones generales
            document.addEventListener('click', (e) => {
                const target = e.target.closest('[data-action]');
                if (!target) return;

                const action = target.dataset.action;

                if (action === 'nav') {
                    const view = target.dataset.view;
                    this.navigate(`#/${view === 'home' ? '' : view}`);
                } else if (action === 'open-anime') {
                    const url = target.dataset.url;
                    if (url) this.navigate(`#/anime?url=${encodeURIComponent(url)}`);
                } else if (action === 'play-episode') {
                    if (target.dataset.url) {
                        this.navigate(this._watchRoute({
                            url: target.dataset.url,
                            title: target.dataset.title || '',
                            ep: target.dataset.ep || '',
                            animeUrl: target.dataset.animeUrl || '',
                            img: target.dataset.img || ''
                        }));
                    }
                } else if (action === 'toggle-favorite') {
                    const added = window.TVStorage.toggleFavorite({
                        url: target.dataset.url,
                        title: target.dataset.title,
                        image: target.dataset.img
                    });
                    target.textContent = added ? '✓ En mi lista' : '＋ Mi lista';
                    window.TVUI.showToast(added ? 'Agregado a Mi lista' : 'Quitado de Mi lista');
                } else if (action === 'catalog-next-page') {
                    if (!this.catalogHasNext) return;
                    this.catalogPage++;
                    this.navigate(`#/catalog?page=${this.catalogPage}`);
                } else if (action === 'catalog-prev-page') {
                    if (this.catalogPage > 1) {
                        this.catalogPage--;
                        this.navigate(`#/catalog?page=${this.catalogPage}`);
                    }
                } else if (action === 'clear-watched') {
                    if (window.TVStorage) {
                        window.TVStorage.clearWatched();
                        window.TVUI.showToast('Episodios vistos eliminados');
                        this._loadSettingsView();
                    }
                } else if (action === 'clear-history') {
                    if (window.TVStorage) {
                        window.TVStorage.clearHistory();
                        window.TVUI.showToast('Historial eliminado');
                        this._loadSettingsView();
                    }
                }
            });

            // Manejo del input de búsqueda con debounce y teclado virtual
            const searchInput = document.getElementById('search-input');
            const searchBtn = document.getElementById('search-submit-btn');

            if (searchInput) {
                // Al escribir o presionar Enter
                searchInput.addEventListener('keydown', (e) => {
                    if (e.keyCode === 13) {
                        e.preventDefault();
                        const query = searchInput.value.trim();
                        if (query) {
                            searchInput.blur();
                            this._executeSearch(query);
                        }
                    }
                });

                searchInput.addEventListener('input', () => {
                    clearTimeout(this.searchDebounceTimer);
                    const q = searchInput.value.trim();
                    if (q.length >= 3) {
                        this.searchDebounceTimer = setTimeout(() => {
                            this._executeSearch(q);
                        }, 500);
                    }
                });
            }

            if (searchBtn && searchInput) {
                searchBtn.addEventListener('click', () => {
                    const q = searchInput.value.trim();
                    if (q) this._executeSearch(q);
                });
            }

            // Filtros de catálogo
            const filterForm = document.getElementById('catalog-filters-form');
            if (filterForm) {
                filterForm.addEventListener('change', () => {
                    const filters = {};
                    filterForm.querySelectorAll('select[name]').forEach(select => {
                        if (select.value) filters[select.name] = select.value;
                    });
                    this.catalogFilters = filters;
                    this.catalogPage = 1;
                    // Volver a la página 1 también en la URL, para que "Atrás" no pida una página que ya no existe
                    if (window.location.hash !== '#/catalog') {
                        this.navigate('#/catalog');
                    } else {
                        this._loadCatalogView({ page: 1 });
                    }
                });
            }

            // Cambios de ajustes
            document.addEventListener('change', (e) => {
                const settingEl = e.target.closest('[data-setting-key]');
                if (!settingEl) return;
                const key = settingEl.dataset.settingKey;
                const val = settingEl.value;
                if (window.TVStorage) {
                    const updated = {};
                    updated[key] = val;
                    window.TVStorage.saveSettings(updated);
                    const option = settingEl.options ? settingEl.options[settingEl.selectedIndex] : null;
                    window.TVUI.showToast(`Guardado: ${option ? option.textContent.trim() : val}`);
                }
            });
        }
    }

    // Inicializar app cuando el DOM esté listo
    window.addEventListener('DOMContentLoaded', () => {
        window.app = new TVApp();
        window.app.init();
    });
})(window);
