const express = require('express');
const cors = require('cors');
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3001;

// Allow requests from isitreelapp.com
app.use(cors({
  origin: ['https://isitreelapp.com', 'http://localhost:3000'],
  methods: ['POST', 'GET'],
}));

app.use(express.json());

const upload = multer({ dest: os.tmpdir(), limits: { fileSize: 100 * 1024 * 1024 } });

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'isitreeel-ytdlp' });
});

// Extract frames from a URL
app.post('/extract', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });

  // Validate URL is from supported platform
  const supported = ['youtube.com', 'youtu.be', 'tiktok.com', 'facebook.com', 'fb.watch', 'instagram.com', 'twitter.com', 'x.com'];
  const isSupported = supported.some(domain => url.includes(domain));
  if (!isSupported) return res.status(400).json({ error: 'Unsupported platform. Try YouTube, TikTok, Facebook, Instagram, or X.' });

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'isitreeel-'));
  const videoPath = path.join(tmpDir, 'video.mp4');
  const framesDir = path.join(tmpDir, 'frames');
  fs.mkdirSync(framesDir);

  try {
    // Step 1: Download video with yt-dlp
    await new Promise((resolve, reject) => {
      const ytdlp = spawn('yt-dlp', [
        '--no-playlist',
        '--max-filesize', '100m',
        '-f', 'bestvideo[ext=mp4][height<=720]+bestaudio[ext=m4a]/best[ext=mp4][height<=720]/best',
        '--merge-output-format', 'mp4',
        '-o', videoPath,
        '--no-warnings',
        url
      ]);
      let stderr = '';
      ytdlp.stderr.on('data', (data) => { stderr += data.toString(); });
      ytdlp.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error('Download failed: ' + stderr.slice(-200)));
      });
      ytdlp.on('error', reject);
      setTimeout(() => { ytdlp.kill(); reject(new Error('Download timeout')); }, 60000);
    });

    // Step 2: Extract 6 frames using ffmpeg
    await new Promise((resolve, reject) => {
      execFile('ffmpeg', [
        '-i', videoPath,
        '-vf', 'fps=1/3,scale=640:-2',
        '-frames:v', '6',
        '-q:v', '3',
        path.join(framesDir, 'frame%d.jpg'),
        '-y'
      ], (err, stdout, stderr) => {
        if (err) reject(new Error('Frame extraction failed'));
        else resolve();
      });
    });

    // Step 3: Read frames and convert to base64
    const frameFiles = fs.readdirSync(framesDir)
      .filter(f => f.endsWith('.jpg'))
      .sort()
      .slice(0, 6);

    if (frameFiles.length === 0) {
      return res.status(500).json({ error: 'No frames could be extracted from this video' });
    }

    const frames = frameFiles.map(f => {
      const data = fs.readFileSync(path.join(framesDir, f));
      return data.toString('base64');
    });

    let title = 'video from ' + new URL(url).hostname;
    res.json({ frames, title, count: frames.length });

  } catch (err) {
    console.error('Extraction error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to process video' });
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch(e) {}
  }
});

// Convert uploaded video file and extract frames (for mobile TikTok uploads)
app.post('/convert-and-extract', upload.single('video'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'isitreeel-'));
  const convertedPath = path.join(tmpDir, 'converted.mp4');
  const framesDir = path.join(tmpDir, 'frames');
  fs.mkdirSync(framesDir);

  try {
    // Convert to H.264 MP4
    await new Promise((resolve, reject) => {
      execFile('ffmpeg', [
        '-i', req.file.path,
        '-vcodec', 'libx264',
        '-acodec', 'aac',
        '-y',
        convertedPath
      ], (err, stdout, stderr) => {
        if (err) reject(new Error('Conversion failed: ' + stderr));
        else resolve();
      });
    });

    // Extract 6 frames
    await new Promise((resolve, reject) => {
      execFile('ffmpeg', [
        '-i', convertedPath,
        '-vf', 'fps=1/3,scale=640:-2',
        '-frames:v', '6',
        '-q:v', '3',
        path.join(framesDir, 'frame%d.jpg'),
        '-y'
      ], (err) => {
        if (err) reject(new Error('Frame extraction failed'));
        else resolve();
      });
    });

    const frameFiles = fs.readdirSync(framesDir)
      .filter(f => f.endsWith('.jpg'))
      .sort()
      .slice(0, 6);

    if (frameFiles.length === 0) return res.status(500).json({ error: 'No frames extracted' });

    const frames = frameFiles.map(f => {
      const data = fs.readFileSync(path.join(framesDir, f));
      return data.toString('base64');
    });

    res.json({ frames, count: frames.length });

  } catch (err) {
    console.error('Convert error:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch(e) {}
    try { fs.unlinkSync(req.file.path); } catch(e) {}
  }
});

app.listen(PORT, () => {
  console.log(`IsItReel yt-dlp service running on port ${PORT}`);
});
