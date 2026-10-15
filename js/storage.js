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
        SETTINGS: 'animeyt_settings_v1'
    };

    const DEFAULT_SETTINGS = {
        preferredServer: 'auto', // 'auto', 'ok', 'abyss', 'epsilon', 'byse', 'alpha', 'mega'
        preferredQuality: '1080p',
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
                // Filtrar duplicados por URL de anime o episodio
                history = history.filter(h => h.url !== item.url && h.animeUrl !== item.animeUrl);
                history.unshift({
                    title: item.title || '',
                    episode: item.episode || '',
                    url: item.url,
                    animeUrl: item.animeUrl || '',
                    image: item.image || '',
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
                return data ? JSON.parse(data) : [];
            } catch (e) {
                return [];
            }
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
         * Limpieza
         */
        clearHistory: function() {
            localStorage.removeItem(STORAGE_KEYS.HISTORY);
        },

        clearWatched: function() {
            localStorage.removeItem(STORAGE_KEYS.WATCHED);
        },

        clearAll: function() {
            localStorage.removeItem(STORAGE_KEYS.HISTORY);
            localStorage.removeItem(STORAGE_KEYS.WATCHED);
            localStorage.removeItem(STORAGE_KEYS.FAVORITES);
            localStorage.removeItem(STORAGE_KEYS.SETTINGS);
        }
    };

    window.TVStorage = TVStorage;
})(window);
