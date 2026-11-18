import { useEffect, useRef } from 'react';
import Artplayer from 'artplayer';
import Hls from 'hls.js';
import mpegts from 'mpegts.js';

export interface PlayerProps {
  url: string;
  type: 'm3u8' | 'flv' | 'mp4' | 'other';
  poster?: string;
  autoplay?: boolean;
  volume?: number;
  rate?: number;
  resumeAt?: number;
  onProgress?: (time: number, duration: number) => void;
  onEnded?: () => void;
  onReady?: (art: Artplayer) => void;
}

function playM3u8(video: HTMLVideoElement, url: string, art: Artplayer) {
  if (Hls.isSupported()) {
    const hls = new Hls({
      enableWorker: true,
      lowLatencyMode: false,
      backBufferLength: 60,
      maxBufferLength: 40,
      manifestLoadingTimeOut: 15000,
    });
    hls.loadSource(url);
    hls.attachMedia(video);
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (!data.fatal) return;
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        art.notice.show = '网络错误，正在重试…';
      } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        hls.recoverMediaError();
      } else {
        art.notice.show = '视频解码失败，建议切换线路';
      }
    });
    art.on('destroy', () => hls.destroy());
    (art as any).hls = hls;
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = url;
  } else {
    art.notice.show = '当前环境不支持 HLS 播放';
  }
}

function playFlv(video: HTMLVideoElement, url: string, art: Artplayer) {
  if (mpegts.isSupported()) {
    const player = mpegts.createPlayer({ type: 'flv', url, isLive: true }, { enableWorker: true, stashInitialSize: 128 });
    player.attachMediaElement(video);
    player.load();
    player.play();
    art.on('destroy', () => player.destroy());
    (art as any).mpegts = player;
  } else {
    art.notice.show = '当前环境不支持 FLV 播放';
  }
}

export default function Player({ url, type, poster, autoplay = true, volume = 0.8, rate = 1, resumeAt, onProgress, onEnded, onReady }: PlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef({ last: 0 });
  const cbRef = useRef({ onProgress, onEnded, onReady });
  cbRef.current = { onProgress, onEnded, onReady };

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !url) return;

    const art = new Artplayer({
      container,
      url,
      type: type === 'm3u8' ? 'm3u8' : type === 'flv' ? 'flv' : type === 'mp4' ? 'mp4' : 'auto',
      poster: poster || '',
      autoplay,
      volume,
      theme: getComputedStyle(document.documentElement).getPropertyValue('--brand').trim() || '#f43f5e',
      setting: true,
      aspectRatio: true,
      hotkey: true,
      pip: true,
      fullscreen: true,
      fullscreenWeb: false,
      miniProgressBar: true,
      autoSize: false,
      autoMini: false,
      airplay: false,
      lock: true,
      flip: true,
      screenshot: false,
      customType: { m3u8: playM3u8, flv: playFlv },
    });

    const onTime = () => {
      const video = art.video;
      if (!video) return;
      const now = Date.now();
      if (now - progressRef.current.last > 1000) {
        progressRef.current.last = now;
        cbRef.current.onProgress?.(video.currentTime, video.duration || 0);
      }
    };
    const onVideoEnded = () => cbRef.current.onEnded?.();
    const onError = () => {
      art.notice.show = '播放出错，可尝试切换线路或来源';
    };

    art.on('ready', () => {
      const video = art.video;
      if (!video) return;
      video.addEventListener('timeupdate', onTime);
      video.addEventListener('ended', onVideoEnded);
      video.addEventListener('error', onError);
      const target = resumeAt ?? 0;
      if (target > 5 && Number.isFinite(video.duration) && target < video.duration - 5) {
        video.currentTime = target;
        art.notice.show = `已从 ${Math.floor(target / 60)} 分 ${Math.floor(target % 60)} 秒继续播放`;
      }
      if (rate && rate !== 1) video.playbackRate = rate;
      cbRef.current.onReady?.(art);
    });

    return () => {
      const video = art.video;
      if (video) {
        video.removeEventListener('timeupdate', onTime);
        video.removeEventListener('ended', onVideoEnded);
        video.removeEventListener('error', onError);
        cbRef.current.onProgress?.(video.currentTime, video.duration || 0);
      }
      art.destroy(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, type]);

  return <div ref={containerRef} className="h-full w-full" />;
}
