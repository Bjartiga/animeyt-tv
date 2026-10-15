/**
 * keys.js - Mapeo de teclas Samsung Tizen + Emulación en Navegador PC
 */
(function(window) {
    'use strict';

    const TVKeys = {
        // Direcciones y Acción
        UP: 38,
        DOWN: 40,
        LEFT: 37,
        RIGHT: 39,
        ENTER: 13,

        // Navegación
        RETURN: 10009,
        EXIT: 10182,

        // Botones de colores Samsung
        COLOR_RED: 403,
        COLOR_GREEN: 404,
        COLOR_YELLOW: 405,
        COLOR_BLUE: 406,

        // Teclas Multimedia
        PLAY: 415,
        PAUSE: 19,
        PLAY_PAUSE: 10252,
        STOP: 413,
        REWIND: 412,
        FAST_FORWARD: 417,

        // Canales (Siguiente / Anterior capítulo)
        CHANNEL_UP: 427,
        CHANNEL_DOWN: 428,
        INFO: 457,

        // Mapeos de compatibilidad en Navegador PC
        PC_BACKSPACE: 8,
        PC_ESCAPE: 27,
        PC_SPACE: 32,
        PC_F1: 112,
        PC_F2: 113,
        PC_F3: 114,
        PC_F4: 115,
        PC_PAGE_UP: 33,
        PC_PAGE_DOWN: 34,

        /**
         * Registra las teclas en el sistema Tizen Smart TV
         */
        registerKeys: function() {
            if (typeof tizen !== 'undefined' && tizen.tvinputdevice) {
                const keys = [
                    'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue',
                    'MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop',
                    'MediaRewind', 'MediaFastForward', 'MediaTrackPrevious', 'MediaTrackNext',
                    'Info', 'Exit', 'ChannelUp', 'ChannelDown',
                    'VolumeUp', 'VolumeDown', 'VolumeMute',
                    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'
                ];
                keys.forEach(function(keyName) {
                    try {
                        tizen.tvinputdevice.registerKey(keyName);
                    } catch (e) {
                        console.warn('[TVKeys] No se pudo registrar la tecla:', keyName, e);
                    }
                });
                console.log('[TVKeys] Teclas Samsung registradas exitosamente en Tizen');
            } else {
                console.log('[TVKeys] Modo PC/Navegador activado (F1=Rojo, F2=Verde, F3=Amarillo, F4=Azul, Esc/Backspace=Atrás)');
            }
        },

        /**
         * Normaliza cualquier evento de teclado a los códigos canónicos de Samsung
         */
        normalizeEvent: function(e) {
            const code = e.keyCode || e.which;

            // Retorno / Atrás: Esc o Backspace en PC (siempre que no estemos escribiendo en un input)
            if (code === this.PC_ESCAPE || code === this.PC_BACKSPACE) {
                const tag = (document.activeElement && document.activeElement.tagName) ? document.activeElement.tagName.toLowerCase() : '';
                const isTyping = tag === 'input' || tag === 'textarea';
                if (code === this.PC_ESCAPE || (!isTyping && code === this.PC_BACKSPACE)) {
                    return this.RETURN;
                }
            }

            // Botones de colores: F1..F4 en PC
            if (code === this.PC_F1) return this.COLOR_RED;
            if (code === this.PC_F2) return this.COLOR_GREEN;
            if (code === this.PC_F3) return this.COLOR_YELLOW;
            if (code === this.PC_F4) return this.COLOR_BLUE;

            // Multimedia: Barra espaciadora en PC (cuando no se escribe) -> Play/Pause
            if (code === this.PC_SPACE) {
                const tag = (document.activeElement && document.activeElement.tagName) ? document.activeElement.tagName.toLowerCase() : '';
                if (tag !== 'input' && tag !== 'textarea') {
                    return this.PLAY_PAUSE;
                }
            }

            // Canales: PageUp / PageDown en PC
            if (code === this.PC_PAGE_UP) return this.CHANNEL_UP;
            if (code === this.PC_PAGE_DOWN) return this.CHANNEL_DOWN;

            return code;
        }
    };

    window.TVKeys = TVKeys;
})(window);
