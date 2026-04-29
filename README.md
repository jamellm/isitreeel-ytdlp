# IsItReel yt-dlp Service

Video download and frame extraction microservice for IsItReel.

## Supports
- YouTube
- TikTok  
- Facebook
- Instagram
- X / Twitter

## API

### POST /extract
```json
{ "url": "https://www.youtube.com/watch?v=..." }
```
Returns base64 encoded frames for AI analysis.

### GET /health
Returns service status.
