/**
 * picker.js - Selector de opciones apto para control remoto
 * Los <select> nativos no se abren bien en Tizen con el control: cada select.tv-select se oculta
 * y se reemplaza por un botón que abre un panel de opciones (▲▼ moverse, OK elegir, Atrás cerrar).
 * Al elegir se actualiza el <select> y se dispara 'change', así los listeners existentes siguen funcionando.
 */
(function(window) {
    'use strict';

    function escapeHtml(text) {
        return String(text == null ? '' : text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function labelFor(select) {
        if (select.id) {
            const label = document.querySelector(`label[for="${select.id}"]`);
            // Solo el texto propio del label (no el <small> de ayuda)
            if (label && label.firstChild) return label.firstChild.textContent.replace(/:\s*$/, '').trim();
        }
        return select.getAttribute('aria-label') || '';
    }

    function selectedText(select) {
        const option = select.options[select.selectedIndex];
        return option ? option.textContent.trim() : '';
    }

    const TVPicker = {
        current: null,

        /**
         * Reemplaza los select.tv-select dentro de root por botones-selector
         */
        enhanceAll: function(root) {
            const scope = root || document;
            scope.querySelectorAll('select.tv-select').forEach((select) => {
                if (select.dataset.pickerEnhanced) {
                    this._sync(select);
                    return;
                }
                select.dataset.pickerEnhanced = '1';
                select.removeAttribute('data-focusable');
                select.style.display = 'none';

                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'tv-picker';
                button.setAttribute('data-focusable', 'true');
                button.innerHTML = '<span class="tv-picker-value"></span><span class="tv-picker-caret">▾</span>';
                button.addEventListener('click', () => this.open(select, button));
                select.parentNode.insertBefore(button, select.nextSibling);
                select._pickerButton = button;
                this._sync(select);
            });
        },

        _sync: function(select) {
            if (!select._pickerButton) return;
            select._pickerButton.querySelector('.tv-picker-value').textContent = selectedText(select);
        },

        isOpen: function() {
            return !!this.current;
        },

        open: function(select, button) {
            this.close(false);

            const modal = document.createElement('div');
            modal.className = 'tv-picker-modal is-open';
            modal.setAttribute('data-nav-scope', '');

            let options = '';
            Array.from(select.options).forEach((option, index) => {
                const isSelected = index === select.selectedIndex;
                options += `
                    <button type="button" class="tv-picker-option ${isSelected ? 'is-selected' : ''}" data-focusable="true" data-picker-index="${index}">
                        <span class="tv-picker-check">${isSelected ? '✓' : ''}</span>${escapeHtml(option.textContent.trim())}
                    </button>
                `;
            });

            modal.innerHTML = `
                <div class="tv-picker-panel">
                    <h3 class="tv-picker-title">${escapeHtml(labelFor(select))}</h3>
                    <div class="tv-picker-list">${options}</div>
                    <p class="tv-picker-hint">▲▼ Moverse · OK Elegir · ↩ Cerrar</p>
                </div>
            `;

            modal.addEventListener('click', (e) => {
                const optionEl = e.target.closest('.tv-picker-option');
                if (!optionEl) return;
                const index = parseInt(optionEl.dataset.pickerIndex, 10);
                const changed = index !== select.selectedIndex;
                select.selectedIndex = index;
                this._sync(select);
                this.close(true);
                if (changed) {
                    select.dispatchEvent(new Event('change', { bubbles: true }));
                }
            });

            document.body.appendChild(modal);
            this.current = { modal: modal, select: select, button: button };

            if (window.appNavigation) {
                window.appNavigation.refreshFocus('.tv-picker-option.is-selected');
            }
        },

        /**
         * Cierra el panel; con restoreFocus devuelve el foco al botón que lo abrió
         */
        close: function(restoreFocus) {
            if (!this.current) return;
            const button = this.current.button;
            this.current.modal.remove();
            this.current = null;
            if (restoreFocus !== false && window.appNavigation && button && document.body.contains(button)) {
                window.appNavigation.setFocus(button);
            }
        }
    };

    window.TVPicker = TVPicker;
})(window);
