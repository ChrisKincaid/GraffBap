export function entryRouteId(hash: string): string | null {
  if (!hash.startsWith('#entry=')) return null;
  const id = hash.slice('#entry='.length);
  return /^[A-Za-z0-9_-]{1,128}$/.test(id) ? id : '';
}

export function entryShareUrl(id: string, pageUrl: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error('This entry does not have a valid share link.');
  const url = new URL(pageUrl);
  url.search = '';
  url.hash = `entry=${id}`;
  return url.href;
}

export async function shareEntryLink(
  url: string,
  platform: Pick<Navigator, 'share' | 'clipboard'>,
  manualCopy: (url: string) => void,
): Promise<'shared' | 'copied' | 'cancelled' | 'manual'> {
  if (platform.share) {
    try {
      await platform.share({ title: 'Graph Bap', text: 'Check my piece. Drop a vote.', url });
      return 'shared';
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return 'cancelled';
      console.warn('Native entry sharing unavailable; trying to copy the link.', error);
    }
  }
  try {
    if (!platform.clipboard?.writeText) throw new Error('Clipboard access is unavailable.');
    await platform.clipboard.writeText(url);
    return 'copied';
  } catch (error) {
    console.warn('Could not copy the entry link automatically; showing it for manual copying.', error);
    manualCopy(url);
    return 'manual';
  }
}
