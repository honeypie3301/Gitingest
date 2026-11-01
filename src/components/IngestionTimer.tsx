import React, { useState, useEffect } from 'react';

export function formatDuration(ms: number): string {
  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) {
    return `${totalSeconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSecs = Math.floor(totalSeconds % 60);
  return `${minutes}m ${remainingSecs}s`;
}

interface IngestionTimerProps {
  startTime: number;
  className?: string;
}

export const IngestionTimer: React.FC<IngestionTimerProps> = ({ startTime, className = '' }) => {
  const [elapsed, setElapsed] = useState<number>(() => Math.max(0, Date.now() - startTime));

  useEffect(() => {
    setElapsed(Math.max(0, Date.now() - startTime));

    const timer = setInterval(() => {
      setElapsed(Math.max(0, Date.now() - startTime));
    }, 100);

    return () => clearInterval(timer);
  }, [startTime]);

  return <span className={className}>{formatDuration(elapsed)}</span>;
};
