/**
 * api.js - Cliente REST para la API de AnimeYT
 * Consume el endpoint nativo /wp-json/aniyt/v1/catalog/search
 */
(function(window) {
    'use strict';

    const API_BASE = 'https://animeyt.cc/wp-json/aniyt/v1';

    /**
     * Resuelve cómo llegar a animeyt.cc / mytsumi.com según dónde corre la app:
     * - TizenBrew (servida en 127.0.0.1:8081): vía el servicio proxy del módulo (service/proxy.js)
     * - Navegador con dev-server.js: vía /proxy del mismo origen
     * - .wgt instalado: directo (el widget no aplica CORS)
     */
    const TVNet = {
        proxyBase: function() {
            if (window.location.host === '127.0.0.1:8081') {
                return 'http://127.0.0.1:8085/proxy?url=';
            }
            const isHttp = window.location.protocol === 'http:' || window.location.protocol === 'https:';
            if (isHttp && typeof window.tizen === 'undefined') {
                return '/proxy?url=';
            }
            return '';
        },

        url: function(targetUrl) {
            const base = TVNet.proxyBase();
            return base ? base + encodeURIComponent(targetUrl) : targetUrl;
        },

        // Solo aplica en TizenBrew; reintenta /ping hasta ~10s
        waitForProxy: async function() {
            if (window.location.host !== '127.0.0.1:8081') return;
            for (let i = 0; i < 20; i++) {
                try {
                    const res = await fetch('http://127.0.0.1:8085/ping');
                    if (res.ok) return;
                } catch (e) {
                    // el servicio aún no escucha
                }
                await new Promise(function(resolve) { setTimeout(resolve, 500); });
            }
            console.warn('[TVNet] El proxy de TizenBrew no respondió');
        },

        // Con proxy cross-origin (Access-Control-Allow-Origin: *) no se pueden enviar credenciales
        credentials: function() {
            return TVNet.proxyBase() ? 'omit' : 'include';
        }
    };

    const TVApi = {
        /**
         * Busca animes usando el endpoint JSON real de WordPress
         * @param {string} query Término de búsqueda
         * @returns {Promise<Array>} Lista de resultados
         */
        search: async function(query) {
            if (!query || !query.trim()) {
                return [];
            }

            const cleanQuery = query.trim();
            const endpoint = `${API_BASE}/catalog/search?q=${encodeURIComponent(cleanQuery)}`;

            const targetFetchUrl = TVNet.url(endpoint);

            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 20000);

                const response = await fetch(targetFetchUrl, {
                    method: 'GET',
                    headers: {
                        'Accept': 'application/json'
                    },
                    credentials: TVNet.credentials(),
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

                if (!response.ok) {
                    console.warn(`[TVApi] Error HTTP en búsqueda: ${response.status}`);
                    return [];
                }

                const data = await response.json();
                if (data && Array.isArray(data.results)) {
                    return data.results.map(function(item) {
                        return {
                            id: item.id || '',
                            title: item.title || '',
                            titleEnglish: item.title_english || '',
                            type: item.type || 'TV',
                            status: item.status || '',
                            season: item.season || '',
                            rating: item.rating || 0,
                            url: item.url || '',
                            image: item.image || ''
                        };
                    });
                }

                return [];
            } catch (err) {
                if (err.name === 'AbortError') {
                    console.warn('[TVApi] Búsqueda cancelada por timeout');
                } else {
                    console.error('[TVApi] Error de red en búsqueda:', err);
                }
                return [];
            }
        }
    };

    window.TVNet = TVNet;
    window.TVApi = TVApi;
})(window);
