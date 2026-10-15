/**
 * player.js - Reproductor de video blindado para Tizen Smart TV
 * - Iframe con sandbox anti-anuncios y anti-popups
 * - Focus Keeper para evitar que el iframe secuestre los eventos del control remoto
 * - Reordenamiento automático priorizando servidores rápidos y estables (OK.ru, Abyss, etc.)
 * - Barra overlay de servidores para cambio al vuelo con botón Amarillo o flecha abajo
 */
(function(window) {
    'use strict';

    class TVPlayer {
        constructor(options = {}) {
            this.container = options.container || document.getElementById('player-viewport');
            this.osdContainer = options.osdContainer || document.getElementById('player-osd');
            this.serverBar = options.serverBar || document.getElementById('player-server-bar');
            this.serverList = options.serverList || document.getElementById('player-server-list');
            this.titleEl = options.titleEl || document.getElementById('player-title');
            this.serverLabelEl = options.serverLabelEl || document.getElementById('player-current-server');

            this.iframe = null;
            this.video = null;
            this.mountToken = 0;
            this.shield = null;
            this.focusKeeperInterval = null;
            this.osdTimeout = null;

            this.servers = [];
            this.currentServerIndex = 0;
            this.currentEpisode = null;
            this.isPlaying = false;
            this.isServerBarVisible = false;

            this.onEpisodeChange = options.onEpisodeChange || null;
            this.onOpenSeries = options.onOpenSeries || null;
            this.onClose = options.onClose || null;

            this._handlePlayerKeys = this._handlePlayerKeys.bind(this);
        }

        /**
         * Prioriza y ordena servidores para Smart TV:
         * 1º OK (ok.ru - 1080p, rápido, buen soporte)
         * 2º Abyss (abyssplayer - 1080p)
         * 3º Epsilon (rpmvid / ytplay - 1080p)
         * 4º Byse (bysesukior - 720p)
         * 5º Alpha (burstcloud - 720p)
         * 6º MEGA (mega.nz - 720p)
         */
        _sortServers(servers) {
            const priorityRules = [
                { pattern: /ok\.ru/i, score: 100 },
                { pattern: /abyss/i, score: 90 },
                { pattern: /epsilon|rpmvid|ytplay/i, score: 80 },
                { pattern: /byse/i, score: 70 },
                { pattern: /alpha|burstcloud/i, score: 60 },
                { pattern: /mega/i, score: 50 }
            ];

            return servers.slice().sort((a, b) => {
                let scoreA = 10;
                let scoreB = 10;

                const urlA = a.url || '';
                const urlB = b.url || '';
                const labelA = a.label || '';
                const labelB = b.label || '';

                for (const rule of priorityRules) {
                    if (rule.pattern.test(urlA) || rule.pattern.test(labelA)) {
                        scoreA = rule.score;
                        break;
                    }
                }
                for (const rule of priorityRules) {
                    if (rule.pattern.test(urlB) || rule.pattern.test(labelB)) {
                        scoreB = rule.score;
                        break;
                    }
                }

                return scoreB - scoreA;
            });
        }

        /**
         * Añade parámetros de autoplay al servidor para que el video arranque solo
         */
        _enhanceAutoplayUrl(url) {
            if (!url) return '';
            try {
                const u = new URL(url);
                if (!u.searchParams.has('autoplay')) {
                    u.searchParams.set('autoplay', '1');
                }
                if (!u.searchParams.has('auto')) {
                    u.searchParams.set('auto', '1');
                }
                return u.href;
            } catch (e) {
                if (url.includes('?')) {
                    return url + '&autoplay=1';
                }
                return url + '?autoplay=1';
            }
        }

        /**
         * Carga y reproduce un episodio
         */
        async loadEpisode(episodeData) {
            // Al pasar de un episodio a otro, guardar la posición del anterior antes de reemplazarlo
            this._persistProgress(true);
            this._hideNextPrompt();
            this._teardownMedia();
            if (this.isServerBarVisible) this.toggleServerBar();

            this.currentEpisode = episodeData;
            this.isPlaying = true;

            if (this.titleEl) {
                this.titleEl.textContent = `${episodeData.animeTitle || ''} - ${episodeData.episode || ''} ${episodeData.title || ''}`.trim();
            }

            // Mostrar spinner / cargando
            this._showStatus('Cargando servidores limpios...');

            try {
                // 1. Obtener container ID de AnimeYT
                const containerInfo = await window.TVScraper.getEpisodeContainer(episodeData.url);
                if (!containerInfo || !containerInfo.containerId) {
                    throw new Error('No se encontró el reproductor de este episodio');
                }

                this.currentEpisode.prevUrl = containerInfo.prevUrl;
                this.currentEpisode.nextUrl = containerInfo.nextUrl;
                this.currentEpisode.listUrl = containerInfo.listUrl;
                if (!this.currentEpisode.animeUrl) this.currentEpisode.animeUrl = containerInfo.listUrl || '';
                if (!this.currentEpisode.image) this.currentEpisode.image = containerInfo.backdrop || '';
                if (containerInfo.title) {
                    this.currentEpisode.fullTitle = containerInfo.title;
                    if (this.titleEl) this.titleEl.textContent = containerInfo.title;
                }

                // 2. Extraer servidores limpios desde Mytsumi sin anuncios
                const { servers } = await window.TVScraper.getVideoServers(
                    containerInfo.containerId,
                    containerInfo.lang,
                    containerInfo.only
                );

                if (!servers || !servers.length) {
                    throw new Error('No hay servidores de video disponibles para este capítulo');
                }

                // 3. Ordenar por compatibilidad óptima
                this.servers = this._sortServers(servers);
                this.currentServerIndex = 0;

                // Si el usuario configuró un servidor preferido en ajustes, respetarlo si existe
                if (window.TVStorage) {
                    const settings = window.TVStorage.getSettings();
                    if (settings.preferredServer && settings.preferredServer !== 'auto') {
                        const preferredIdx = this.servers.findIndex(s =>
                            s.label.toLowerCase().includes(settings.preferredServer.toLowerCase()) ||
                            s.url.toLowerCase().includes(settings.preferredServer.toLowerCase())
                        );
                        if (preferredIdx !== -1) {
                            this.currentServerIndex = preferredIdx;
                        }
                    }
                }

                // Renderizar barra inferior de servidores
                this._renderServerBar();

                // Montar el servidor seleccionado
                this._mountCurrentServer();

                // Iniciar guardia de foco y listeners
                this._startFocusKeeper();
                window.addEventListener('keydown', this._handlePlayerKeys, true);

                // Guardar en historial
                if (window.TVStorage) {
                    window.TVStorage.addToHistory({
                        title: episodeData.animeTitle || episodeData.title || containerInfo.title,
                        episode: episodeData.episode || containerInfo.title,
                        url: episodeData.url,
                        animeUrl: this.currentEpisode.animeUrl,
                        image: this.currentEpisode.image
                    });
                }

                this._showOSD();
            } catch (err) {
                console.error('[TVPlayer] Error cargando episodio:', episodeData.url, err);
                this._showStatus(`Error: ${err.message || 'No se pudo reproducir'}`);
            }
        }

        /**
         * Monta el servidor actual: reproductor nativo (<video>) si se puede extraer el video directo,
         * o el iframe del servidor como respaldo
         */
        _mountCurrentServer() {
            const server = this.servers[this.currentServerIndex];
            if (!server) return;

            if (this.serverLabelEl) {
                this.serverLabelEl.textContent = `Servidor: ${server.label} (${server.title || 'HD'})`;
            }

            this._teardownMedia();
            this._updateServerButtonsState();

            if (window.TVScraper.canPlayDirect(server)) {
                this._mountNative(server);
            } else {
                this._mountIframe(server);
            }
        }

        /**
         * Quita el video o iframe montado (y cancela montajes nativos en curso)
         */
        _teardownMedia() {
            this.mountToken++;
            if (this.video) {
                this.video.pause();
                this.video.removeAttribute('src');
                this.video.load();
                this.video.remove();
                this.video = null;
            }
            if (this.iframe) {
                this.iframe.src = 'about:blank';
                this.iframe.remove();
                this.iframe = null;
            }
            this._setProgressVisible(false);
            this._updateNavigationLock();
        }

        /**
         * Reproductor nativo: extrae el MP4/HLS del servidor y lo reproduce sin anuncios
         */
        _mountNative(server) {
            const token = this.mountToken;
            this._showStatus(`Obteniendo video directo de ${server.label}...`);

            window.TVScraper.resolveDirectStream(server)
                .then((stream) => {
                    if (token !== this.mountToken) return;
                    console.log(`[TVPlayer] Directo ${server.label} (${stream.quality}): ${stream.type}`);

                    const video = document.createElement('video');
                    video.className = 'player-video';
                    video.autoplay = true;
                    video.preload = 'auto';
                    if (stream.poster) video.poster = stream.poster;

                    video.addEventListener('error', () => {
                        if (token !== this.mountToken) return;
                        const code = video.error ? video.error.code : '?';
                        console.error(`[TVPlayer] Error del reproductor nativo (código ${code}) en ${server.label}`);
                        this._fallbackToIframe(server);
                    });
                    video.addEventListener('waiting', () => this._setBuffering(true));
                    video.addEventListener('playing', () => this._setBuffering(false));
                    video.addEventListener('canplay', () => this._setBuffering(false));
                    video.addEventListener('loadedmetadata', () => this._resumeFromProgress());
                    video.addEventListener('timeupdate', () => {
                        this._updateProgress();
                        this._persistProgress(false);
                    });
                    video.addEventListener('pause', () => {
                        this._persistProgress(true);
                        this._showOSD();
                    });
                    video.addEventListener('ended', () => {
                        this._persistProgress(true);
                        this._onEnded();
                    });

                    const source = document.createElement('source');
                    source.src = stream.url;
                    source.type = stream.type;
                    source.addEventListener('error', () => {
                        if (token !== this.mountToken) return;
                        console.error(`[TVPlayer] La fuente directa de ${server.label} no cargó`);
                        this._fallbackToIframe(server);
                    });
                    video.appendChild(source);

                    this.container.innerHTML = '';
                    this.container.appendChild(video);
                    this.video = video;
                    this._setBuffering(true);
                    this._setProgressVisible(true);
                    this._updateNavigationLock();

                    const playPromise = video.play();
                    if (playPromise && playPromise.catch) {
                        playPromise.catch((err) => console.warn('[TVPlayer] play() rechazado:', err && err.message));
                    }
                    this._showOSD();
                })
                .catch((err) => {
                    if (token !== this.mountToken) return;
                    console.error(`[TVPlayer] No se pudo extraer el video de ${server.label}:`, err);
                    this._fallbackToIframe(server);
                });
        }

        _fallbackToIframe(server) {
            this._teardownMedia();
            this._showNotification(`${server.label}: usando reproductor web`);
            this._mountIframe(server);
        }

        /**
         * Respaldo: iframe sandboxed del servidor (con su propio reproductor y anuncios)
         */
        _mountIframe(server) {
            const iframe = document.createElement('iframe');
            const targetUrl = this._enhanceAutoplayUrl(server.url);

            // SANDBOX CRÍTICO: bloquea pop-ups, pop-unders y navegación fuera de la app
            // No incluimos 'allow-popups' ni 'allow-top-navigation'
            iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation allow-forms');
            iframe.setAttribute('allow', 'autoplay; fullscreen; encrypted-media; picture-in-picture');
            iframe.setAttribute('frameborder', '0');
            iframe.setAttribute('scrolling', 'no');
            iframe.style.cssText = 'width: 100%; height: 100%; border: none; background: #000; position: absolute; top: 0; left: 0; z-index: 1;';
            iframe.src = targetUrl;

            this.container.innerHTML = '';
            this.container.appendChild(iframe);
            this.iframe = iframe;

            // Capa transparente superior que asegura captura de clicks/foco si es necesario
            this._createShield();
            this._showOSD();
        }

        /**
         * Con video nativo y la barra de servidores oculta, las flechas controlan el video
         * (no la navegación espacial)
         */
        _updateNavigationLock() {
            if (!window.appNavigation) return;
            window.appNavigation.enabled = !(this.isPlaying && this.video && !this.isServerBarVisible);
        }

        _setBuffering(isBuffering) {
            const el = document.getElementById('player-buffering');
            if (el) el.classList.toggle('is-visible', !!isBuffering);
        }

        _setProgressVisible(visible) {
            const el = document.getElementById('player-progress');
            if (el) el.classList.toggle('is-visible', !!visible);
        }

        _formatTime(seconds) {
            if (!isFinite(seconds) || seconds < 0) return '0:00';
            const total = Math.floor(seconds);
            const h = Math.floor(total / 3600);
            const m = Math.floor((total % 3600) / 60);
            const sec = String(total % 60).padStart(2, '0');
            return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
        }

        _updateProgress() {
            if (!this.video) return;
            const fill = document.getElementById('player-progress-fill');
            const time = document.getElementById('player-progress-time');
            const duration = this.video.duration;
            const current = this.video.currentTime;
            if (fill) fill.style.width = isFinite(duration) && duration > 0 ? `${(current / duration) * 100}%` : '0%';
            if (time) time.textContent = `${this._formatTime(current)} / ${this._formatTime(duration)}`;
        }

        /**
         * Reanudar donde se dejó (si quedó a medias)
         */
        _resumeFromProgress() {
            if (!this.video || !window.TVStorage || !this.currentEpisode) return;
            const saved = window.TVStorage.getProgress(this.currentEpisode.url);
            const duration = this.video.duration;
            if (saved && saved.time > 30 && isFinite(duration) && saved.time < duration - 60) {
                this.video.currentTime = saved.time;
                this._showNotification(`Reanudando en ${this._formatTime(saved.time)}`);
            }
        }

        /**
         * Guarda la posición (cada ~5s o forzado) y marca visto al pasar el 90%
         */
        _persistProgress(force) {
            if (!this.video || !window.TVStorage || !this.currentEpisode) return;
            const now = Date.now();
            if (!force && this._lastProgressSave && now - this._lastProgressSave < 5000) return;
            this._lastProgressSave = now;

            const time = this.video.currentTime;
            const duration = this.video.duration;
            if (!isFinite(duration) || duration <= 0) return;

            window.TVStorage.saveProgress(this.currentEpisode.url, time, duration);
            if (time / duration >= 0.9 && !window.TVStorage.isWatched(this.currentEpisode.url)) {
                window.TVStorage.setWatched(this.currentEpisode.url, true);
            }
        }

        /**
         * Fin del episodio: cuenta regresiva al siguiente (si está activado en Ajustes)
         */
        _onEnded() {
            const settings = window.TVStorage ? window.TVStorage.getSettings() : {};
            const nextUrl = this.currentEpisode && this.currentEpisode.nextUrl;
            if (!nextUrl) {
                this._showNotification('Último episodio disponible');
                this._showOSD();
                return;
            }
            if (settings.autoNext === false || settings.autoNext === 'false') {
                this._showNextPrompt(nextUrl, 0);
                return;
            }
            this._showNextPrompt(nextUrl, 10);
        }

        _showNextPrompt(nextUrl, seconds) {
            const box = document.getElementById('player-next');
            const label = document.getElementById('player-next-label');
            if (!box) return;
            this._nextPromptUrl = nextUrl;
            box.classList.add('is-visible');

            let remaining = seconds;
            const render = () => {
                if (label) label.textContent = remaining > 0 ? `Siguiente episodio en ${remaining}s` : 'Siguiente episodio';
            };
            render();
            clearInterval(this._nextTimer);
            if (seconds > 0) {
                this._nextTimer = setInterval(() => {
                    remaining--;
                    render();
                    if (remaining <= 0) this._goToNext();
                }, 1000);
            }
        }

        _hideNextPrompt() {
            clearInterval(this._nextTimer);
            this._nextTimer = null;
            this._nextPromptUrl = null;
            const box = document.getElementById('player-next');
            if (box) box.classList.remove('is-visible');
        }

        _goToNext() {
            const url = this._nextPromptUrl || (this.currentEpisode && this.currentEpisode.nextUrl);
            this._hideNextPrompt();
            if (url && typeof this.onEpisodeChange === 'function') {
                this.onEpisodeChange(url);
            }
        }

        _seekBy(seconds) {
            if (!this.video) return;
            const duration = isFinite(this.video.duration) ? this.video.duration : Infinity;
            this.video.currentTime = Math.max(0, Math.min(duration, this.video.currentTime + seconds));
            this._updateProgress();
            this._showNotification(`${seconds > 0 ? '⏩ +' : '⏪ '}${seconds}s`);
            this._showOSD();
        }

        _togglePlay() {
            if (!this.video) return;
            if (this.video.paused) {
                this.video.play();
                this._showNotification('▶ Reproduciendo');
            } else {
                this.video.pause();
                this._showNotification('⏸ Pausa');
            }
            this._showOSD();
        }

        /**
         * Crea el escudo que previene clicks no deseados
         */
        _createShield() {
            if (this.shield) this.shield.remove();
            const shield = document.createElement('div');
            shield.className = 'player-shield';
            shield.style.cssText = 'position: absolute; top: 0; right: 0; bottom: 0; left: 0; z-index: 2; pointer-events: none;';
            this.container.appendChild(shield);
            this.shield = shield;
        }

        /**
         * Focus Keeper: Ajuste Crítico 2
         * Cada 250ms devuelve el foco a la ventana principal si el iframe lo secuestra
         */
        _startFocusKeeper() {
            this._stopFocusKeeper();
            this.focusKeeperInterval = setInterval(() => {
                if (!this.isPlaying) return;
                // Si el activeElement es el iframe o null, reenfocamos la app principal
                if (document.activeElement === this.iframe || document.activeElement === document.body) {
                    window.focus();
                }
            }, 250);
        }

        _stopFocusKeeper() {
            if (this.focusKeeperInterval) {
                clearInterval(this.focusKeeperInterval);
                this.focusKeeperInterval = null;
            }
        }

        /**
         * Renderiza la lista de servidores en la barra inferior
         */
        /**
         * Serie del episodio actual (para Mi lista e "Ir a la serie")
         */
        _series() {
            const ep = this.currentEpisode || {};
            const title = ep.animeTitle ||
                (ep.fullTitle || '').replace(/\s+(cap[ií]tulo|episodio)\s+\d+.*$/i, '').trim();
            return { url: ep.animeUrl || '', title: title, image: ep.image || '' };
        }

        openSeries() {
            const series = this._series();
            if (!series.url) {
                this._showNotification('No se encontró la serie de este episodio');
                return;
            }
            if (typeof this.onOpenSeries === 'function') this.onOpenSeries(series.url);
        }

        _toggleFavorite(button) {
            const series = this._series();
            if (!series.url || !window.TVStorage) return;
            const added = window.TVStorage.toggleFavorite(series);
            if (button) button.textContent = added ? '✓ En mi lista' : '★ Mi lista';
            this._showNotification(added ? `${series.title || 'Serie'} agregada a Mi lista` : 'Quitada de Mi lista');
        }

        _renderServerBar() {
            if (!this.serverList) return;
            this.serverList.innerHTML = '';

            // Acciones de la serie, en la misma fila que los servidores (▲ siempre cierra el panel)
            const series = this._series();
            if (series.url) {
                const favorite = window.TVStorage && window.TVStorage.isFavorite(series.url);
                const favButton = document.createElement('button');
                favButton.type = 'button';
                favButton.className = 'player-action-btn';
                favButton.setAttribute('data-focusable', 'true');
                favButton.textContent = favorite ? '✓ En mi lista' : '★ Mi lista';
                favButton.addEventListener('click', () => this._toggleFavorite(favButton));
                this.serverList.appendChild(favButton);

                const seriesButton = document.createElement('button');
                seriesButton.type = 'button';
                seriesButton.className = 'player-action-btn';
                seriesButton.setAttribute('data-focusable', 'true');
                seriesButton.innerHTML = '<i class="dot red"></i> Ir a la serie';
                seriesButton.addEventListener('click', () => this.openSeries());
                this.serverList.appendChild(seriesButton);

                const divider = document.createElement('span');
                divider.className = 'player-bar-divider';
                this.serverList.appendChild(divider);
            }

            this.servers.forEach((server, index) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = `player-server-btn ${index === this.currentServerIndex ? 'is-active' : ''}`;
                btn.setAttribute('data-focusable', 'true');
                btn.setAttribute('data-server-index', index);
                const direct = window.TVScraper.canPlayDirect(server);
                btn.innerHTML = `
                    <span class="server-num">${index + 1}</span>
                    <span class="server-name">${server.label}</span>
                    ${direct ? '<span class="server-direct">SIN ANUNCIOS</span>' : ''}
                `;

                btn.addEventListener('click', () => {
                    this.switchServer(index);
                });

                this.serverList.appendChild(btn);
            });
        }

        _updateServerButtonsState() {
            if (!this.serverList) return;
            const buttons = this.serverList.querySelectorAll('.player-server-btn');
            buttons.forEach((btn, idx) => {
                btn.classList.toggle('is-active', idx === this.currentServerIndex);
            });
        }

        /**
         * Cambia al siguiente servidor
         */
        nextServer() {
            if (!this.servers.length) return;
            const nextIdx = (this.currentServerIndex + 1) % this.servers.length;
            this.switchServer(nextIdx);
        }

        switchServer(index) {
            if (index < 0 || index >= this.servers.length) return;
            this.currentServerIndex = index;
            this._mountCurrentServer();
            this._showNotification(`Servidor: ${this.servers[index].label}`);
        }

        /**
         * Toggle de la barra de servidores inferior
         */
        toggleServerBar() {
            this.isServerBarVisible = !this.isServerBarVisible;
            this._updateNavigationLock();
            const main = document.getElementById('app-main');
            if (main) main.scrollTop = 0;
            if (this.serverBar) {
                this.serverBar.classList.toggle('is-visible', this.isServerBarVisible);
                const nav = window.appNavigation;
                if (this.isServerBarVisible && nav) {
                    // Enfocar el botón del servidor activo
                    nav.refreshFocus('.player-server-btn.is-active');
                } else {
                    // Al cerrar, soltar el foco de los botones ocultos de la barra
                    if (nav && nav.currentFocus && this.serverBar.contains(nav.currentFocus)) {
                        nav.currentFocus.classList.remove('has-focus');
                        nav.currentFocus = null;
                    }
                    window.focus();
                }
            }
            this._showOSD();
        }

        _showStatus(msg) {
            if (this.container) {
                this.container.innerHTML = `
                    <div class="player-loading-state">
                        <div class="spinner"></div>
                        <p>${msg}</p>
                    </div>
                `;
            }
        }

        _showNotification(text) {
            const toast = document.getElementById('player-toast');
            if (toast) {
                toast.textContent = text;
                toast.classList.add('is-active');
                setTimeout(() => toast.classList.remove('is-active'), 2500);
            }
        }

        _showOSD() {
            if (!this.osdContainer) return;
            this.osdContainer.classList.add('is-visible');
            clearTimeout(this.osdTimeout);
            this.osdTimeout = setTimeout(() => {
                if (!this.isServerBarVisible && this.osdContainer) {
                    this.osdContainer.classList.remove('is-visible');
                }
            }, 4000);
        }

        /**
         * Teclas del reproductor
         */
        _handlePlayerKeys(e) {
            if (!this.isPlaying) return;

            const code = window.TVKeys ? window.TVKeys.normalizeEvent(e) : e.keyCode;

            // Retorno / Salir del reproductor
            if (code === (window.TVKeys ? window.TVKeys.RETURN : 10009)) {
                e.preventDefault();
                e.stopPropagation();
                if (this.isServerBarVisible) {
                    this.toggleServerBar();
                    return;
                }
                this.destroy();
                if (typeof this.onClose === 'function') {
                    this.onClose();
                }
                return;
            }

            const K = window.TVKeys || {};

            // Aviso "Siguiente episodio": OK lo reproduce ya, cualquier otra tecla lo cancela
            if (this._nextPromptUrl) {
                e.preventDefault();
                if (code === K.ENTER || code === K.PLAY || code === K.PLAY_PAUSE || code === K.CHANNEL_UP) {
                    this._goToNext();
                } else {
                    this._hideNextPrompt();
                    this._showNotification('Siguiente episodio cancelado');
                }
                return;
            }

            // Barra de servidores abierta: ▲ la cierra (no hay nada más arriba a donde moverse)
            if (this.isServerBarVisible && code === K.UP) {
                e.preventDefault();
                this.toggleServerBar();
                return;
            }

            // Rojo: ir a la ficha de la serie (para agregarla a Mi lista y seguirla)
            if (code === K.COLOR_RED) {
                e.preventDefault();
                this.openSeries();
                return;
            }

            // Verde: saltar intro (+85s)
            if (this.video && !this.isServerBarVisible && code === K.COLOR_GREEN) {
                e.preventDefault();
                this._seekBy(85);
                return;
            }

            // Controles del reproductor nativo (con la barra de servidores oculta)
            if (this.video && !this.isServerBarVisible) {
                if (code === K.ENTER || code === K.PLAY_PAUSE || code === K.PLAY || code === K.PAUSE) {
                    e.preventDefault();
                    if (code === K.PLAY && !this.video.paused) return;
                    if (code === K.PAUSE && this.video.paused) return;
                    this._togglePlay();
                    return;
                }
                if (code === K.LEFT || code === K.REWIND) {
                    e.preventDefault();
                    this._seekBy(code === K.REWIND ? -30 : -10);
                    return;
                }
                if (code === K.RIGHT || code === K.FAST_FORWARD) {
                    e.preventDefault();
                    this._seekBy(code === K.FAST_FORWARD ? 30 : 10);
                    return;
                }
                if (code === K.UP || code === K.INFO) {
                    e.preventDefault();
                    this._showOSD();
                    return;
                }
            }

            // Tecla Amarilla (405 / F3) o Flecha Abajo: alternar barra de servidores
            if (code === (window.TVKeys ? window.TVKeys.COLOR_YELLOW : 405) ||
                (!this.isServerBarVisible && code === (window.TVKeys ? window.TVKeys.DOWN : 40))) {
                e.preventDefault();
                this.toggleServerBar();
                return;
            }

            // Tecla Azul (406 / F4): Marcar como visto
            if (code === (window.TVKeys ? window.TVKeys.COLOR_BLUE : 406)) {
                e.preventDefault();
                if (this.currentEpisode && window.TVStorage) {
                    const isNowWatched = window.TVStorage.toggleWatched(this.currentEpisode.url);
                    this._showNotification(isNowWatched ? '✓ Marcado como visto' : '○ Marcado como no visto');
                }
                return;
            }

            // Canal Arriba / Próximo episodio
            if (code === (window.TVKeys ? window.TVKeys.CHANNEL_UP : 427)) {
                e.preventDefault();
                if (this.currentEpisode && this.currentEpisode.nextUrl && typeof this.onEpisodeChange === 'function') {
                    this.onEpisodeChange(this.currentEpisode.nextUrl);
                } else {
                    this._showNotification('No hay siguiente episodio');
                }
                return;
            }

            // Canal Abajo / Episodio anterior
            if (code === (window.TVKeys ? window.TVKeys.CHANNEL_DOWN : 428)) {
                e.preventDefault();
                if (this.currentEpisode && this.currentEpisode.prevUrl && typeof this.onEpisodeChange === 'function') {
                    this.onEpisodeChange(this.currentEpisode.prevUrl);
                } else {
                    this._showNotification('No hay episodio anterior');
                }
                return;
            }

            // Tecla Play/Pause
            if (code === (window.TVKeys ? window.TVKeys.PLAY_PAUSE : 10252) ||
                code === (window.TVKeys ? window.TVKeys.PLAY : 415) ||
                code === (window.TVKeys ? window.TVKeys.PAUSE : 19)) {
                this._showOSD();
            }
        }

        /**
         * Cierra y limpia todos los recursos del reproductor
         */
        destroy() {
            this.isPlaying = false;
            this.isServerBarVisible = false;
            this._stopFocusKeeper();

            window.removeEventListener('keydown', this._handlePlayerKeys, true);

            this._persistProgress(true);
            this._hideNextPrompt();

            // isPlaying ya es false: esto también devuelve las flechas a la navegación
            this._teardownMedia();
            this._setBuffering(false);

            if (this.shield) {
                this.shield.remove();
                this.shield = null;
            }

            if (this.serverBar) {
                this.serverBar.classList.remove('is-visible');
            }

            if (this.osdContainer) {
                this.osdContainer.classList.remove('is-visible');
            }

            if (this.container) {
                this.container.innerHTML = '';
            }

            clearTimeout(this.osdTimeout);
        }
    }

    window.TVPlayer = TVPlayer;
})(window);
