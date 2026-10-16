/**
 * storage.js - Gestión de almacenamiento local para Tizen Smart TV
 * Maneja historial, episodios vistos, favoritos y configuración
 */
(function(window) {
    'use strict';

    const STORAGE_KEYS = {
        WATCHED: 'animeyt_watched_v1',
        HISTORY: 'animeyt_history_v1',
        FAVORITES: 'animeyt_favorites_v1',
        SETTINGS: 'animeyt_settings_v1',
        PROGRESS: 'animeyt_progress_v1'
    };

    const DEFAULT_SETTINGS = {
        preferredServer: 'auto', // 'auto', 'ok', 'abyss', 'epsilon', 'byse', 'alpha', 'mega'
        preferredQuality: '1080p', // '1080p', '720p', '480p', '360p' (servidores con video directo)
        autoPlay: true,
        autoNext: true
    };

    const TVStorage = {
        /**
         * Marca un episodio como visto o no visto
         */
        toggleWatched: function(episodeIdOrUrl) {
            if (!episodeIdOrUrl) return false;
            const watched = this.getWatched();
            const isWatched = !!watched[episodeIdOrUrl];
            if (isWatched) {
                delete watched[episodeIdOrUrl];
            } else {
                watched[episodeIdOrUrl] = Date.now();
            }
            try {
                localStorage.setItem(STORAGE_KEYS.WATCHED, JSON.stringify(watched));
            } catch (e) {
                console.error('[TVStorage] Error guardando episodio visto:', e);
            }
            return !isWatched;
        },

        isWatched: function(episodeIdOrUrl) {
            if (!episodeIdOrUrl) return false;
            const watched = this.getWatched();
            return !!watched[episodeIdOrUrl];
        },

        setWatched: function(episodeIdOrUrl, status) {
            if (!episodeIdOrUrl) return;
            const watched = this.getWatched();
            if (status) {
                watched[episodeIdOrUrl] = Date.now();
            } else {
                delete watched[episodeIdOrUrl];
            }
            try {
                localStorage.setItem(STORAGE_KEYS.WATCHED, JSON.stringify(watched));
            } catch (e) {}
        },

        getWatched: function() {
            try {
                const data = localStorage.getItem(STORAGE_KEYS.WATCHED);
                return data ? JSON.parse(data) : {};
            } catch (e) {
                return {};
            }
        },

        /**
         * Registra un episodio en el historial de reproducción
         */
        addToHistory: function(item) {
            if (!item || !item.url) return;
            try {
                let history = this.getHistory();
                // Una entrada por episodio; Inicio agrupa las series para Continuar viendo.
                history = history.filter(h => h.url !== item.url);
                history.unshift({
                    title: item.title || '',
                    episode: item.episode || '',
                    url: item.url,
                    animeUrl: item.animeUrl || '',
                    image: item.image || '',
                    nextUrl: item.nextUrl || '',
                    timestamp: Date.now()
                });
                // Guardar máximo 50 entradas
                if (history.length > 50) history = history.slice(0, 50);
                localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(history));
            } catch (e) {
                console.error('[TVStorage] Error guardando historial:', e);
            }
        },

        getHistory: function() {
            try {
                const data = localStorage.getItem(STORAGE_KEYS.HISTORY);
                const parsed = data ? JSON.parse(data) : [];
                return Array.isArray(parsed) ? parsed.filter(item => item && typeof item.url === 'string') : [];
            } catch (e) {
                return [];
            }
        },

        removeHistory: function(url) {
            this._writeJson(STORAGE_KEYS.HISTORY, this.getHistory().filter(item => item.url !== url));
            this.clearProgress(url);
        },

        /**
         * Configuración
         */
        getSettings: function() {
            try {
                const data = localStorage.getItem(STORAGE_KEYS.SETTINGS);
                return data ? Object.assign({}, DEFAULT_SETTINGS, JSON.parse(data)) : Object.assign({}, DEFAULT_SETTINGS);
            } catch (e) {
                return Object.assign({}, DEFAULT_SETTINGS);
            }
        },

        saveSettings: function(settings) {
            try {
                const current = this.getSettings();
                const merged = Object.assign({}, current, settings);
                localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(merged));
                return merged;
            } catch (e) {
                console.error('[TVStorage] Error guardando configuración:', e);
                return DEFAULT_SETTINGS;
            }
        },

        /**
         * Posición de reproducción por episodio (para "Continuar viendo" y reanudar)
         */
        getProgress: function(url) {
            if (!url) return null;
            return this._readJson(STORAGE_KEYS.PROGRESS, {})[url] || null;
        },

        getAllProgress: function() {
            return this._readJson(STORAGE_KEYS.PROGRESS, {});
        },

        saveProgress: function(url, time, duration) {
            if (!url || !isFinite(time) || !isFinite(duration) || duration <= 0) return;
            const all = this._readJson(STORAGE_KEYS.PROGRESS, {});
            all[url] = { time: Math.floor(time), duration: Math.floor(duration), updated: Date.now() };
            // Conservar solo los 100 más recientes
            const urls = Object.keys(all);
            if (urls.length > 100) {
                urls.sort((a, b) => all[a].updated - all[b].updated);
                urls.slice(0, urls.length - 100).forEach(u => { delete all[u]; });
            }
            this._writeJson(STORAGE_KEYS.PROGRESS, all);
        },

        clearProgress: function(url) {
            const all = this._readJson(STORAGE_KEYS.PROGRESS, {});
            delete all[url];
            this._writeJson(STORAGE_KEYS.PROGRESS, all);
        },

        /**
         * Mi lista (favoritos)
         */
        getFavorites: function() {
            return this._readJson(STORAGE_KEYS.FAVORITES, []);
        },

        isFavorite: function(animeUrl) {
            return this.getFavorites().some(f => f.url === animeUrl);
        },

        toggleFavorite: function(anime) {
            if (!anime || !anime.url) return false;
            let favorites = this.getFavorites();
            const exists = favorites.some(f => f.url === anime.url);
            if (exists) {
                favorites = favorites.filter(f => f.url !== anime.url);
            } else {
                favorites.unshift({ url: anime.url, title: anime.title || '', image: anime.image || '', added: Date.now() });
            }
            this._writeJson(STORAGE_KEYS.FAVORITES, favorites);
            return !exists;
        },

        /**
         * Actualiza título/imagen de una serie ya guardada (p. ej. póster al abrir su ficha)
         */
        refreshFavorite: function(anime) {
            if (!anime || !anime.url) return;
            const favorites = this.getFavorites();
            let changed = false;
            favorites.forEach(f => {
                if (f.url === anime.url) {
                    if (anime.title && f.title !== anime.title) { f.title = anime.title; changed = true; }
                    if (anime.image && f.image !== anime.image) { f.image = anime.image; changed = true; }
                }
            });
            if (changed) this._writeJson(STORAGE_KEYS.FAVORITES, favorites);
        },

        _readJson: function(key, fallback) {
            try {
                const data = localStorage.getItem(key);
                const parsed = data ? JSON.parse(data) : fallback;
                if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) !== Array.isArray(fallback)) return fallback;
                return parsed;
            } catch (e) {
                return fallback;
            }
        },

        _writeJson: function(key, value) {
            try {
                localStorage.setItem(key, JSON.stringify(value));
            } catch (e) {
                console.error('[TVStorage] Error guardando', key, e);
            }
        },

        /**
         * Limpieza
         */
        clearHistory: function() {
            localStorage.removeItem(STORAGE_KEYS.HISTORY);
            localStorage.removeItem(STORAGE_KEYS.PROGRESS);
        },

        clearWatched: function() {
            localStorage.removeItem(STORAGE_KEYS.WATCHED);
        },

        clearAll: function() {
            localStorage.removeItem(STORAGE_KEYS.HISTORY);
            localStorage.removeItem(STORAGE_KEYS.WATCHED);
            localStorage.removeItem(STORAGE_KEYS.FAVORITES);
            localStorage.removeItem(STORAGE_KEYS.SETTINGS);
            localStorage.removeItem(STORAGE_KEYS.PROGRESS);
            localStorage.removeItem('animeyt_series_v1');
            localStorage.removeItem('animeyt_skip_v1');
        }
    };

    window.TVStorage = TVStorage;
})(window);
