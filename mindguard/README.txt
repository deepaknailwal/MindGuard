MINDGUARD
=========
No setup and no downloads. In Chrome:
  chrome://extensions -> turn Developer mode ON -> Load unpacked -> select this folder.

How it works
  - Scans photos, video frames, page text and video subtitles while you browse.
  - When something is flagged, a full-screen overlay shows your own photo/video and message.
  - Detection runs locally in the browser. Scanned images are never saved.

Settings (extension icon -> Settings)
  - My message, photos and videos (shown on the overlay)
  - Sensitivity slider, or a reference photo to set your own line
  - What to scan: Photos / Videos / Text / Audio (subtitles)
  - Text filter: add your own words
  - Train the model: teach it with your own NSFW / Safe examples (only numbers are stored)
  - Gemini cloud check (optional): paste an API key from aistudio.google.com
  - Detection test: check any image

Files
  manifest.json          extension config
  background.js          message router, Gemini check
  offscreen.html/.js     image analysis
  features.js            feature extraction, classifier, final decision
  words.js               default text-filter words
  content.js/.css        page scanner and overlay launcher
  overlay.html/.js       full-screen alert
  popup.html/.js         toolbar popup
  options.html/.js       settings page
  train.html/.js         training page
  shared.css             shared styles
  config.js              optional place for a Gemini API key
  icons/                 extension icons
