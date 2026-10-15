/**
 * navigation.js - Sistema de navegación espacial D-pad para Samsung Smart TV
 * Manejo de foco 10-foot UI, soporte para teclado virtual Tizen IME y atajos de control remoto
 */
(function(window) {
    'use strict';

    class TVNavigation {
        constructor() {
            this.currentFocus = null;
            this.selector = '[data-focusable="true"]';
            this.enabled = true;
            this.onBack = null;
            this.onColorKey = null;
            this.onFocusChange = null;

            this._handleKeyDown = this._handleKeyDown.bind(this);
            window.addEventListener('keydown', this._handleKeyDown, true);
        }

        /**
         * Inicializa o actualiza el foco en el contenedor activo
         */
        refreshFocus(preferredSelector = null) {
            const candidates = this.getFocusableElements();
            if (!candidates.length) {
                this.currentFocus = null;
                return;
            }

            let target = null;
            if (preferredSelector) {
                target = document.querySelector(preferredSelector);
            }

            if (!target || !candidates.includes(target)) {
                // Mantener el actual si sigue existiendo y es visible
                if (this.currentFocus && candidates.includes(this.currentFocus)) {
                    target = this.currentFocus;
                } else {
                    target = candidates[0];
                }
            }

            this.setFocus(target);
        }

        /**
         * Obtiene todos los elementos enfocables visibles en pantalla
         */
        getFocusableElements() {
            // Un panel abierto con data-nav-scope (barra de servidores, selector de opciones)
            // atrapa el foco: solo se navega dentro de él
            const scopes = document.querySelectorAll('[data-nav-scope].is-open, [data-nav-scope].is-visible');
            const root = scopes.length ? scopes[scopes.length - 1] : document;
            const all = Array.from(root.querySelectorAll(this.selector));
            return all.filter(el => {
                // Descartar elementos dentro de vistas ocultas
                if (el.closest('.view.hidden') || el.closest('[hidden]')) return false;
                const rect = el.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0 && window.getComputedStyle(el).display !== 'none';
            });
        }

        /**
         * Asigna el foco visual y funcional a un elemento
         */
        setFocus(element, scroll = true) {
            if (!element) return;

            if (this.currentFocus && this.currentFocus !== element) {
                this.currentFocus.classList.remove('has-focus');
            }

            this.currentFocus = element;
            this.currentFocus.classList.add('has-focus');

            // Recordar la última tarjeta enfocada de cada fila (al volver a la fila se retoma ahí)
            const row = element.closest('[data-nav-row]');
            if (row) row._lastFocus = element;

            if (typeof this.onFocusChange === 'function') {
                this.onFocusChange(element);
            }

            // Dentro del reproductor nunca se desplaza la pantalla (el panel de servidores ya está a la vista)
            if (scroll && !element.closest('[data-nav-noscroll]') && !this._scrollRow(element)) {
                this.currentFocus.scrollIntoView({
                    behavior: 'auto', // smooth es muy costoso en el GPU del TV
                    block: 'center',
                    inline: 'center'
                });
            }
        }

        /**
         * Filas horizontales (estilo Netflix): desplaza la fila con transform para que la tarjeta quede
         * visible, y si la fila está dentro de un [data-nav-scroller] sube la fila hasta el ancla.
         * Devuelve false si el elemento no está en una fila con pista.
         */
        _scrollRow(element) {
            const row = element.closest('[data-nav-row]');
            const track = row ? row.querySelector('[data-row-track]') : null;
            if (!track) return false;

            const viewportWidth = track.parentNode.clientWidth -
                parseFloat(getComputedStyle(track.parentNode).paddingLeft) -
                parseFloat(getComputedStyle(track.parentNode).paddingRight);
            const maxOffset = Math.max(0, track.scrollWidth - viewportWidth);
            const offset = Math.max(0, Math.min(element.offsetLeft - track.offsetLeft, maxOffset));
            track.style.transform = `translateX(${-offset}px)`;

            const scroller = row.closest('[data-nav-scroller]');
            if (scroller && scroller.firstElementChild) {
                const anchor = parseInt(scroller.dataset.navAnchor || '0', 10);
                const y = Math.max(0, row.offsetTop - anchor);
                scroller.firstElementChild.style.transform = `translateY(${-y}px)`;
            }
            return true;
        }

        /**
         * Encuentra el siguiente elemento más cercano en la dirección dada
         */
        findNext(direction) {
            const current = this.currentFocus;
            if (!current) return this.getFocusableElements()[0] || null;

            let candidates = this.getFocusableElements().filter(el => el !== current);

            // En una fila horizontal, ◀ ▶ no salen de la fila: al llegar al extremo no se mueve
            // (si no, saltaba en diagonal a la fila de abajo cuando la fila es corta)
            const currentRow = current.closest('[data-nav-row]');
            if (currentRow && (direction === 'LEFT' || direction === 'RIGHT')) {
                candidates = candidates.filter(el => currentRow.contains(el));
            }
            if (!candidates.length) return null;

            // ▲ ▼ entre filas: ir siempre a la fila contigua (aunque sea corta y sus tarjetas queden lejos)
            if (currentRow && (direction === 'UP' || direction === 'DOWN')) {
                const adjacent = this._adjacentRowTarget(current, currentRow, direction, candidates);
                if (adjacent) return adjacent;
            }

            const cRect = current.getBoundingClientRect();
            const cCenter = {
                x: cRect.left + cRect.width / 2,
                y: cRect.top + cRect.height / 2
            };

            // Filtrar solo los candidatos que se encuentran en el cuadrante de la dirección
            const filtered = candidates.filter(el => {
                const rect = el.getBoundingClientRect();
                const center = {
                    x: rect.left + rect.width / 2,
                    y: rect.top + rect.height / 2
                };

                const dx = center.x - cCenter.x;
                const dy = center.y - cCenter.y;

                switch (direction) {
                    case 'UP':
                        return dy < -5 && Math.abs(dx) <= Math.abs(dy) * 1.8;
                    case 'DOWN':
                        return dy > 5 && Math.abs(dx) <= Math.abs(dy) * 1.8;
                    case 'LEFT':
                        return dx < -5 && Math.abs(dy) <= Math.abs(dx) * 1.8;
                    case 'RIGHT':
                        return dx > 5 && Math.abs(dy) <= Math.abs(dx) * 1.8;
                    default:
                        return false;
                }
            });

            let best;
            if (!filtered.length) {
                // Fallback con tolerancia geométrica más amplia si no hay en cono directo
                best = this._fallbackFind(current, direction, candidates);
            } else {
                // Seleccionar el más cercano mediante ponderación euclidiana
                best = this._closest(filtered, cCenter);
            }

            // Al saltar a otra fila (arriba/abajo) retomar la tarjeta donde se quedó
            if (best && (direction === 'UP' || direction === 'DOWN')) {
                const targetRow = best.closest('[data-nav-row]');
                if (targetRow && targetRow !== currentRow && targetRow._lastFocus &&
                    targetRow.contains(targetRow._lastFocus) && candidates.indexOf(targetRow._lastFocus) !== -1) {
                    return targetRow._lastFocus;
                }
            }
            return best;
        }

        /**
         * Tarjeta destino en la fila de arriba/abajo: la última enfocada de esa fila o la más cercana en horizontal.
         * Devuelve null si no hay fila contigua (p. ej. ▲ desde la primera fila va al billboard).
         */
        _adjacentRowTarget(current, currentRow, direction, candidates) {
            const rows = Array.from(currentRow.parentNode.querySelectorAll(':scope > [data-nav-row]'));
            let index = rows.indexOf(currentRow);
            const step = direction === 'UP' ? -1 : 1;

            for (index += step; index >= 0 && index < rows.length; index += step) {
                const row = rows[index];
                const inRow = candidates.filter(el => row.contains(el));
                if (!inRow.length) continue;

                if (row._lastFocus && inRow.indexOf(row._lastFocus) !== -1) return row._lastFocus;

                const cRect = current.getBoundingClientRect();
                const cx = cRect.left + cRect.width / 2;
                return inRow.reduce((best, el) => {
                    const r = el.getBoundingClientRect();
                    const b = best.getBoundingClientRect();
                    return Math.abs(r.left + r.width / 2 - cx) < Math.abs(b.left + b.width / 2 - cx) ? el : best;
                });
            }
            return null;
        }

        _closest(elements, cCenter) {
            return elements.reduce((closest, el) => {
                const rect = el.getBoundingClientRect();
                const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
                const dist = Math.hypot(center.x - cCenter.x, center.y - cCenter.y);

                const closestRect = closest.getBoundingClientRect();
                const closestCenter = { x: closestRect.left + closestRect.width / 2, y: closestRect.top + closestRect.height / 2 };
                const closestDist = Math.hypot(closestCenter.x - cCenter.x, closestCenter.y - cCenter.y);

                return dist < closestDist ? el : closest;
            });
        }

        _fallbackFind(current, direction, candidates) {
            const cRect = current.getBoundingClientRect();
            const valid = candidates.filter(el => {
                const rect = el.getBoundingClientRect();
                if (direction === 'UP') return rect.bottom <= cRect.top + 10;
                if (direction === 'DOWN') return rect.top >= cRect.bottom - 10;
                if (direction === 'LEFT') return rect.right <= cRect.left + 10;
                if (direction === 'RIGHT') return rect.left >= cRect.right - 10;
                return false;
            });

            if (!valid.length) return null;

            return valid.reduce((best, el) => {
                const r1 = el.getBoundingClientRect();
                const r2 = best.getBoundingClientRect();
                const d1 = Math.hypot(r1.left - cRect.left, r1.top - cRect.top);
                const d2 = Math.hypot(r2.left - cRect.left, r2.top - cRect.top);
                return d1 < d2 ? el : best;
            });
        }

        /**
         * Manejador global de eventos de teclado del control remoto
         */
        _handleKeyDown(e) {
            if (!this.enabled) return;

            const code = window.TVKeys ? window.TVKeys.normalizeEvent(e) : e.keyCode;
            const activeTag = (document.activeElement && document.activeElement.tagName || '').toLowerCase();
            const isTyping = activeTag === 'input' || activeTag === 'textarea';

            // Ajuste crítico 4: Manejo del teclado en pantalla en inputs de búsqueda
            if (code === (window.TVKeys ? window.TVKeys.RETURN : 10009)) {
                if (isTyping) {
                    // Cierra el teclado virtual sin navegar hacia atrás
                    e.preventDefault();
                    e.stopPropagation();
                    document.activeElement.blur();
                    if (this.currentFocus) this.currentFocus.classList.add('has-focus');
                    return;
                }
                if (typeof this.onBack === 'function') {
                    e.preventDefault();
                    this.onBack();
                    return;
                }
            }

            // Si está escribiendo en el teclado nativo, dejar que el navegador/Tizen procese teclas excepto flechas de escape
            if (isTyping) {
                if (code === 13) { // Enter al escribir
                    // Permite enviar búsqueda o procesar enter
                    return;
                }
                if (code === 38 || code === 40) { // Flechas arriba/abajo desenfocan para volver a navegar
                    document.activeElement.blur();
                } else {
                    return; // Permite escribir letras y números
                }
            }

            // Teclas de colores de Samsung (Rojo, Verde, Amarillo, Azul)
            if ([window.TVKeys.COLOR_RED, window.TVKeys.COLOR_GREEN, window.TVKeys.COLOR_YELLOW, window.TVKeys.COLOR_BLUE].includes(code)) {
                if (typeof this.onColorKey === 'function') {
                    e.preventDefault();
                    this.onColorKey(code);
                    return;
                }
            }

            // Navegación D-pad
            let next = null;
            if (code === window.TVKeys.UP) {
                e.preventDefault();
                next = this.findNext('UP');
            } else if (code === window.TVKeys.DOWN) {
                e.preventDefault();
                next = this.findNext('DOWN');
            } else if (code === window.TVKeys.LEFT) {
                e.preventDefault();
                next = this.findNext('LEFT');
            } else if (code === window.TVKeys.RIGHT) {
                e.preventDefault();
                next = this.findNext('RIGHT');
            } else if (code === window.TVKeys.ENTER) {
                e.preventDefault();
                if (this.currentFocus) {
                    // Ajuste crítico 4: Abrir teclado virtual explícitamente en inputs
                    if (this.currentFocus.tagName.toLowerCase() === 'input') {
                        this.currentFocus.focus();
                    } else {
                        this.currentFocus.click();
                    }
                }
                return;
            }

            if (next) {
                this.setFocus(next);
            }
        }
    }

    window.TVNavigation = TVNavigation;
})(window);
