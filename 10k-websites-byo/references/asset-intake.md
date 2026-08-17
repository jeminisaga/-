# The Handoff Protocol (generation without a connector)

No generator is wired into this build. You write the prompts and name the settings, the user runs them in whatever tool they have, and the files come back to you. Every gate in the skill still holds. What changes is that a round trip costs the user minutes of their own attention, so each handoff has to be complete enough to run once and get it right.

The rule that governs all of it: **never make the user guess what to do with a prompt.** A prompt handed over without its settings is a re-run waiting to happen, and the re-run is their money.

## What the tool has to be able to do

Not a brand, four capabilities. Check these in Phase 1, before the pipeline depends on them:

1. **Image-to-video from a starting image.** The whole method rests on composing frame one and animating from it. A text-to-video-only tool cannot run this pipeline as written.
2. **16:9 at 1080p or better.** A vertical or square export cannot become a widescreen hero without destroying the composition the shot was designed around.
3. **A clean export with no watermark.** This is the one that quietly kills builds. Most free tiers stamp the output, and a stamped hero sinks a site meant to look like it cost thousands. Say so during setup, not after they have spent a generation.
4. **A real file download to their own machine.** A share link to the tool's page is often re-encoded, sometimes watermarked, and usually expiring.

Stills need the same minus the motion: 16:9, high resolution, no watermark, downloadable. A different tool for stills than for video is normal and fine.

If the user has none of this, the honest options are a paid tier, a genuinely watermark-free free tier, or dropping generation entirely and building on real footage or stills they already own. Say which you recommend and why, then let them choose.

## The folders

Three, and only one of them ships:

```
project/
  index.html            the site
  assets/               what ships: hero-scrub.mp4, poster.jpg, stills
  _incoming/            what the user drops in, untouched originals
  _review/              what the user watches or opens before a gate
```

`_incoming/` and `_review/` never enter the deploy zip. Keep the untouched original of every file in `_incoming/` even after processing: when a gate sends something back, you re-encode from the original, never from an already-encoded copy.

## The shape of a handoff message

One message, four parts, nothing else in it:

1. **One line of what this generation is for.** "This is the starting frame, the first moment of the pour."
2. **The prompt, in a copy-paste block, alone.** No commentary inside the block, no alternates, no "or try". A second option in the block means they run it twice.
3. **The settings, as a short list in plain words.** Name every one that matters, including the ones that are usually already right, because a default that changed last week is invisible to both of you. For video: image-to-video from the approved frame, 16:9, 1080p, about 6 seconds, no audio or music, no upscale, no auto-enhance or auto-color, download the original file. For stills: 16:9, highest resolution offered, no upscale, download the original.
4. **Where to put it when it is done,** naming the exact filename: drop it in this chat, or save it as `_incoming/hero-raw.mp4`.

Then stop. Do not add a question, a preview of the next step, or an encouragement. Their next message is the file.

**Batch the stills.** The two to four supporting images go over in ONE numbered message so the user runs them in a single sitting. A stop-start relay for four images is four context switches for them and roughly nothing gained for you.

## The wait

A handoff is minutes at best: they read it, set the tool up, wait for the render, download, come back. Say once, in one line, that you will be building the page in the meantime. Then go quiet and actually build: scaffolding, sections, copy, anything that does not depend on footage you have not seen.

Never nudge. Never ask if it is ready. Never poll a folder in a loop. If the user comes back with a question instead of a file, answer it in one short message and return to the wait.

## The intake check (run on EVERY file, before the creative gate)

A file that arrives is not yet a file that works. Check the mechanics first, because a settings problem is not the user's taste and should never reach a creative conversation:

```bash
ffprobe -v error -show_entries stream=codec_name,width,height,r_frame_rate,duration,codec_type \
  -of default=noprint_wrappers=1 _incoming/hero-raw.mp4
ls -lh _incoming/hero-raw.mp4
```

Then read it against the plan:

| Check | Wanted | If it is wrong |
|---|---|---|
| Aspect | 16:9 | Not croppable to a hero without wrecking the composition. Name the setting, have them re-run |
| Resolution | 1080p or higher | Below 1080p, the scrub encode has nothing to work with. Re-run |
| Audio track | none | Harmless, strip it locally with `-an` |
| Duration | about the length planned | A short clip is fine (the page runs on scroll progress, not seconds). A wildly long one usually means the tool extended it; check the ending still rests |
| Watermark | none | Do not crop it and do not blur it. Back to the user; this is a plan problem, not a fix |
| File size | plausible for the length | A tiny file means a heavily compressed preview export, not the original |

Only after all of that pass do you extract frames and form a creative opinion. Report an intake failure immediately with the one setting that was wrong and nothing more: no critique of a file the build cannot use anyway.

## Chaining, without an upload API

Same as the automated flow, one step slower. Extract the approved segment's final frame as a full-quality PNG with ffmpeg, save it in `_review/` named for its segment (`seg-01-final.png`), and hand that file back with the next segment's prompt. Tell them in one line that it must be that exact PNG loaded as the starting image, not a screenshot of the video: a screenshot loses the resolution the invisible join depends on.

Gate each segment on its own. A rejected segment is one re-run, not a redo of the journey.

## When a generator does exist

If a session ever does have an image or video tool available directly, use it and keep every gate exactly as written: the storyboard approval, the image inspection, the video gate, the brand-coherence pass. The only thing that changes is who presses the button. This protocol is the floor, not a ceiling.
