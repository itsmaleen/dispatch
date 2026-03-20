import { useCallback, useLayoutEffect, useState, RefObject } from 'react';

interface Position {
  x: number;
  y: number;
}

interface AdjustedPosition {
  top: number;
  left: number;
}

/**
 * Hook to calculate smart context menu positioning that avoids screen edge overflow.
 *
 * When the menu would overflow the right edge, it opens to the left of the cursor.
 * When the menu would overflow the bottom edge, it opens above the cursor.
 *
 * @param menuRef - Reference to the context menu element
 * @param position - The initial click position (clientX, clientY)
 * @param padding - Minimum padding from screen edges (default: 8px)
 * @returns The adjusted position for the menu
 */
export function useContextMenuPosition(
  menuRef: RefObject<HTMLElement>,
  position: Position | null,
  padding: number = 8
): AdjustedPosition | null {
  const [adjustedPosition, setAdjustedPosition] = useState<AdjustedPosition | null>(null);

  useLayoutEffect(() => {
    if (!position || !menuRef.current) {
      setAdjustedPosition(null);
      return;
    }

    const menu = menuRef.current;
    const menuRect = menu.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let { x: left, y: top } = position;

    // Check if menu would overflow on the right
    if (left + menuRect.width + padding > viewportWidth) {
      // Open to the left of cursor
      left = position.x - menuRect.width;
    }

    // Check if menu would overflow on the bottom
    if (top + menuRect.height + padding > viewportHeight) {
      // Open above cursor
      top = position.y - menuRect.height;
    }

    // Ensure menu doesn't go off-screen on the left
    if (left < padding) {
      left = padding;
    }

    // Ensure menu doesn't go off-screen on the top
    if (top < padding) {
      top = padding;
    }

    setAdjustedPosition({ top, left });
  }, [menuRef, position, padding]);

  return adjustedPosition;
}

/**
 * Calculate context menu position without a hook (for immediate use).
 * Call this after the menu is rendered to get adjusted coordinates.
 *
 * @param menuElement - The context menu DOM element
 * @param clickX - The clientX from the mouse event
 * @param clickY - The clientY from the mouse event
 * @param padding - Minimum padding from screen edges (default: 8px)
 * @returns The adjusted position for the menu
 */
export function calculateContextMenuPosition(
  menuElement: HTMLElement,
  clickX: number,
  clickY: number,
  padding: number = 8
): AdjustedPosition {
  const menuRect = menuElement.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  let left = clickX;
  let top = clickY;

  // Check if menu would overflow on the right
  if (left + menuRect.width + padding > viewportWidth) {
    // Open to the left of cursor
    left = clickX - menuRect.width;
  }

  // Check if menu would overflow on the bottom
  if (top + menuRect.height + padding > viewportHeight) {
    // Open above cursor
    top = clickY - menuRect.height;
  }

  // Ensure menu doesn't go off-screen on the left
  if (left < padding) {
    left = padding;
  }

  // Ensure menu doesn't go off-screen on the top
  if (top < padding) {
    top = padding;
  }

  return { top, left };
}
