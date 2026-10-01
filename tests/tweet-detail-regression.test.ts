import { describe, expect, it } from 'vitest';
import { parsePostFromTweetDetail } from '../src/browser/tweet-detail-api.js';

describe('TweetDetail non-tweet entries', () => {
  it('skips visibility wrappers without id_str and extracts the focal tweet', () => {
    const tweet = {
      legacy: {
        id_str: '2105356107834',
        full_text: 'Hello from X',
        created_at: 'Wed May 22 11:00:00 +0000 2026',
      },
      core: { user_results: { result: { core: { screen_name: 'stratospunky' } } } },
      quoted_status_result: { result: { __typename: 'TweetUnavailable' } },
    };
    const payload = {
      data: {
        threaded_conversation_with_injections_v2: {
          instructions: [
            {
              entries: [
                {
                  content: {
                    itemContent: { tweet_results: { result: { __typename: 'TweetUnavailable' } } },
                  },
                },
                {
                  content: {
                    itemContent: {
                      tweet_results: {
                        result: { __typename: 'TweetWithVisibilityResults', tweet },
                      },
                    },
                  },
                },
              ],
            },
          ],
        },
      },
    };
    expect(parsePostFromTweetDetail(JSON.stringify(payload), '2105356107834')).toMatchObject({
      href: 'https://x.com/stratospunky/status/2105356107834',
    });
  });
});
