# Reading the client's assets

This skill never generates images. The client supplies them, and your job is to
look at what they actually sent before writing a word of copy.

## Getting the assets

Ask for a Google Drive folder link or a direct upload into the chat.

From a Drive folder link, the ID is the segment after `/folders/`:

```python
q = f"'{FOLDER_ID}' in parents and trashed=false"
r = g(f'https://www.googleapis.com/drive/v3/files?q={quote(q)}'
      '&fields=files(id,name,mimeType,size)&pageSize=100')
# download each: /drive/v3/files/{id}?alt=media
```

Google access tokens expire hourly. Refresh at the start of the run, not once at
the beginning of a long session.

## Images

Load every image with `vision_analyze` and look at it properly. For each one:

- What is physically in the frame
- What text is on it, read the actual words
- Who it is speaking to, and at what moment in their decision
- Whether the client's logo is present

If the image carries Arabic text, check the letters connect correctly and there
are no broken or reversed glyphs. Client-supplied assets are usually fine, but
anything AI generated is not, and broken Arabic in a client's ad is the kind of
mistake that ends a relationship.

## Videos

Transcribe before writing. Never write copy from a thumbnail, because the guess
is wrong and the copy is wrong with it.

| Source | Tool |
|---|---|
| Instagram, TikTok, social links | `social-video-transcription` skill |
| YouTube | `apify-scraping` skill |
| Drive file | download, then whisper |

Read the transcript for the claims the client makes about themselves. Those are
pre-approved by definition, and they are the safest material to build copy from.

## Turning assets into five ads

One ad per asset. Never write five ads from one generic brief and paste the
same body under five different pictures.

A photo of a finished building and a photo of a site mid-construction are
talking to two different people at two different moments. Same copy under both
wastes both.

For each asset, write down in one line what it shows and who it speaks to. That
line becomes the ad's angle, and the angle drives all three copy variants.

Aim for a spread across the funnel rather than five versions of the same pitch:

| Layer | What it does |
|---|---|
| Awareness | names a situation the prospect has not connected to your service yet |
| Consequence | makes the cost of doing nothing concrete |
| Offer | states what they get and what it costs |

Two awareness, two consequence, one offer is a reasonable default for a client
whose market does not yet know they need the service. A client in a
well-understood category can weight more heavily toward offer.

## When there are fewer than five assets

Build fewer ads. Three strong ads outperform five where two are padding, and
padding costs the client real money while Meta learns that those two do not
work.

Tell the client which assets would strengthen the set, specifically. "A photo of
the team on site" is useful feedback. "More images" is not.
