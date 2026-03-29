const { spawn, spawnSync } = require('child_process');

const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const ffprobeInstaller = require('@ffprobe-installer/ffprobe');

function cleanUrl(rawUrl) {
  let cleaned = String(rawUrl || '').trim();
  if (cleaned.startsWith('`') && cleaned.endsWith('`')) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  return cleaned;
}

function buildHttpHeaders(url) {
  try {
    const parsed = new URL(url);
    const origin = `${parsed.protocol}//${parsed.host}`;
    const headers =
      `Accept: */*\r\n` +
      `Accept-Language: fr-FR,fr;q=0.9,en-US;q=0.8\r\n` +
      `Origin: ${origin}\r\n` +
      `Referer: ${origin}/\r\n`;
    return { origin, headers };
  } catch {
    return {
      origin: '',
      headers: `Accept: */*\r\nAccept-Language: fr-FR,fr;q=0.9,en-US;q=0.8\r\n`,
    };
  }
}

function isYtDlpAvailable() {
  try {
    const r = spawnSync('yt-dlp', ['--version'], { stdio: 'ignore' });
    if (r.error) return false;
    return r.status === 0;
  } catch {
    return false;
  }
}

async function ffprobeDuration(url) {
  return new Promise((resolve) => {
    const proc = spawn(
      ffprobeInstaller.path,
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=nk=1:nw=1',
        url,
      ],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    );

    let out = '';
    const timeout = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch (_) {}
      resolve(0);
    }, 8000);

    proc.stdout.on('data', (d) => {
      out += d.toString();
    });

    proc.on('close', () => {
      clearTimeout(timeout);
      const v = out.trim();
      const num = parseFloat(v);
      if (!v || v === 'N/A' || !Number.isFinite(num) || num <= 0) return resolve(0);
      resolve(num);
    });

    proc.on('error', () => {
      clearTimeout(timeout);
      resolve(0);
    });
  });
}

async function main() {
  const rawUrl = process.argv[2];
  const seconds = Number(process.argv[3] || 8);
  if (!rawUrl) {
    console.error('Usage: node scripts/test-download.js <m3u8_url> [seconds]');
    process.exit(1);
  }

  const url = cleanUrl(rawUrl);
  const ua =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  const { headers } = buildHttpHeaders(url);

  console.log('yt-dlp available:', isYtDlpAvailable());
  console.log('ffmpeg:', ffmpegInstaller.path);
  console.log('ffprobe:', ffprobeInstaller.path);

  const duration = await ffprobeDuration(url);
  console.log('ffprobe duration:', duration || '(unknown)');

  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-user_agent',
    ua,
    '-headers',
    headers,
    '-i',
    url,
    '-t',
    String(seconds),
    '-map',
    '0:v?',
    '-map',
    '0:a?',
    '-c',
    'copy',
    '-f',
    'null',
    '-',
  ];

  console.log('Running ffmpeg sample download...');
  const proc = spawn(ffmpegInstaller.path, args, { stdio: ['ignore', 'ignore', 'inherit'] });

  proc.on('close', (code) => {
    console.log('ffmpeg exit code:', code);
    process.exit(code || 0);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

