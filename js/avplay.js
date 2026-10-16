/** Adaptador HLS de Samsung. Mantiene la interfaz de medios que usa TVPlayer. */
(function(window) {
    'use strict';
    window.TVAVPlay = {
        supports: function(stream) {
            return !!(window.webapis && window.webapis.avplay && /mpegurl/i.test(stream.type || ''));
        },
        create: function(stream) {
            const api = window.webapis.avplay;
            const element = document.createElement('object');
            element.type = 'application/avplayer';
            const events = {};
            let closed = false, prepared = false, preparing = false, seeking = false;
            let duration = NaN, time = 0, paused = true, ended = false, pendingSeek = null;
            let wantsPlay = false;
            const emit = function(name) {
                if (!closed) (events[name] || []).slice().forEach(function(fn) { fn(); });
            };
            element.addEventListener = function(name, fn) { (events[name] || (events[name] = [])).push(fn); };
            const fail = function(error) {
                if (closed) return;
                element.error = { code: String(error || 'AVPlay') };
                emit('error');
            };
            function run() {
                if (closed || !prepared || seeking) return;
                if (pendingSeek !== null) {
                    const target = pendingSeek;
                    pendingSeek = null;
                    seeking = true;
                    try {
                        api.seekTo(Math.round(target * 1000), function() {
                            if (closed) return;
                            seeking = false;
                            time = target;
                            run();
                        }, function(error) { seeking = false; fail(error); });
                    } catch (error) { seeking = false; fail(error); }
                    return;
                }
                if (wantsPlay && paused) {
                    try { api.play(); paused = false; ended = false; } catch (error) { fail(error); }
                }
            }
            Object.defineProperties(element, {
                duration: { get: function() { return duration; } },
                currentTime: {
                    get: function() { return time; },
                    set: function(value) {
                        if (closed || !isFinite(value)) return;
                        pendingSeek = Math.max(0, Math.min(isFinite(duration) ? Math.max(0, duration - 0.1) : Infinity, value));
                        run();
                    }
                },
                paused: { get: function() { return paused; } },
                ended: { get: function() { return ended; } }
            });
            element.pause = function() {
                const requested = wantsPlay;
                wantsPlay = false;
                if (closed) return;
                if (paused) { if (requested) emit('pause'); return; }
                try { api.pause(); paused = true; emit('pause'); } catch (error) { fail(error); }
            };
            element.play = function() {
                if (closed) return Promise.resolve();
                wantsPlay = true;
                if (prepared) { run(); return Promise.resolve(); }
                if (preparing) return Promise.resolve();
                preparing = true;
                try {
                    api.open(stream.url);
                    api.setListener({
                        onbufferingstart: function() { if (wantsPlay) emit('waiting'); },
                        onbufferingcomplete: function() { if (!paused) emit('playing'); },
                        oncurrentplaytime: function(milliseconds) {
                            if (closed) return;
                            time = milliseconds / 1000;
                            if (!paused) emit('playing');
                            emit('timeupdate');
                        },
                        onstreamcompleted: function() { ended = true; paused = true; wantsPlay = false; emit('ended'); },
                        onerror: fail
                    });
                    api.setDisplayRect(0, 0, 1920, 1080);
                    api.setDisplayMethod('PLAYER_DISPLAY_MODE_LETTER_BOX');
                    api.prepareAsync(function() {
                        if (closed) return;
                        try {
                            duration = api.getDuration() / 1000;
                            // loadedmetadata puede solicitar reanudación. Se termina el seek antes de play().
                            emit('loadedmetadata');
                            prepared = true;
                            run();
                        } catch (error) { fail(error); }
                    }, fail);
                } catch (error) { return Promise.reject(error); }
                return Promise.resolve();
            };
            element.destroyMedia = function() {
                if (closed) return;
                closed = true;
                wantsPlay = false;
                // AVPlay es singleton: callbacks antiguos no deben tocar la siguiente sesión.
                try { api.stop(); } catch (error) { /* puede estar preparando */ }
                try { api.close(); } catch (error) { /* ya cerrado */ }
                element.remove();
            };
            return element;
        }
    };
})(window);
