import React, { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';

/**
 * CountdownBar props.
 */
export interface ICountdownBarProps {
  /**
   * Whether the countdown bar is visible.
   */
  isVisible: boolean;
  /**
   * Color class for the progress bar (e.g., 'bg-orange-500', 'bg-primary-500').
   */
  colorClass?: string;
}

/**
 * CountdownBar ref handle for controlling the animation.
 */
export interface ICountdownBarHandle {
  /**
   * Start the countdown animation.
   * @param durationSeconds - Duration of the countdown in seconds
   */
  startAnimation: (durationSeconds: number) => void;
  /**
   * Stop the countdown animation immediately.
   */
  stopAnimation: () => void;
}

/**
 * Reusable countdown bar component that shows a progress bar at the top of the screen.
 * Use the ref to control the animation.
 */
export const CountdownBar = forwardRef<ICountdownBarHandle, ICountdownBarProps>(
  ({ isVisible, colorClass = 'bg-orange-500' }, ref) => {
    const animationRef = useRef<HTMLDivElement>(null);

    /**
     * Starts the countdown animation.
     */
    const startAnimation = (durationSeconds: number): void => {
      // Use a small delay to ensure the component is fully rendered
      setTimeout(() => {
        if (animationRef.current) {
          // Reset any existing animation
          animationRef.current.style.transition = 'none';
          animationRef.current.style.width = '100%';

          // Force browser to flush styles
          void animationRef.current.offsetHeight;

          // Start animation from 100% to 0%
          requestAnimationFrame(() => {
            if (animationRef.current) {
              animationRef.current.style.transition = `width ${durationSeconds}s linear`;
              animationRef.current.style.width = '0%';
            }
          });
        }
      }, 10);
    };

    /**
     * Stops the countdown animation immediately.
     */
    const stopAnimation = (): void => {
      if (animationRef.current) {
        animationRef.current.style.transition = 'none';
        animationRef.current.style.width = '0%';
      }
    };

    // Expose animation controls via ref
    useImperativeHandle(ref, () => ({
      startAnimation,
      stopAnimation,
    }));

    // Stop animation when becoming invisible
    useEffect(() => {
      if (!isVisible) {
        stopAnimation();
      }
    }, [isVisible]);

    if (!isVisible) {
      return null;
    }

    return (
      <div className="fixed top-0 left-0 right-0 z-[60] h-1 bg-gray-200 dark:bg-gray-700">
        <div
          ref={animationRef}
          className={`h-full ${colorClass}`}
          style={{ width: '100%', transition: 'none' }}
        />
      </div>
    );
  }
);

CountdownBar.displayName = 'CountdownBar';
