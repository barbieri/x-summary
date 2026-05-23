/** Parser-relevant TweetDetail GraphQL shape for live vs fixture comparison. */
export type TweetDetailParserShape = {
  focalFound: boolean;
  author?: string;
  hasFullText: boolean;
  hasNoteTweet: boolean;
  quotedStatusId?: string;
  inReplyToStatusId?: string;
  retweetedStatusId?: string;
  mediaTypes: string[];
  hasVideoVariants: boolean;
  entityUrlCount: number;
};

type RawTweetResult = {
  legacy?: {
    id_str?: string;
    full_text?: string;
    in_reply_to_status_id_str?: string;
    entities?: { urls?: unknown[]; media?: Array<{ type?: string }> };
    extended_entities?: { media?: Array<{ type?: string; video_info?: { variants?: unknown[] } }> };
  };
  core?: { user_results?: { result?: { core?: { screen_name?: string } } } };
  note_tweet?: { note_tweet_results?: { result?: { text?: string } } };
  quoted_status_result?: { result?: { legacy?: { id_str?: string } } };
  retweeted_status_result?: { result?: { legacy?: { id_str?: string } } };
};

function indexTweetResults(json: unknown): Map<string, RawTweetResult> {
  const graph = new Map<string, RawTweetResult>();

  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') {
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item);
      }
      return;
    }

    const node = value as RawTweetResult;
    const id = node.legacy?.id_str;
    const author = node.core?.user_results?.result?.core?.screen_name;
    if (id && author) {
      graph.set(id, node);
    }

    for (const child of Object.values(value)) {
      visit(child);
    }
  };

  visit(json);
  return graph;
}

/** Extract fields the TweetDetail parser depends on from raw GraphQL JSON. */
export function extractTweetDetailParserShape(
  json: string,
  focalTweetId: string,
): TweetDetailParserShape | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }

  const graph = indexTweetResults(parsed);
  const focal = graph.get(focalTweetId);
  if (!focal) {
    return {
      focalFound: false,
      hasFullText: false,
      hasNoteTweet: false,
      mediaTypes: [],
      hasVideoVariants: false,
      entityUrlCount: 0,
    };
  }

  const media = focal.legacy?.extended_entities?.media ?? focal.legacy?.entities?.media ?? [];
  const author = focal.core?.user_results?.result?.core?.screen_name;
  const mediaTypes = [...new Set(media.map((item) => item.type).filter(Boolean) as string[])];
  const hasVideoVariants = media.some(
    (item) => (item as { video_info?: { variants?: unknown[] } }).video_info?.variants?.length,
  );

  return {
    focalFound: true,
    ...(author ? { author } : {}),
    hasFullText: Boolean(focal.legacy?.full_text?.trim()),
    hasNoteTweet: Boolean(focal.note_tweet?.note_tweet_results?.result?.text?.trim()),
    ...(focal.quoted_status_result?.result?.legacy?.id_str
      ? { quotedStatusId: focal.quoted_status_result.result.legacy.id_str }
      : {}),
    ...(focal.legacy?.in_reply_to_status_id_str
      ? { inReplyToStatusId: focal.legacy.in_reply_to_status_id_str }
      : {}),
    ...(focal.retweeted_status_result?.result?.legacy?.id_str
      ? { retweetedStatusId: focal.retweeted_status_result.result.legacy.id_str }
      : {}),
    mediaTypes,
    hasVideoVariants,
    entityUrlCount: focal.legacy?.entities?.urls?.length ?? 0,
  };
}

import { expect } from 'vitest';

/** Live TweetDetail must still expose the structural fields captured in the fixture. */
export function expectTweetDetailShapePreserved(
  live: TweetDetailParserShape,
  fixture: TweetDetailParserShape,
): void {
  expect(live.focalFound, 'live TweetDetail missing focal tweet node').toBe(true);
  expect(fixture.focalFound, 'fixture missing focal tweet node').toBe(true);

  if (fixture.author) {
    expect(live.author, 'live TweetDetail missing author screen_name').toBe(fixture.author);
  }

  if (fixture.hasFullText) {
    expect(live.hasFullText || live.hasNoteTweet, 'live TweetDetail missing tweet text').toBe(true);
  }

  if (fixture.hasNoteTweet) {
    expect(live.hasNoteTweet, 'live TweetDetail missing note_tweet text').toBe(true);
  }

  if (fixture.quotedStatusId) {
    expect(live.quotedStatusId, 'live TweetDetail missing quoted_status_result').toBe(
      fixture.quotedStatusId,
    );
  }

  if (fixture.inReplyToStatusId) {
    expect(live.inReplyToStatusId, 'live TweetDetail missing in_reply_to_status_id_str').toBe(
      fixture.inReplyToStatusId,
    );
  }

  if (fixture.retweetedStatusId) {
    expect(live.retweetedStatusId, 'live TweetDetail missing retweeted_status_result').toBe(
      fixture.retweetedStatusId,
    );
  }

  for (const mediaType of fixture.mediaTypes) {
    expect(live.mediaTypes, `live TweetDetail missing media type ${mediaType}`).toContain(
      mediaType,
    );
  }

  if (fixture.hasVideoVariants) {
    expect(live.hasVideoVariants, 'live TweetDetail missing video_info.variants').toBe(true);
  }

  if (fixture.entityUrlCount > 0) {
    expect(live.entityUrlCount, 'live TweetDetail missing entities.urls').toBeGreaterThanOrEqual(
      fixture.entityUrlCount,
    );
  }
}
