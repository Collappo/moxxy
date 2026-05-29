import { useEffect, useRef } from 'react';
import type { Block } from '@/lib/useChat';
import { BlockView } from './BlockView';

/**
 * Auto-scrolling transcript. Stays glued to the bottom while new
 * blocks arrive unless the user has scrolled up — then we leave them
 * alone so they can read history without being yanked.
 */
export function Transcript({
  blocks,
}: {
  readonly blocks: ReadonlyArray<Block>;
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const follow = useRef(true);

  useEffect(() => {
    if (!follow.current) return;
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [blocks.length]);

  const onScroll = (): void => {
    const el = ref.current;
    if (!el) return;
    const slack = el.scrollHeight - el.scrollTop - el.clientHeight;
    follow.current = slack < 32;
  };

  return (
    <div
      ref={ref}
      data-testid="transcript"
      onScroll={onScroll}
      style={{
        flex: 1,
        overflowY: 'auto',
        padding: '1.5rem 2rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
      }}
    >
      {blocks.map((b) => (
        <BlockView key={b.id} block={b} />
      ))}
    </div>
  );
}
