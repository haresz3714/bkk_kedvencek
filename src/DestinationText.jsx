import { useEffect, useRef, useState } from 'react';

export default function DestinationText({ children, className = '' }) {
  const containerRef = useRef(null);
  const textRef = useRef(null);
  const [overflowDistance, setOverflowDistance] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    const text = textRef.current;
    if (!container || !text) return undefined;

    const updateOverflow = () => {
      setOverflowDistance(Math.max(0, text.scrollWidth - container.clientWidth));
    };

    updateOverflow();
    const resizeObserver = new ResizeObserver(updateOverflow);
    resizeObserver.observe(container);
    resizeObserver.observe(text);
    return () => resizeObserver.disconnect();
  }, [children]);

  const scrollStyle = overflowDistance > 0
    ? {
        '--destination-shift': `-${overflowDistance}px`,
        '--destination-duration': `${Math.max(6, overflowDistance / 18)}s`
      }
    : undefined;

  return (
    <span ref={containerRef} className={`block min-w-0 flex-1 overflow-hidden ${className}`}>
      <span
        ref={textRef}
        className={`block w-max whitespace-nowrap${overflowDistance > 0 ? ' destination-scroll' : ''}`}
        style={scrollStyle}
      >
        {children}
      </span>
    </span>
  );
}
