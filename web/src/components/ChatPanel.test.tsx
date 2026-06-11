import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ChatPanel, { chatFooterStatus } from './ChatPanel';

describe('ChatPanel', () => {
  it('renders the closeable public chat shell without private packet language', () => {
    const html = renderToStaticMarkup(
      <ChatPanel
        autoRefresh={false}
        presentation="side"
        onPresentationChange={() => undefined}
        onClose={() => undefined}
        initialMessages={[
          {
            id: 'chat-1',
            at: Date.now() - 30_000,
            region: 'ON',
            sender: 'Alice',
            text: 'hello mesh',
            channelLabel: 'Public',
            payloadTypeName: 'PLAIN_TEXT',
            source: 'broker',
            routeIds: ['private-route']
          }
        ]}
      />
    );

    expect(html).toContain('Public messages from map-safe packet fields');
    expect(html).toContain('workspace-side');
    expect(html).toContain('Expand to full screen');
    expect(html).toContain('Search sender, message, region, channel');
    expect(html).toContain('hello mesh');
    expect(html).toContain('Close chat');
    expect(html).not.toContain('private-route');
    expect(html).not.toContain('broker');
    expect(html).not.toContain('raw');
    expect(html).not.toContain('resolver');
    expect(html).not.toContain('hash');
  });

  it('renders loading, error, and empty states', () => {
    expect(renderToStaticMarkup(<ChatPanel autoRefresh onClose={() => undefined} />)).toContain('chat-loading-bar');
    expect(renderToStaticMarkup(<ChatPanel autoRefresh={false} initialError="Nope" onClose={() => undefined} />)).toContain('Nope');
    expect(renderToStaticMarkup(<ChatPanel autoRefresh={false} onClose={() => undefined} />)).toContain('No public chat messages in this window');
  });

  it('collapses repeated decoded message sightings before rendering rows', () => {
    const html = renderToStaticMarkup(
      <ChatPanel
        autoRefresh={false}
        onClose={() => undefined}
        initialMessages={[
          {
            id: 'chat-a',
            at: Date.now() - 5 * 60_000,
            region: 'YVR',
            sender: 'SpooderMan',
            text: 'NotSoSmart watch.',
            channelLabel: 'Public',
            payloadTypeName: 'GROUP_TEXT',
            endpointLabels: ['ka.RF.cli', 'NWR']
          },
          {
            id: 'chat-b',
            at: Date.now() - 5 * 60_000 + 1_000,
            region: 'YYJ',
            sender: 'SpooderMan',
            text: 'Not\u200bSoSmart watch!',
            channelLabel: 'Public',
            payloadTypeName: 'GROUP_TEXT',
            endpointLabels: ['Salish', 'CyberiaOne']
          },
          {
            id: 'chat-c',
            at: Date.now() - 5 * 60_000 + 2_000,
            region: 'YYJ',
            sender: 'SpooderMan',
            text: 'NotSoSmart watch.',
            channelLabel: 'Public',
            payloadTypeName: 'GROUP_TEXT',
            endpointLabels: ['Salish', 'CyberiaOne']
          }
        ]}
      />
    );

    expect(html.match(/NotSoSmart watch/g)).toHaveLength(1);
    expect(html).toContain('Loaded');
    expect(html).toContain('1');
  });

  it('describes footer states', () => {
    expect(chatFooterStatus(2, 'cursor', false)).toBe('2 loaded - older available');
    expect(chatFooterStatus(1, '', false)).toBe('1 loaded');
    expect(chatFooterStatus(0, '', true)).toBe('Loading older messages...');
  });
});
