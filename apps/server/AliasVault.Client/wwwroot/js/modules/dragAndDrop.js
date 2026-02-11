/**
 * Drag and Drop module for reorderable lists in Blazor.
 * Uses HTML5 Drag and Drop API with placeholder-based visual feedback.
 */

/**
 * Initialize drag and drop functionality on a sortable list.
 * @param {string} containerId - The ID of the container element
 * @param {object} dotNetRef - Reference to the .NET object for callbacks
 */
export function initDragAndDrop(containerId, dotNetRef) {
    const container = document.getElementById(containerId);
    if (!container) {
        console.warn(`DragAndDrop: Container with ID '${containerId}' not found`);
        return;
    }

    let draggedItem = null;
    let draggedIndex = -1;
    let currentDropIndex = -1;
    let placeholder = null;
    let draggedItemHeight = 0;

    /**
     * Create a placeholder element for visual feedback.
     * @param {number} height - Height of the placeholder
     * @returns {HTMLElement} The placeholder element
     */
    function createPlaceholder(height) {
        const el = document.createElement('div');
        el.className = 'drag-placeholder';
        el.style.cssText = `
            height: ${height}px;
            margin: 8px 0;
            background: rgba(249, 115, 22, 0.1);
            border: 2px dashed rgba(249, 115, 22, 0.6);
            border-radius: 8px;
            transition: height 0.15s ease-out;
        `;
        return el;
    }

    /**
     * Get all draggable items in the container (excluding placeholder).
     * @returns {HTMLElement[]} Array of draggable items
     */
    function getItems() {
        return Array.from(container.querySelectorAll('[data-drag-item]'));
    }

    /**
     * Get the index of an item in the container.
     * @param {HTMLElement} item - The item element
     * @returns {number} The index of the item
     */
    function getItemIndex(item) {
        return getItems().indexOf(item);
    }

    /**
     * Remove the placeholder from the DOM.
     */
    function removePlaceholder() {
        if (placeholder && placeholder.parentNode) {
            placeholder.parentNode.removeChild(placeholder);
        }
        placeholder = null;
    }

    /**
     * Insert placeholder at the correct position based on mouse Y position.
     * @param {number} mouseY - The Y position of the mouse
     */
    function updatePlaceholderPosition(mouseY) {
        const items = getItems();
        let insertIndex = items.length; // Default to end

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item === draggedItem) continue;

            const rect = item.getBoundingClientRect();
            const itemMiddle = rect.top + rect.height / 2;

            if (mouseY < itemMiddle) {
                insertIndex = i;
                break;
            }
        }

        // Adjust index if dragging from above
        if (draggedIndex < insertIndex) {
            insertIndex--;
        }

        // Don't update if position hasn't changed
        if (insertIndex === currentDropIndex) return;
        currentDropIndex = insertIndex;

        // Remove existing placeholder
        removePlaceholder();

        // Create and insert new placeholder (use captured height since original is hidden)
        placeholder = createPlaceholder(draggedItemHeight);

        // Find the correct DOM position to insert
        const allItems = getItems();
        let actualInsertIndex = insertIndex;
        if (draggedIndex < insertIndex) {
            actualInsertIndex++; // Account for dragged item still being in DOM
        }

        if (actualInsertIndex >= allItems.length) {
            container.appendChild(placeholder);
        } else {
            const referenceItem = allItems[actualInsertIndex];
            if (referenceItem && referenceItem !== draggedItem) {
                container.insertBefore(placeholder, referenceItem);
            } else if (actualInsertIndex + 1 < allItems.length) {
                container.insertBefore(placeholder, allItems[actualInsertIndex + 1]);
            } else {
                container.appendChild(placeholder);
            }
        }
    }

    // Add event listeners to all draggable items
    function setupItems() {
        getItems().forEach((item, index) => {
            item.setAttribute('draggable', 'true');
            item.dataset.index = index;

            item.addEventListener('dragstart', handleDragStart);
            item.addEventListener('dragend', handleDragEnd);
        });

        // Container-level events for better drop detection
        container.addEventListener('dragover', handleContainerDragOver);
        container.addEventListener('drop', handleContainerDrop);
        container.addEventListener('dragleave', handleContainerDragLeave);
    }

    /**
     * Handle drag start event.
     * @param {DragEvent} e - The drag event
     */
    function handleDragStart(e) {
        draggedItem = this;
        draggedIndex = getItemIndex(this);
        currentDropIndex = draggedIndex;

        // Capture height before hiding
        draggedItemHeight = this.offsetHeight;

        // Set drag data (required for Firefox)
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', draggedIndex.toString());

        // Hide the original item after a short delay (to allow the drag image to be captured)
        setTimeout(() => {
            this.style.opacity = '0';
            this.style.height = '0';
            this.style.margin = '0';
            this.style.padding = '0';
            this.style.overflow = 'hidden';
        }, 0);
    }

    /**
     * Handle drag end event.
     * @param {DragEvent} e - The drag event
     */
    function handleDragEnd(e) {
        if (draggedItem) {
            draggedItem.style.opacity = '';
            draggedItem.style.height = '';
            draggedItem.style.margin = '';
            draggedItem.style.padding = '';
            draggedItem.style.overflow = '';
        }

        removePlaceholder();

        draggedItem = null;
        draggedIndex = -1;
        currentDropIndex = -1;
    }

    /**
     * Handle drag over on container.
     * @param {DragEvent} e - The drag event
     */
    function handleContainerDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';

        if (draggedItem) {
            updatePlaceholderPosition(e.clientY);
        }
    }

    /**
     * Handle drag leave on container.
     * @param {DragEvent} e - The drag event
     */
    function handleContainerDragLeave(e) {
        // Only remove placeholder if truly leaving the container
        const rect = container.getBoundingClientRect();
        if (e.clientX < rect.left || e.clientX > rect.right ||
            e.clientY < rect.top || e.clientY > rect.bottom) {
            removePlaceholder();
            currentDropIndex = -1;
        }
    }

    /**
     * Handle drop on container.
     * @param {DragEvent} e - The drag event
     */
    function handleContainerDrop(e) {
        e.preventDefault();
        e.stopPropagation();

        if (draggedItem && currentDropIndex !== -1 && currentDropIndex !== draggedIndex) {
            // Notify Blazor of the reorder
            if (dotNetRef) {
                dotNetRef.invokeMethodAsync('OnItemReordered', draggedIndex, currentDropIndex);
            }
        }

        // Clean up
        if (draggedItem) {
            draggedItem.style.opacity = '';
            draggedItem.style.height = '';
            draggedItem.style.margin = '';
            draggedItem.style.padding = '';
            draggedItem.style.overflow = '';
        }
        removePlaceholder();

        draggedItem = null;
        draggedIndex = -1;
        currentDropIndex = -1;
    }

    // Initial setup
    setupItems();

    // Return cleanup function
    return {
        dispose: function () {
            getItems().forEach(item => {
                item.removeAttribute('draggable');
                item.removeEventListener('dragstart', handleDragStart);
                item.removeEventListener('dragend', handleDragEnd);
            });
            container.removeEventListener('dragover', handleContainerDragOver);
            container.removeEventListener('drop', handleContainerDrop);
            container.removeEventListener('dragleave', handleContainerDragLeave);
        },
        refresh: function () {
            this.dispose();
            setupItems();
        }
    };
}
