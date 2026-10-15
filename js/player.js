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
            this.shield = null;
            this.focusKeeperInterval = null;
            this.osdTimeout = null;

            this.servers = [];
            this.currentServerIndex = 0;
            this.currentEpisode = null;
            this.isPlaying = false;
            this.isServerBarVisible = false;

            this.onEpisodeChange = options.onEpisodeChange || null;
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
                this.currentEpisode.listUrl = containerInfo.listUrl;

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
                        title: episodeData.animeTitle || episodeData.title,
                        episode: episodeData.episode,
                        url: episodeData.url,
                        animeUrl: episodeData.animeUrl || containerInfo.listUrl,
                        image: episodeData.image
                    });
                }

                this._showOSD();
            } catch (err) {
                console.error('[TVPlayer] Error cargando episodio:', err);
                this._showStatus(`Error: ${err.message || 'No se pudo reproducir'}`);
            }
        }

        /**
         * Monta el iframe sandboxed del servidor actual
         */
        _mountCurrentServer() {
            const server = this.servers[this.currentServerIndex];
            if (!server) return;

            if (this.serverLabelEl) {
                this.serverLabelEl.textContent = `Servidor: ${server.label} (${server.title || 'HD'})`;
            }

            // Limpieza previa completa
            if (this.iframe) {
                this.iframe.src = 'about:blank';
                this.iframe.remove();
                this.iframe = null;
            }

            // Construir iframe blindado contra anuncios y redirecciones
            const iframe = document.createElement('iframe');
            const targetUrl = this._enhanceAutoplayUrl(server.url);

            // SANDBOX CRÍTICO: bloquea pop-ups, pop-unders y navegación fuera de la app
            // No incluimos 'allow-popups' ni 'allow-top-navigation'
            iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation allow-forms');
            iframe.setAttribute('allow', 'autoplay; fullscreen; encrypted-media; picture-in-picture');
            iframe.setAttribute('frameborder', '0');
            iframe.setAttribute('scrolling', 'no');
            iframe.style.cssText = 'width: 100vw; height: 100vh; border: none; background: #000; position: absolute; top: 0; left: 0; z-index: 1;';
            iframe.src = targetUrl;

            this.container.innerHTML = '';
            this.container.appendChild(iframe);
            this.iframe = iframe;

            // Capa transparente superior que asegura captura de clicks/foco si es necesario
            this._createShield();

            this._updateServerButtonsState();
            this._showOSD();
        }

        /**
         * Crea el escudo que previene clicks no deseados
         */
        _createShield() {
            if (this.shield) this.shield.remove();
            const shield = document.createElement('div');
            shield.className = 'player-shield';
            shield.style.cssText = 'position: absolute; inset: 0; z-index: 2; pointer-events: none;';
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
        _renderServerBar() {
            if (!this.serverList) return;
            this.serverList.innerHTML = '';

            this.servers.forEach((server, index) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = `player-server-btn ${index === this.currentServerIndex ? 'is-active' : ''}`;
                btn.setAttribute('data-focusable', 'true');
                btn.setAttribute('data-server-index', index);
                btn.innerHTML = `
                    <span class="server-num">${index + 1}</span>
                    <span class="server-name">${server.label}</span>
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
            if (this.serverBar) {
                this.serverBar.classList.toggle('is-visible', this.isServerBarVisible);
                if (this.isServerBarVisible && window.appNavigation) {
                    // Enfocar el botón del servidor activo
                    window.appNavigation.refreshFocus('.player-server-btn.is-active');
                } else {
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

            if (this.iframe) {
                this.iframe.src = 'about:blank';
                this.iframe.remove();
                this.iframe = null;
            }

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
