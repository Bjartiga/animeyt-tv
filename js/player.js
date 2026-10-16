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
            this.loadId = 0;
            this.streamSources = [];
            this.streamSourceIndex = 0;
            this.recoveryTimer = null;
            this._resumeTime = null;
            this.skipSegments = [];
            this.activeSkip = null;
            this.skipRequestToken = 0;
            this.webInteraction = false;
            this.webControlTimer = null;
            this.webLoadTimer = null;
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

            const skipButton = document.getElementById('player-skip');
            if (skipButton) skipButton.addEventListener('click', () => this._skipSegment());
            this._handlePlayerKeys = this._handlePlayerKeys.bind(this);
            const webControls = document.getElementById('player-web-controls');
            if (webControls) webControls.addEventListener('click', (e) => {
                const button = e.target.closest('[data-player-web-action]');
                if (!button) return;
                const action = button.dataset.playerWebAction;
                if (action === 'activate') this.activateWebControl();
                else if (action === 'options') this.toggleServerBar();
                else if (action === 'browser') this.openInBrowser(true);
            });
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
            // Primero los que se reproducen en el reproductor nativo (OK, Omega/archive.org), luego los web
            const priorityRules = [
                { pattern: /ok\.ru/i, score: 100 },
                { pattern: /archive\.org|omega|mytsumi\.com\/multiplayer\/play/i, score: 95 },
                { pattern: /abyss/i, score: 90 },
                { pattern: /epsilon|rpmvid|ytplay/i, score: 80 },
                { pattern: /byse/i, score: 70 },
                { pattern: /alpha|burstcloud/i, score: 60 },
                { pattern: /mega\.nz|^mega$/i, score: 50 }
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

                if (window.TVScraper.canPlayDirect(a)) scoreA += 1000;
                if (window.TVScraper.canPlayDirect(b)) scoreB += 1000;
                return scoreB - scoreA;
            });
        }

        /**
         * Añade parámetros de autoplay al servidor para que el video arranque solo
         */
        _enhanceAutoplayUrl(url) {
            // No modificar enlaces firmados ni fragmentos (p. ej. la clave de un embed de Mega).
            if (!url || !/^https?:\/\/(?:[^/]+\.)?ok\.ru\/videoembed\//i.test(url)) return url || '';
            try {
                const parsed = new URL(url);
                if (!parsed.searchParams.has('autoplay')) parsed.searchParams.set('autoplay', '1');
                return parsed.href;
            } catch (e) { return url; }
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

            // Cada carga tiene su número: si se cierra el reproductor o empieza otro episodio mientras
            // esperamos al sitio, la respuesta vieja se descarta (antes montaba servidores tras cerrar
            // o mezclaba el "Siguiente" de un episodio con otro)
            const loadId = ++this.loadId;
            const episode = episodeData;
            const isStale = () => loadId !== this.loadId || !this.isPlaying || this.currentEpisode !== episode;

            this.currentEpisode = episode;
            this._resumeTime = null;
            this.streamSources = [];
            this.streamSourceIndex = 0;
            this._failedNative = {};
            this.isPlaying = true;

            if (this.titleEl) {
                this.titleEl.textContent = `${episodeData.animeTitle || ''} - ${episodeData.episode || ''} ${episodeData.title || ''}`.trim();
            }

            // Mostrar spinner / cargando
            this._showStatus('Cargando servidores limpios...');

            try {
                // 1. Obtener container ID de AnimeYT
                const containerInfo = await window.TVScraper.getEpisodeContainer(episodeData.url);
                if (isStale()) return;
                if (!containerInfo || (!containerInfo.containerId && !containerInfo.multiOptionsUrl)) {
                    throw new Error('No se encontró el reproductor de este episodio');
                }

                episode.prevUrl = containerInfo.prevUrl;
                episode.nextUrl = containerInfo.nextUrl;
                episode.listUrl = containerInfo.listUrl;
                // Página de servidores del sitio: la abre "Ver en el navegador del TV"
                episode.containerUrl = containerInfo.containerId
                    ? `https://mytsumi.com/container.php?id=${encodeURIComponent(containerInfo.containerId)}` +
                      `&lang=${encodeURIComponent(containerInfo.lang)}&only=${encodeURIComponent(containerInfo.only)}`
                    : containerInfo.multiOptionsUrl;
                if (!episode.animeUrl) episode.animeUrl = containerInfo.listUrl || '';
                if (!episode.image) episode.image = containerInfo.backdrop || '';
                if (containerInfo.title) {
                    episode.fullTitle = containerInfo.title;
                    if (this.titleEl) this.titleEl.textContent = containerInfo.title;
                }

                // 2. Lista de servidores (formato container.php o el alternativo multiplayer)
                let servers;
                if (containerInfo.containerId) {
                    servers = (await window.TVScraper.getVideoServers(
                        containerInfo.containerId,
                        containerInfo.lang,
                        containerInfo.only
                    )).servers;
                } else {
                    const multi = await window.TVScraper.getMultiServers(containerInfo.multiOptionsUrl);
                    servers = multi.servers;
                    episode.containerUrl = multi.containerUrl;
                }
                if (isStale()) return;

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
                        animeUrl: episode.animeUrl,
                        image: episode.image,
                        nextUrl: episode.nextUrl
                    });
                }

                this._showOSD();
            } catch (err) {
                if (isStale()) return;
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
            this.streamSources = [];
            this.streamSourceIndex = 0;
            this.playbackMode = 'loading';
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
            this.releaseWebControl(false);
            clearTimeout(this.webLoadTimer);
            this.webLoadTimer = null;
            this._showWebControls(false);
            this._rememberPosition();
            this._persistProgress(true);
            this._clearRecoveryTimer();
            this.mountToken++;
            this.skipRequestToken++;
            this.skipSegments = [];
            this.activeSkip = null;
            this._updateSkipPrompt();
            if (this.video && this.video.destroyMedia) {
                this.video.destroyMedia();
                this.video = null;
            }
            if (this.video) {
                this.video.pause();
                this.video.removeAttribute('src');
                this.video.innerHTML = ''; // no volver a seleccionar el <source> anterior al hacer load()
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
        _mountNative(server, sources, sourceIndex = 0) {
            this.playbackMode = 'loading';
            const token = this.mountToken;
            this._showStatus(`Obteniendo video directo de ${server.label}...`);

            const request = sources ? Promise.resolve({ sources: sources }) : window.TVScraper.resolveDirectStream(server);
            this._armRecovery(server, token);
            request.then((resolved) => {
                    if (token !== this.mountToken) return;
                    const candidates = resolved.sources || [resolved];
                    this.streamSources = candidates;
                    this.streamSourceIndex = sourceIndex;
                    const stream = candidates[sourceIndex];
                    if (!stream) throw new Error('Calidad no disponible');
                    this._renderServerBar();
                    console.log(`[TVPlayer] Directo ${server.label} (${stream.quality}): ${stream.type}`);

                    const avplay = window.TVAVPlay && window.TVAVPlay.supports(stream);
                    const video = avplay ? window.TVAVPlay.create(stream) : document.createElement('video');
                    video.className = 'player-video';
                    video.autoplay = true;
                    video.preload = 'auto';
                    if (stream.poster) video.poster = stream.poster;

                    video.addEventListener('error', () => {
                        if (token !== this.mountToken) return;
                        const code = video.error ? video.error.code : '?';
                        console.error(`[TVPlayer] Error del reproductor nativo (código ${code}) en ${server.label}`);
                        this._recoverNative(server);
                    });
                    video.addEventListener('waiting', () => {
                        if (token !== this.mountToken) return;
                        this._setBuffering(true);
                        this._armRecovery(server, token);
                    });
                    video.addEventListener('playing', () => {
                        if (token !== this.mountToken) return;
                        this.playbackMode = 'direct';
                        this._setBuffering(false);
                        this._clearRecoveryTimer();
                        this._updateServerButtonsState();
                    });
                    video.addEventListener('loadedmetadata', () => {
                        if (token === this.mountToken) {
                            this._resumeFromProgress();
                            this._loadSkipSegments(token);
                        }
                    });
                    let lastTime = -1;
                    video.addEventListener('timeupdate', () => {
                        if (token !== this.mountToken) return;
                        if (!video.paused && !video.ended && video.currentTime !== lastTime) {
                            lastTime = video.currentTime;
                            this._clearRecoveryTimer();
                            this._armRecovery(server, token);
                        }
                        this._updateProgress();
                        this._updateSkipPrompt();
                        this._persistProgress(false);
                    });
                    video.addEventListener('pause', () => {
                        if (token !== this.mountToken) return;
                        this._clearRecoveryTimer();
                        this._persistProgress(true);
                        this._showOSD();
                    });
                    video.addEventListener('ended', () => {
                        if (token !== this.mountToken) return;
                        this._clearRecoveryTimer();
                        this._persistProgress(true);
                        this._onEnded();
                    });

                    if (!avplay) {
                        const source = document.createElement('source');
                        source.src = stream.url;
                        source.type = stream.type;
                        source.addEventListener('error', () => {
                            if (token !== this.mountToken) return;
                            console.error(`[TVPlayer] La fuente directa de ${server.label} no cargó`);
                            this._recoverNative(server);
                    });
                    video.appendChild(source);
                    }

                    this.container.innerHTML = '';
                    this.container.appendChild(video);
                    this.video = video;
                    this._setBuffering(true);
                    this._setProgressVisible(true);
                    this._updateNavigationLock();

                    const playPromise = video.play();
                    if (playPromise && playPromise.catch) {
                        playPromise.catch((err) => {
                            if (token !== this.mountToken || (err && err.name === 'AbortError')) return;
                            if (err && err.name === 'NotAllowedError') {
                                this._clearRecoveryTimer();
                                this._setBuffering(false);
                                this._showNotification('Pulsa OK para iniciar el video');
                            } else this._recoverNative(server);
                        });
                    }
                    this._showOSD();
                })
                .catch((err) => {
                    if (token !== this.mountToken) return;
                    console.error(`[TVPlayer] No se pudo extraer el video de ${server.label}:`, err);
                    this._recoverNative(server);
                });
        }

        async _loadSkipSegments(token) {
            if (!window.TVSkip || !this.video) return;
            const request = ++this.skipRequestToken;
            const video = this.video;
            const segments = await window.TVSkip.load(this.currentEpisode, video.duration);
            if (token !== this.mountToken || request !== this.skipRequestToken || video !== this.video) return;
            this.skipSegments = segments;
            this._updateSkipPrompt();
        }

        _updateSkipPrompt() {
            const button = document.getElementById('player-skip');
            const time = this.video ? this.video.currentTime : -1;
            this.activeSkip = this.video && !this.isServerBarVisible && !this._nextPromptUrl
                ? this.skipSegments.find(segment => time >= segment.start && time < segment.end) || null : null;
            if (!button) return;
            button.hidden = !this.activeSkip;
            if (this.activeSkip) button.textContent = 'OK · ' + (this.activeSkip.type === 'recap' ? 'Saltar resumen' : 'Saltar introducción');
        }

        _skipSegment() {
            if (!this.video || !this.activeSkip) return;
            const end = this.activeSkip.end;
            try {
                this.video.currentTime = end;
                this.activeSkip = null;
                const button = document.getElementById('player-skip');
                if (button) button.hidden = true;
                this._showNotification('Saltado');
            } catch (error) { this._showNotification('No se pudo saltar este segmento'); }
        }

        _clearRecoveryTimer() {
            clearTimeout(this.recoveryTimer);
            this.recoveryTimer = null;
        }

        _armRecovery(server, token) {
            if (this.recoveryTimer) return;
            this.recoveryTimer = setTimeout(() => {
                this.recoveryTimer = null;
                if (token === this.mountToken && this.isPlaying) this._recoverNative(server);
            }, 20000);
        }

        _rememberPosition() {
            if (this.video && isFinite(this.video.currentTime) && this.video.currentTime > 0) {
                this._resumeTime = this.video.currentTime;
            }
        }

        _recoverNative(server) {
            const sources = this.streamSources;
            const next = this.streamSourceIndex + 1;
            if (next < sources.length) {
                this._teardownMedia();
                this._showNotification(`Probando otra calidad: ${sources[next].quality}`);
                this._mountNative(server, sources, next);
            } else this._fallbackToIframe(server);
        }

        retryServer() {
            if (!this.currentEpisode) return;
            this._failedNative = {};
            this._mountCurrentServer();
        }

        selectQuality(index) {
            if (index < 0 || index >= this.streamSources.length) return;
            const server = this.servers[this.currentServerIndex];
            const sources = this.streamSources;
            this._teardownMedia();
            this._mountNative(server, sources, index);
        }

        changeEpisode(direction) {
            const ep = this.currentEpisode;
            const url = ep && (direction > 0 ? ep.nextUrl : ep.prevUrl);
            if (url && this.onEpisodeChange) this.onEpisodeChange(url);
        }

        _fallbackToIframe(server) {
            this._teardownMedia();
            this._failedNative = this._failedNative || {};
            this._failedNative[server.url] = true;

            // Antes que el reproductor web, probar otro servidor nativo (p. ej. OK falla -> Omega)
            const nextNative = this.servers.findIndex(s =>
                window.TVScraper.canPlayDirect(s) && !this._failedNative[s.url]);
            if (nextNative !== -1) {
                this._showNotification(`${server.label} no cargó: probando ${this.servers[nextNative].label}`);
                this.currentServerIndex = nextNative;
                this._mountCurrentServer();
                return;
            }

            this._showNotification(`${server.label}: usando reproductor web`);
            this._mountIframe(server);
        }

        /**
         * Respaldo: iframe sandboxed del servidor (con su propio reproductor y anuncios)
         */
        _mountIframe(server) {
            this.playbackMode = 'web';
            this._clearRecoveryTimer();
            this._setBuffering(false);
            this._updateServerButtonsState();
            const iframe = document.createElement('iframe');
            const targetUrl = this._enhanceAutoplayUrl(server.url);
            if (!/^https?:\/\//i.test(targetUrl)) {
                this._showStatus('La dirección del servidor web no es válida');
                return;
            }
            const token = this.mountToken;

            // SANDBOX CRÍTICO: bloquea pop-ups, pop-unders y navegación fuera de la app
            // No incluimos 'allow-popups' ni 'allow-top-navigation'
            iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation allow-forms');
            iframe.setAttribute('allow', 'autoplay; fullscreen; encrypted-media; picture-in-picture');
            iframe.setAttribute('frameborder', '0');
            iframe.setAttribute('tabindex', '-1');
            iframe.setAttribute('title', `Reproductor web: ${server.label || 'Servidor'}`);
            iframe.setAttribute('scrolling', 'no');
            iframe.style.cssText = 'width: 100%; height: 100%; border: none; background: #000; position: absolute; top: 0; left: 0; z-index: 1;';
            iframe.addEventListener('load', () => {
                if (token !== this.mountToken || this.iframe !== iframe) return;
                clearTimeout(this.webLoadTimer);
                this.webLoadTimer = null;
                // load solo indica navegación: no confirma reproducción ni ausencia de bloqueo.
                this._setWebStatus('Página abierta. Si no inicia, activa el control web o prueba otro servidor.');
            });
            iframe.addEventListener('error', () => {
                if (token !== this.mountToken) return;
                this._setWebStatus('No se pudo abrir la página. Usa Opciones para reintentar o cambiar servidor.');
            });
            iframe.src = targetUrl;

            this.container.innerHTML = '';
            this.container.appendChild(iframe);
            this.iframe = iframe;
            this._showWebControls(true);
            this._setWebStatus('Abriendo reproductor web… No todos los proveedores admiten este motor de TV.');
            this.webLoadTimer = setTimeout(() => {
                if (token !== this.mountToken) return;
                this._setWebStatus('La página está tardando. Puedes reintentar, cambiar servidor o abrir el navegador.');
            }, 15000);
            if (window.appNavigation) window.appNavigation.refreshFocus('#player-web-activate');

            // Capa transparente superior que asegura captura de clicks/foco si es necesario
            this._createShield();
            this._showOSD();
        }

        _setWebStatus(message) {
            const status = document.getElementById('player-web-status');
            const server = this.servers[this.currentServerIndex];
            let warning = '';
            try {
                const host = new URL(server && server.url).hostname;
                if (/(^|\.)(bysesukior\.com|rpmvid\.com|abyssplayer\.com)$/i.test(host)) {
                    warning = ' Este proveedor puede requerir un motor más reciente que el de tu TV; prefiere un servidor DIRECTO.';
                }
            } catch (e) { /* la URL inválida se informa al montar el iframe */ }
            if (status) status.textContent = message + warning;
        }

        _showWebControls(show) {
            const controls = document.getElementById('player-web-controls');
            if (controls) controls.classList.toggle('hidden', !show);
            const hints = document.getElementById('player-native-hints');
            if (hints) hints.classList.toggle('hidden', show);
        }

        activateWebControl() {
            if (!this.iframe || !this.isPlaying || this.isServerBarVisible) return;
            this.webInteraction = true;
            this._updateNavigationLock();
            const controls = document.getElementById('player-web-controls');
            if (controls) controls.classList.add('is-interacting');
            this._setWebStatus('Control del servidor: usa sus flechas y OK. La app recuperará el mando en 15 segundos.');
            clearTimeout(this.webControlTimer);
            const token = this.mountToken;
            this.webControlTimer = setTimeout(() => {
                if (token === this.mountToken) this.releaseWebControl(true);
            }, 15000);
            this.iframe.focus();
        }

        releaseWebControl(restoreFocus) {
            clearTimeout(this.webControlTimer);
            this.webControlTimer = null;
            const wasInteracting = this.webInteraction;
            this.webInteraction = false;
            const controls = document.getElementById('player-web-controls');
            if (controls) controls.classList.remove('is-interacting');
            this._updateNavigationLock();
            if (!restoreFocus || !wasInteracting) return;
            if (document.fullscreenElement === this.iframe && document.exitFullscreen) {
                const exit = document.exitFullscreen();
                if (exit && exit.catch) exit.catch(() => {});
            }
            if (this.iframe) this.iframe.blur();
            window.focus();
            if (window.appNavigation) window.appNavigation.refreshFocus('#player-web-activate');
            this._setWebStatus('Mando de vuelta en la app. Si el servidor no responde, prueba otro o abre el navegador.');
        }

        /**
         * Con video nativo y la barra de servidores oculta, las flechas controlan el video
         * (no la navegación espacial)
         */
        _updateNavigationLock() {
            if (!window.appNavigation) return;
            window.appNavigation.enabled = !this.webInteraction && !(this.isPlaying && this.video && !this.isServerBarVisible);
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
            if (this._resumeTime !== null && isFinite(duration) && duration > 0) {
                const time = Math.min(this._resumeTime, Math.max(0, duration - 1));
                try {
                    this.video.currentTime = time;
                    this._resumeTime = null;
                    this._showNotification(`Continuando en ${this._formatTime(time)}`);
                } catch (e) { /* se conserva la posición si el medio aún no permite buscar */ }
                return;
            }
            if (saved && saved.time > 30 && isFinite(duration) && saved.time < duration - 60) {
                this.video.currentTime = saved.time;
                this._showNotification(`Reanudando en ${this._formatTime(saved.time)}`);
            }
        }

        /**
         * Guarda la posición (cada ~5s o forzado) y marca visto al pasar el 95%
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
            if (time / duration >= 0.95 && !window.TVStorage.isWatched(this.currentEpisode.url)) {
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
            this._updateSkipPrompt();
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

        /**
         * Cancela el aviso de siguiente episodio si está a la vista. Devuelve true si había uno.
         */
        cancelNextPrompt() {
            if (!this._nextPromptUrl) return false;
            this._hideNextPrompt();
            this._showNotification('Siguiente episodio cancelado');
            return true;
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
            this._updateSkipPrompt();
            this._showNotification(`${seconds > 0 ? '⏩ +' : '⏪ '}${seconds}s`);
            this._showOSD();
        }

        _togglePlay() {
            if (!this.video) return;
            if (this.video.paused) {
                const promise = this.video.play();
                if (promise && promise.catch) promise.catch(() => this._showNotification('No se pudo iniciar. Abre Opciones → Reintentar.'));
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
            // Los reproductores web (iframe) se quedan con el foco y las teclas del control dejan de llegar a la app.
            // window.focus() no alcanza: hay que sacar el foco del iframe y ponerlo en un elemento de la app.
            const reclaim = () => {
                if (!this.isPlaying || this.webInteraction) return;
                const active = document.activeElement;
                if (active && active.tagName === 'IFRAME') {
                    this._debug('foco recuperado del iframe');
                    active.blur();
                    const sink = document.getElementById('player-focus-sink');
                    if (sink) sink.focus();
                }
            };
            this._onWindowBlur = () => setTimeout(reclaim, 0);
            window.addEventListener('blur', this._onWindowBlur);
            this.focusKeeperInterval = setInterval(reclaim, 300);
        }

        _stopFocusKeeper() {
            if (this.focusKeeperInterval) {
                clearInterval(this.focusKeeperInterval);
                this.focusKeeperInterval = null;
            }
            if (this._onWindowBlur) {
                window.removeEventListener('blur', this._onWindowBlur);
                this._onWindowBlur = null;
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

            const button = (className, html, onClick) => {
                const el = document.createElement('button');
                el.type = 'button';
                el.className = className;
                el.setAttribute('data-focusable', 'true');
                el.textContent = html;
                el.addEventListener('click', onClick);
                return el;
            };
            const heading = (text) => {
                const el = document.createElement('h3');
                el.className = 'panel-heading';
                el.textContent = text;
                return el;
            };

            this.serverList.innerHTML = '';

            this.serverList.appendChild(heading('Reproducción'));
            if (this.currentEpisode && this.currentEpisode.prevUrl) {
                this.serverList.appendChild(button('player-action-btn', '◀ Episodio anterior', () => this.changeEpisode(-1)));
            }
            if (this.currentEpisode && this.currentEpisode.nextUrl) {
                this.serverList.appendChild(button('player-action-btn', 'Siguiente episodio ▶', () => this.changeEpisode(1)));
            }
            this.serverList.appendChild(button('player-action-btn', '↻ Reintentar servidor', () => this.retryServer()));
            if (this.streamSources.length) {
                this.serverList.appendChild(heading('Calidad'));
                this.streamSources.forEach((source, index) => {
                    const qualityNames = { full: '1080p', hd: '720p', sd: '480p', low: '360p', lowest: '240p', mobile: '144p' };
                    const label = qualityNames[source.quality] || source.quality || 'Original';
                    this.serverList.appendChild(button('player-action-btn', `${index === this.streamSourceIndex ? '✓ ' : ''}${label}`, () => this.selectQuality(index)));
                });
            }
            this.serverList.appendChild(heading('Servidor'));
            this.servers.forEach((server, index) => {
                const direct = window.TVScraper.canPlayDirect(server);
                const btn = button(`player-server-btn ${index === this.currentServerIndex ? 'is-active' : ''}`, '', () => this.switchServer(index));
                const name = document.createElement('span');
                name.className = 'server-name';
                name.textContent = server.label;
                const badge = document.createElement('span');
                badge.className = 'server-mode';
                badge.textContent = direct ? 'DIRECTO' : 'WEB';
                btn.appendChild(name);
                btn.appendChild(badge);
                btn.setAttribute('data-server-index', index);
                this.serverList.appendChild(btn);
            });

            const series = this._series();
            this.serverList.appendChild(heading('Serie'));
            if (series.url) {
                const favorite = window.TVStorage && window.TVStorage.isFavorite(series.url);
                const favButton = button('player-action-btn', favorite ? '✓ En mi lista' : '★ Mi lista', () => this._toggleFavorite(favButton));
                this.serverList.appendChild(favButton);
                this.serverList.appendChild(button('player-action-btn', 'Ir a la serie', () => this.openSeries()));
            }
            this.serverList.appendChild(button('player-action-btn', '🌐 Abrir este servidor en el navegador', () => this.openInBrowser(true)));
            this.serverList.appendChild(button('player-action-btn', 'Abrir lista de servidores en el navegador', () => this.openInBrowser()));
            this._updateServerButtonsState();
            if (this.isServerBarVisible && window.appNavigation) window.appNavigation.refreshFocus('.player-server-btn.is-active');
        }

        _updateServerButtonsState() {
            if (!this.serverList) return;
            const buttons = this.serverList.querySelectorAll('.player-server-btn');
            buttons.forEach((btn, idx) => {
                const active = idx === this.currentServerIndex;
                btn.classList.toggle('is-active', active);
                const badge = btn.querySelector('.server-mode');
                if (badge) badge.textContent = active && this.playbackMode === 'web' ? 'WEB' : (window.TVScraper.canPlayDirect(this.servers[idx]) ? 'DIRECTO' : 'WEB');
            });
            const source = this.streamSources[this.streamSourceIndex];
            const server = this.servers[this.currentServerIndex];
            if (this.serverLabelEl && server) this.serverLabelEl.textContent = `${server.label} · ${this.playbackMode === 'web' ? 'Reproductor web' : (source ? source.quality : 'Cargando…')}`;
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
            this._debug(`cambio de servidor -> ${this.servers[index].label}`);
            this.currentServerIndex = index;
            this._mountCurrentServer();
            const server = this.servers[index];
            this._showNotification(window.TVScraper.canPlayDirect(server)
                ? `Servidor: ${server.label}`
                : `${server.label}: si no arranca, ▼ → Ver en el navegador del TV`);
        }

        /**
         * Abre la página de servidores del sitio en el navegador del TV: ahí los reproductores web
         * corren en su propio dominio, con cursor (flechas + OK) y sus anuncios, igual que en un computador
         */
        openInBrowser(currentServer = false) {
            const serverUrl = (this.servers[this.currentServerIndex] || {}).url;
            const url = currentServer ? serverUrl : ((this.currentEpisode && this.currentEpisode.containerUrl) || serverUrl);
            if (!url) return;

            this.releaseWebControl(true);
            this._persistProgress(true);
            if (this.video && !this.video.paused) this.video.pause();
            // No hay una API universal para pausar iframes: retirarlo evita audio detrás del navegador.
            if (this.iframe) {
                this._teardownMedia();
                this._showStatus('Reproductor web detenido. Usa Reintentar para volver a abrirlo aquí.', false);
                if (!this.isServerBarVisible) this.toggleServerBar();
            } else if (this.isServerBarVisible) this.toggleServerBar();

            const tizenApp = window.tizen && window.tizen.application;
            if (!tizenApp || !window.tizen.ApplicationControl) {
                window.open(url, '_blank');
                return;
            }

            this._showNotification('Abriendo el navegador del TV... (Atrás para volver)');
            const control = new window.tizen.ApplicationControl('http://tizen.org/appcontrol/operation/view', url);
            const fail = (err) => {
                console.error('[TVPlayer] No se pudo abrir el navegador:', err && err.message);
                this._showNotification('No se pudo abrir el navegador del TV');
            };
            try {
                // Sin app explícita el sistema elige el navegador; si falla, se prueba el navegador de Samsung
                tizenApp.launchAppControl(control, null, () => this._debug('navegador abierto'), () => {
                    try {
                        tizenApp.launchAppControl(control, 'org.tizen.browser', () => this._debug('navegador abierto (org.tizen.browser)'), fail);
                    } catch (e) {
                        fail(e);
                    }
                });
            } catch (e) {
                fail(e);
            }
        }

        /**
         * Trazas de diagnóstico: solo en builds con DEV_LOGS (se ven en el dev-server del Mac)
         */
        _debug(message) {
            if (window.__TV_DEV_LOGS__) console.log(`[debug] ${message}`);
        }

        /**
         * Toggle de la barra de servidores inferior
         */
        toggleServerBar() {
            this.releaseWebControl(true);
            this.isServerBarVisible = !this.isServerBarVisible;
            this._updateSkipPrompt();
            this._debug(`panel ${this.isServerBarVisible ? 'abierto' : 'cerrado'} desde ${(new Error().stack || '').split('\n')[2] || '?'}`);
            this._updateNavigationLock();
            if (this.iframe) {
                const controls = document.getElementById('player-web-controls');
                if (controls) controls.classList.toggle('hidden', this.isServerBarVisible);
            }
            const main = document.getElementById('app-main');
            if (main) main.scrollTop = 0;
            if (this.serverBar) {
                this.serverBar.classList.toggle('is-visible', this.isServerBarVisible);
                if (this.isServerBarVisible && window.__TV_DEV_LOGS__) {
                    // Diagnóstico en el TV: ¿el panel está realmente arriba en pantalla?
                    setTimeout(() => {
                        const bar = this.serverBar;
                        const style = getComputedStyle(bar);
                        const rect = bar.getBoundingClientRect();
                        const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + 120);
                        this._debug(`panel visible=${style.visibility} opacidad=${style.opacity} rect=${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.width)}x${Math.round(rect.height)} encima=${top ? (top.id || top.className || top.tagName) : 'nada'}`);
                    }, 300);
                }
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
                    if (this.iframe && nav) nav.refreshFocus('#player-web-activate');
                }
            }
            this._showOSD();
        }

        _showStatus(msg, loading = true) {
            if (this.container) {
                const wrapper = document.createElement('div');
                wrapper.className = 'player-loading-state';
                const spinner = document.createElement('div');
                spinner.className = 'spinner';
                const text = document.createElement('p');
                text.textContent = msg;
                if (loading) wrapper.appendChild(spinner);
                wrapper.appendChild(text);
                this.container.innerHTML = '';
                this.container.appendChild(wrapper);
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
            this._debug(`tecla ${code} panel=${this.isServerBarVisible} video=${!!this.video} nav=${window.appNavigation && window.appNavigation.enabled} foco=${document.activeElement && document.activeElement.tagName}`);

            const K = window.TVKeys || {};
            if (this.webInteraction) {
                if (code === K.RETURN || code === K.COLOR_YELLOW) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.releaseWebControl(true);
                }
                return;
            }

            // Aviso "Siguiente episodio" (va antes que Atrás): OK lo reproduce ya, cualquier otra tecla lo cancela
            if (this._nextPromptUrl) {
                e.preventDefault();
                if (code === K.ENTER || code === K.PLAY || code === K.PLAY_PAUSE || code === K.CHANNEL_UP) {
                    this._goToNext();
                } else {
                    this.cancelNextPrompt();
                }
                return;
            }

            if (code === K.STOP) {
                e.preventDefault();
                this.destroy();
                if (this.onClose) this.onClose();
                return;
            }

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

            // Panel abierto: ◀ lo cierra; ▲ también, pero solo desde el primer elemento (la navegación no pudo subir)
            if (this.isServerBarVisible && (code === K.LEFT ||
                (code === K.UP && window.appNavigation && window.appNavigation.lastBlocked === 'UP'))) {
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

            if (this.video && !this.isServerBarVisible && this.activeSkip && (code === K.ENTER || code === K.COLOR_GREEN)) {
                e.preventDefault();
                this._skipSegment();
                return;
            }

            // Verde sin tiempos verificados: avance manual de 85 segundos.
            if (this.video && !this.isServerBarVisible && code === K.COLOR_GREEN) {
                e.preventDefault();
                this._seekBy(85);
                return;
            }

            if (this.iframe && !this.isServerBarVisible && code === K.PLAY) {
                e.preventDefault();
                this.activateWebControl();
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
            this._clearRecoveryTimer();
            this.loadId++; // anula cualquier carga de episodio pendiente
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
            this._resumeTime = null;
            this.streamSources = [];
        }
    }

    window.TVPlayer = TVPlayer;
})(window);
