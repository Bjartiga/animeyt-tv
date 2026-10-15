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
            const all = Array.from(document.querySelectorAll(this.selector));
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

            if (scroll) {
                this.currentFocus.scrollIntoView({
                    behavior: 'smooth',
                    block: 'center',
                    inline: 'center'
                });
            }
        }

        /**
         * Encuentra el siguiente elemento más cercano en la dirección dada
         */
        findNext(direction) {
            const current = this.currentFocus;
            if (!current) return this.getFocusableElements()[0] || null;

            const candidates = this.getFocusableElements().filter(el => el !== current);
            if (!candidates.length) return null;

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

            if (!filtered.length) {
                // Fallback con tolerancia geométrica más amplia si no hay en cono directo
                return this._fallbackFind(current, direction, candidates);
            }

            // Seleccionar el más cercano mediante ponderación euclidiana
            return filtered.reduce((closest, el) => {
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
