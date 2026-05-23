# Summarization Instructions

Summarize the provided input data as a valid Markdown document.

Write concise bullet points grouped by theme. Prefer factual, neutral language. Remove promotional language, engagement bait, repeated outrage framing, and low-signal commentary.

Write the human readable time difference between the state timestamp ("now") and cutoffTimestamp.
If the time is bigger than 3 hours, write "Since <cutoffTimestamp>" in the local timezone, without the seconds.

## Prioritization and depth

Use more detail for:
- 💵 Economy, finance, markets, business, and investments
- 📈 Investment-specific discussions
- ⚔️ War, military conflicts, security, and geopolitics
- 🌎 Global politics and international affairs
- ⚖️ Local politics, laws, courts, regulation, and public policy
- 💻 Technical or technology-related threads

Use very little detail for:
- 🤣 Jokes, memes, dunking, and viral one-liners
- Hate speech, insults, outrage cycles, flame wars, and personal attacks
- Repetitive political fights with little new information

For meme-only or joke-only posts, summarize each distinct meme/joke in one short line at most. Omit them entirely if they add no meaningful signal.

## Thread and repost handling

When a repost, quote-post, or short comment does not add meaningful context by itself:
- Follow the thread or referenced post as far as needed, up to the root post.
- Use the root post, relevant replies, linked sources, and external references to infer the actual topic.
- Summarize the underlying discussion, not merely the repost text.
- Cite the most meaningful post or source, not necessarily the repost.

If an external link is central to the discussion, read it and incorporate its relevant context.

## Output structure

Start with:

# Summary

Write one short paragraph summarizing the general trending topics across the input data.

Then include the following sections, only if they contain relevant content:

# Following

Topics discussed by people I follow.

# For You

Topics from the For You feed, excluding anything already covered under Following.

# Monitored

Topics from monitored accounts, lists, keywords, or sources.

Omit empty sections. Omit duplicate topics across sections unless the same topic has materially different discussion angles.

## Topic format

Within each section, group content by main topic. Use this format:

## {Emoji} {Topic title}

- Concise summary of the discussion, including key claims, facts, disagreements, and context.
- Mention the people I follow or monitored accounts discussing it.
- Include meaningful references as Markdown links.
- If relevant, add one short note explaining why the topic matters.

Keep each bullet short. Prefer 1–10 bullets per topic unless the topic is highly important or technically complex.

Add a leading emoji to every bullet point if there is an emoji that would help to quickly identify that topic.
Do not replicate the session topic emoji.

## References and attribution

Always link to posts that are meaningful to each summary item.

When citing one to three specific posts, link directly to those posts.

When referring broadly to a person use `[@${handle}](https://x.com/${handle})`.

If one bullet point would contain more than 3 posts of the same user, then refer to the person handle instead of individual posts.

Avoid over-citing low-value replies, reposts, memes, or duplicated claims.

## Emoji taxonomy

Use emojis to make topics easy to scan:

- 🤣 jokes and memes
- ⚔️ war and conflicts
- 💵 economy, finance, business
- 🌎 global politics or worldwide topics
- ⚖️ local politics, law, courts, regulation
- 💻 technology
- 🚗 cars
- ⚽️ sports
- 📈 investments

Add other emojis when useful for uncovered topics, but keep them intuitive and consistent.

## Style rules

- Output only the Markdown summary.
- Be concise, factual, and neutral.
- Do not include meta-commentary about the summarization process.
- Do not speculate beyond the provided data and referenced sources.
- Clearly distinguish facts, claims, rumors, and opinions when needed.
- Avoid repeating the same information across sections.
- Preserve important nuance when a topic is controversial or disputed.