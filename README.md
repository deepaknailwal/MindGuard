# MindGuard

A Chrome extension that helps people quit pornography. When it detects explicit content in the browser, it blurs it and covers the screen with **your own** photo, video and message, the things that remind you why you wanted to stop.

> Built as a hackathon project. It is a "speed bump", not a wall: it adds a pause between the urge and the click. It is not a replacement for professional help or support from people you trust.

## Features

| Feature | What it does |
|---|---|
| **Live scanning** | Scans images as they load, video frames every ~1.5 seconds, page text, and video subtitles/captions. |
| **Personal overlay** | A full-screen alert shows a random photo/video you saved plus your own message. The "False alarm" button unlocks only after 15 seconds. |
| **Streak counter** | The popup shows how long you have been clean since your last alert. |
| **Reference photo** | Pick a photo that represents your own limit. Anything scoring higher than it gets flagged. The photo is not stored, only its score. |
| **Train it yourself** | Show it your own NSFW and Safe examples. A small classifier learns on your device. Images are never saved, only numbers. |
| **Learns from false alarms** | Pressing "False alarm" adds that image to your Safe examples. |
| **Text filter** | Default word list plus your own words, matched on whole words to avoid false hits. Also checks the website name, URL and page title. |
| **What to scan** | Turn Photos, Videos, Text and Audio (subtitles) on or off. |
| **Gemini second opinion (optional)** | Borderline images get a second check from Google Gemini. See below. |

## Install (no downloads needed)

1. Download or clone this repository.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the project folder (the one that contains `manifest.json`).
5. Click the MindGuard icon, open **Settings**, and add your message and photos/videos.

Reload any tabs that were already open. Chrome does not allow extensions to run on `chrome://` pages or the Chrome Web Store.

## How it works

```
Web page ──► content.js ──► background.js ──► offscreen.js ──► result
 (images,     finds media    routes the        scores the        │
  video,      and text,      request,          image             ▼
  text)       blurs it       optional Gemini                  content.js decides
                             check                            flag or release
                                                              │
                                                              ▼
                                                        overlay.html (your photo + message)
```

- **Lite detector** (`offscreen.js`): estimates how much of the image is skin-tone and how evenly it is spread. It is deliberately conservative, so ordinary selfies are not flagged.
- **Trained model** (`features.js`): each image becomes 68 numbers (skin ratio per region, colour histograms, texture, largest skin blob). A logistic regression trained on your examples decides. It is used automatically once its test accuracy on held-out examples is at least 75%.
- **Final decision** (`MR.verdict` in `features.js`): trained model if available, otherwise the Lite detector, compared with your reference score or the sensitivity slider.
- **Privacy:** all of this runs locally. Scanned images are not stored. Your photos, message, training numbers and settings stay in `chrome.storage.local`.

## Gemini (cloud check)

Gemini is used as a **second opinion for borderline images**, to reduce false alarms (selfies, beach photos, warm-toned pictures). It is off unless you turn it on.

### How it is used

1. The local detector scores the image first.
2. If the score is close to your limit (between 0.6x and 1.5x of it), `background.js` sends a small 299px JPEG copy to the Gemini `generateContent` API with a short prompt asking whether the image is sexually explicit. Gemini answers with JSON: `{"explicit": true}` or `{"explicit": false}`.
3. Gemini's answer overrides the local result for that image. If Gemini refuses or blocks the request, it is treated as "explicit".
4. Clearly safe or clearly explicit images never leave your computer.

Safeguards in the code: at most one Gemini call every 4 seconds, at most 500 calls per day, and answers are cached per image. If Gemini fails (bad key, rate limit, network), the extension silently falls back to the local result.

### How to set it up

1. Get a free API key at [aistudio.google.com](https://aistudio.google.com) (**Get API key**).
2. Open the extension **Settings** and find the **Gemini cloud check** card.
3. Paste your key, turn the switch **ON**, and click **Save**.
4. Click **Test key** to confirm it works.

Other options on that card:
- **Model**: defaults to `gemini-2.5-flash`. If Google retires it, enter a current model name from [ai.google.dev/pricing](https://ai.google.dev/pricing).
- **Check every image with Gemini**: demo mode. Every scanned image goes to Gemini, which uses your quota much faster.

Your key is saved only in your browser (`chrome.storage.local`) and is sent only to `generativelanguage.googleapis.com`.


## Training tips

Open **Settings -> Train the model**.

- Add at least 20 examples on each side, ideally 100 or more.
- Put plenty of variety in **Safe**, especially what gets flagged wrongly: selfies, beach and gym photos, family photos, memes, products.
- Only use content of adults (18+) that you legally have. Never use images of minors or illegal content.
- After training, set your reference photo again, because the scoring mode changed.

## Project structure

```
manifest.json        extension config (Manifest V3)
background.js        message router and Gemini check
offscreen.html/.js   image analysis (Lite detector)
features.js          feature extraction, classifier, final decision
words.js             default text-filter words
content.js/.css      page scanner, blurring, overlay launcher
overlay.html/.js     full-screen alert
popup.html/.js       toolbar popup (on/off, streak, stats)
options.html/.js     settings page
train.html/.js       training page
shared.css           shared styles
config.js            optional Gemini key (keep empty in the repo)
icons/               extension icons
```

## Limitations

- Detection is heuristic and trained on small personal datasets. It will miss some content and sometimes flag normal photos. Use the sensitivity slider, training and the Gemini check to tune it.
- It only scans content inside browser pages, not other apps on your computer.
- Audio is covered through subtitles/captions and audio file names, not by listening to the sound.
- Anyone can disable the extension. Sharing your progress with a trusted friend helps.

## Contributing

Issues and pull requests are welcome.

